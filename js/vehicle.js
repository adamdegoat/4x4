// The little one-seat 4x4. A rigid body on four raycast springs, driven by
// all four wheels. Local axes: +x right, +y up, -z forward (same as the camera).

import * as THREE from 'three';
import { clamp, lerp } from './noise.js';

const G = 9.81;
const _v = new THREE.Vector3(), _r = new THREE.Vector3(), _f = new THREE.Vector3();
const _up = new THREE.Vector3(), _fwd = new THREE.Vector3(), _right = new THREE.Vector3();
const _m3 = new THREE.Matrix3(), _mInvI = new THREE.Matrix3(), _t = new THREE.Vector3();
const _q = new THREE.Quaternion(), _pv = new THREE.Vector3(), _n = new THREE.Vector3();

export const CAR = {
  mass: 620,
  inertia: new THREE.Vector3(430, 470, 330), // body-space diagonal (pitch, yaw, roll-ish tuned for stability)
  wheelR: 0.36,
  rest: 0.42,          // spring length at rest (mount to wheel centre)
  k: 15000, cBump: 1500, cRebound: 2100,
  mounts: [            // FL, FR, RL, RR  (relative to centre of mass)
    new THREE.Vector3(-0.66, -0.12, -0.98),
    new THREE.Vector3(0.66, -0.12, -0.98),
    new THREE.Vector3(-0.66, -0.12, 0.92),
    new THREE.Vector3(0.66, -0.12, 0.92),
  ],
  maxSteer: 0.58,
  drive: 4300,         // max tractive force at low speed (N, all wheels)
  power: 36000,        // W; force falls off as P / v
  vmax: 17,            // m/s governor (~61 km/h)
  brake: 7000,
  reverseMax: 5,
  // corners of the body shell, for rollover/bottoming contact
  hull: [
    [-0.7, -0.25, -1.45], [0.7, -0.25, -1.45], [-0.7, -0.25, 1.35], [0.7, -0.25, 1.35],
    [-0.65, 1.05, -0.4], [0.65, 1.05, -0.4], [-0.65, 1.05, 0.95], [0.65, 1.05, 0.95],
    [0, -0.3, 0],
  ].map((a) => new THREE.Vector3(...a)),
};

export class Vehicle {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.ang = new THREE.Vector3(); // world angular velocity
    this.steer = 0;
    this.wheels = CAR.mounts.map(() => ({ comp: 0, prevComp: 0, contact: false, spin: 0, grip: 1, water: 0, load: 0 }));
    this.input = { steer: 0, gas: 0, brake: 0 };
    this.gear = 1; // 1 forward, -1 reverse
    this.speed = 0; // signed forward speed m/s
    this.events = { impact: 0, bump: 0, splash: 0, brush: 0 };
    this.upsideTime = 0;
  }

  place(x, z, heading) {
    const y = this.world.terrain.heightAt(x, z) + 0.9;
    this.pos.set(x, y, z);
    this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading + Math.PI); // -z faces heading
    this.vel.set(0, 0, 0); this.ang.set(0, 0, 0);
    this.steer = 0; this.upsideTime = 0;
  }

  step(dt) {
    const T = this.world.terrain;
    const q = this.quat;
    _up.set(0, 1, 0).applyQuaternion(q);
    _fwd.set(0, 0, -1).applyQuaternion(q);
    _right.set(1, 0, 0).applyQuaternion(q);
    this.speed = this.vel.dot(_fwd);

    // --- driver input → gear, throttle, brake -------------------------------
    const inp = this.input;
    let throttle = 0, brake = 0;
    if (inp.gas > 0) {
      if (this.speed < -0.8) brake = inp.gas; else { this.gear = 1; throttle = inp.gas; }
    }
    if (inp.brake > 0) {
      if (this.speed > 0.8 && this.gear === 1) brake = Math.max(brake, inp.brake);
      else { this.gear = -1; throttle = inp.brake; }
    }
    // steering: rate-limited and softened at speed
    const sLimit = CAR.maxSteer * lerp(1, 0.45, clamp(Math.abs(this.speed) / CAR.vmax, 0, 1));
    const target = inp.steer * sLimit;
    this.steer += clamp(target - this.steer, -2.4 * dt, 2.4 * dt);

    // inverse inertia in world space
    _m3.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
    const R = _m3.elements;
    const ix = 1 / CAR.inertia.x, iy = 1 / CAR.inertia.y, iz = 1 / CAR.inertia.z;
    // I^-1 world = R * diag * R^T
    const e = _mInvI.elements;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      e[c * 3 + r] = R[0 * 3 + r] * ix * R[0 * 3 + c] + R[1 * 3 + r] * iy * R[1 * 3 + c] + R[2 * 3 + r] * iz * R[2 * 3 + c];
    }

    const force = new THREE.Vector3(0, -G * CAR.mass, 0);
    const torque = new THREE.Vector3();
    const addForceAt = (F, point) => {
      force.add(F);
      _r.subVectors(point, this.pos);
      torque.add(_t.crossVectors(_r, F));
    };

    let anyContact = false, waterDepth = 0, brushing = 0;
    const cs = Math.cos(this.steer), sn = Math.sin(this.steer);
    const vabs = Math.abs(this.speed);
    const driveF = throttle * Math.min(CAR.drive, CAR.power / Math.max(vabs, 1)) *
      (this.gear === 1 ? (vabs < CAR.vmax ? 1 : 0) : (vabs < CAR.reverseMax ? 0.7 : 0));

    for (let w = 0; w < 4; w++) {
      const wh = this.wheels[w];
      const mount = _v.copy(CAR.mounts[w]).applyQuaternion(q).add(this.pos);
      // ray straight down the body's -up axis
      const maxLen = CAR.rest + CAR.wheelR;
      // sample ground under where the wheel would be at full extension
      const px = mount.x - _up.x * CAR.rest, pz = mount.z - _up.z * CAR.rest;
      const gy = T.heightAt(px, pz);
      const upY = Math.max(_up.y, 0.2);
      const dist = (mount.y - gy) / upY; // along body-down
      wh.prevComp = wh.comp;
      if (dist < maxLen && _up.y > 0.15) {
        anyContact = true;
        wh.contact = true;
        const comp = clamp(maxLen - dist, 0, CAR.rest + 0.1);
        wh.comp = comp;
        const compVel = (comp - wh.prevComp) / dt;
        let Fs = CAR.k * comp + (compVel > 0 ? CAR.cBump : CAR.cRebound) * compVel;
        // bump stop
        if (comp > CAR.rest * 0.85) Fs += (comp - CAR.rest * 0.85) * 90000;
        Fs = Math.max(0, Fs);
        wh.load = Fs;
        if (compVel > 1.6) this.events.bump = Math.max(this.events.bump, Math.min(1, (compVel - 1.6) / 4));

        // ground normal for friction plane
        const hL = T.heightAt(px - 0.4, pz), hR = T.heightAt(px + 0.4, pz);
        const hB = T.heightAt(px, pz - 0.4), hF = T.heightAt(px, pz + 0.4);
        _n.set(hL - hR, 0.8, hB - hF).normalize();

        const cp = _pv.set(px, gy, pz);
        // apply forces at mount height to reduce rollover (classic arcade trick)
        const applyAt = mount;
        _f.copy(_up).multiplyScalar(Fs);
        addForceAt(_f, applyAt);

        // wheel axes (front wheels steer)
        const wf = new THREE.Vector3(), wr = new THREE.Vector3();
        if (w < 2) {
          wf.copy(_fwd).multiplyScalar(cs).addScaledVector(_right, sn);
          wr.copy(_right).multiplyScalar(cs).addScaledVector(_fwd, -sn);
        } else { wf.copy(_fwd); wr.copy(_right); }
        // project onto the ground plane
        wf.addScaledVector(_n, -wf.dot(_n)).normalize();
        wr.addScaledVector(_n, -wr.dot(_n)).normalize();

        // contact point velocity
        _r.subVectors(cp, this.pos);
        const pvel = new THREE.Vector3().crossVectors(this.ang, _r).add(this.vel);
        const vLong = pvel.dot(wf), vLat = pvel.dot(wr);

        const surf = T.surfaceAt(px, pz);
        wh.grip = surf.grip; wh.water = surf.water;
        if (surf.water) waterDepth = Math.max(waterDepth, T.waterY(px) - gy);
        const mu = 1.05 * surf.grip;
        const Fmax = mu * Fs;

        // lateral: kill sideways slip, capped by grip
        const mEff = CAR.mass / 4;
        let Flat = -vLat * mEff / dt * 0.55;
        // longitudinal
        let Flong = this.gear * driveF / 4;
        const rollRes = (80 + surf.mud * 900 + (surf.water ? 600 : 0)) * Math.sign(vLong) * Math.min(1, Math.abs(vLong) * 2);
        Flong -= rollRes;
        if (brake > 0 || throttle === 0) {
          // brakes; off the gas there's engine braking, and when nearly stopped
          // a firm hold so a parked car stays hidden where you left it
          const hold = brake > 0 ? CAR.brake / 4 * brake : (vabs < 1.5 ? 2600 : 380);
          Flong -= clamp(vLong * mEff / dt, -hold, hold);
        }
        // friction circle
        const mag = Math.hypot(Flat, Flong);
        let slip = 0;
        if (mag > Fmax) { const s = Fmax / mag; Flat *= s; Flong *= s; slip = 1 - s; }
        wh.slip = slip;
        wh.spin += (vLong / CAR.wheelR) * dt;
        _f.copy(wf).multiplyScalar(Flong).addScaledVector(wr, Flat);
        // friction applied at a point a little above the contact patch
        const fp = new THREE.Vector3().copy(cp).lerp(mount, 0.45);
        addForceAt(_f, fp);
      } else {
        wh.contact = false; wh.comp = 0; wh.load = 0; wh.slip = 0;
      }
    }

    // --- hull contact: roof/bumpers/belly against the ground ----------------
    for (const c of CAR.hull) {
      const p = _v.copy(c).applyQuaternion(q).add(this.pos);
      const gy = T.heightAt(p.x, p.z);
      const pen = gy - p.y;
      if (pen > 0) {
        _r.subVectors(p, this.pos);
        const pvel = new THREE.Vector3().crossVectors(this.ang, _r).add(this.vel);
        const Fn = pen * 120000 - Math.min(0, pvel.y) * 6000;
        _f.set(-pvel.x * 900, Math.max(0, Fn), -pvel.z * 900);
        addForceAt(_f, p);
        if (pvel.y < -2.5) this.events.bump = 1;
      }
    }

    // water drag + air drag
    if (waterDepth > 0) {
      const d = clamp(waterDepth, 0, 0.9);
      force.addScaledVector(this.vel, -d * 1400);
      force.y += d * 2500; // a little buoyancy
      if (vabs > 1.5) this.events.splash = Math.max(this.events.splash, clamp(vabs / 8, 0, 1) * d * 1.5);
    }
    force.addScaledVector(this.vel, -this.vel.length() * 1.1);
    torque.addScaledVector(this.ang, anyContact ? -120 : -40);

    // --- integrate ------------------------------------------------------------
    this.vel.addScaledVector(force, dt / CAR.mass);
    _t.copy(torque).applyMatrix3(_mInvI);
    this.ang.addScaledVector(_t, dt);
    if (this.ang.length() > 8) this.ang.setLength(8);
    this.pos.addScaledVector(this.vel, dt);
    const a = this.ang, qa = _q.set(a.x * dt * 0.5, a.y * dt * 0.5, a.z * dt * 0.5, 0).multiply(q);
    q.x += qa.x; q.y += qa.y; q.z += qa.z; q.w += qa.w; q.normalize();

    // --- trunks: circle collisions against tree trunks --------------------------
    this.collideTrees(dt);
    // --- undergrowth: brushing through bushes slows you a little -----------------
    brushing = this.world.brushAt ? this.world.brushAt(this.pos.x, this.pos.z) : 0;
    if (brushing > 0 && vabs > 1) {
      this.vel.multiplyScalar(1 - brushing * 0.9 * dt);
      this.events.brush = Math.max(this.events.brush, clamp(vabs / 10, 0.2, 1) * brushing);
    }

    // keep inside the map
    const lim = 197;
    if (Math.abs(this.pos.x) > lim) { this.pos.x = Math.sign(this.pos.x) * lim; this.vel.x *= -0.3; }
    if (Math.abs(this.pos.z) > lim) { this.pos.z = Math.sign(this.pos.z) * lim; this.vel.z *= -0.3; }

    // flipped? after a few seconds we right the car
    _up.set(0, 1, 0).applyQuaternion(q);
    this.upsideTime = _up.y < 0.3 && this.vel.length() < 2 ? this.upsideTime + dt : 0;
    this.upright = _up.y;
  }

  collideTrees(dt) {
    const trees = this.world.treeGrid;
    if (!trees) return;
    _fwd.set(0, 0, -1).applyQuaternion(this.quat);
    const fx = _fwd.x, fz = _fwd.z, fl = Math.hypot(fx, fz) || 1;
    const ux = fx / fl, uz = fz / fl;
    const circles = [[1.05, 0.72], [0, 0.78], [-1.0, 0.72]]; // (offset along forward, radius)
    for (const [off, rad] of circles) {
      const cx = this.pos.x + ux * off, cz = this.pos.z + uz * off;
      const list = trees.query(cx, cz);
      for (const t of list) {
        const dx = cx - t.x, dz = cz - t.z;
        const d = Math.hypot(dx, dz), min = rad + t.r;
        if (d >= min || d < 1e-4) continue;
        const nx = dx / d, nz = dz / d, pen = min - d;
        this.pos.x += nx * pen; this.pos.z += nz * pen;
        // impulse at the contact point
        const p = new THREE.Vector3(t.x + nx * t.r, this.pos.y, t.z + nz * t.r);
        _r.subVectors(p, this.pos);
        const n = _n.set(nx, 0, nz);
        const pvel = new THREE.Vector3().crossVectors(this.ang, _r).add(this.vel);
        const vn = pvel.dot(n);
        if (vn >= 0) continue;
        const rxn = new THREE.Vector3().crossVectors(_r, n);
        const k = 1 / CAR.mass + rxn.clone().applyMatrix3(_mInvI).dot(rxn);
        const e = 0.18;
        const j = -(1 + e) * vn / k;
        this.vel.addScaledVector(n, j / CAR.mass);
        this.ang.add(rxn.applyMatrix3(_mInvI).multiplyScalar(j));
        // scrape: kill some tangential speed too
        this.vel.multiplyScalar(0.985);
        this.events.impact = Math.max(this.events.impact, clamp(-vn / 9, 0, 1));
      }
    }
  }

  unflip() {
    const e = new THREE.Euler().setFromQuaternion(this.quat, 'YXZ');
    this.quat.setFromEuler(new THREE.Euler(0, e.y, 0, 'YXZ'));
    this.pos.y = this.world.terrain.heightAt(this.pos.x, this.pos.z) + 1.2;
    this.vel.set(0, 0, 0); this.ang.set(0, 0, 0);
  }
}
