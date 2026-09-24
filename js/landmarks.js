// Everything people left behind in Ulu Sungai Gelap: the empty kampung, the
// estate, the sawmill, camps, wrecks, the shrine, bridges and power lines.
// Parts are merged per material so a whole place is a handful of draw calls.
// Solid parts get circle colliders in the same grid as tree trunks.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { psxify } from './psx.js';
import { dappleHook } from './sky.js';
import { mulberry32 } from './noise.js';
import { ROAD } from './terrain.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

class Builder {
  constructor() { this.parts = new Map(); }
  add(mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const m = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), V(sx, sy, sz));
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return this;
  }
  bar(mat, a, b, r, sides = 5) {
    const d = new THREE.Vector3().subVectors(b, a);
    const g = new THREE.CylinderGeometry(r, r, d.length(), sides);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.clone().normalize());
    g.applyQuaternion(q);
    const c = a.clone().addScaledVector(d, 0.5);
    return this.add(mat, g, c.x, c.y, c.z);
  }
  build() {
    const g = new THREE.Group();
    for (const [mat, list] of this.parts) g.add(new THREE.Mesh(mergeGeometries(list), mat));
    return g;
  }
}

function signTexture(big, small, bg = '#e8e2cf', ink = '#23201a', band = '#8a3a24') {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 128, 64);
  g.fillStyle = band; g.fillRect(0, 0, 128, 6); g.fillRect(0, 58, 128, 6);
  g.fillStyle = ink; g.textAlign = 'center';
  g.font = `bold ${big.length > 8 ? 17 : 22}px monospace`; g.fillText(big, 64, 31);
  g.font = 'bold 11px monospace'; g.fillText(small, 64, 49);
  let a = 7; const r = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(60,50,30,${r() * 0.4})`; g.fillRect(r() * 128, r() * 64, 2, 2); }
  for (let i = 0; i < 5; i++) { g.fillStyle = 'rgba(90,40,20,.5)'; g.fillRect(r() * 128, r() * 30, 1, 10 + r() * 30); } // rust runs
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function stripeTexture() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 4;
  const g = c.getContext('2d');
  for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#e8e2cf' : '#a8321f'; g.fillRect(i * 4, 0, 4, 4); }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildLandmarks(scene, world, tex) {
  const T = world.terrain, grid = world.treeGrid;
  const rnd = mulberry32(404);
  const L = (o) => psxify(new THREE.MeshLambertMaterial(o), dappleHook, 'd');
  const M = {
    planks: L({ map: tex.planks }),
    blue: L({ map: tex.planks, color: 0x8fa9b8 }),
    green: L({ map: tex.planks, color: 0x9bb08a }),
    pink: L({ map: tex.planks, color: 0xc89a92 }),
    white: L({ map: tex.planks, color: 0xd8d2c0 }),
    rust: L({ map: tex.rust, side: THREE.DoubleSide }),
    lime: L({ map: tex.lime }),
    paint: L({ map: tex.paint }),
    concrete: L({ map: tex.lime, color: 0x9a978c }),
    log: world.mats.log,
    rock: world.mats.rock,
    dark: L({ color: 0x141412 }),
    tyre: L({ color: 0x1a1a18 }),
    red: L({ color: 0x8e1f16, side: THREE.DoubleSide }),
    cloth: L({ color: 0xb8b0a0, side: THREE.DoubleSide }),
    doll: L({ color: 0xcdb8a0 }),
    stripe: L({ map: stripeTexture() }),
    metal: L({ color: 0x5c5f5a }),
  };
  const sign = (big, small, bg, ink, band) => L({ map: signTexture(big, small, bg, ink, band) });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 7);
  const plane = new THREE.PlaneGeometry(1, 1);
  const groups = [];
  const animated = [];
  const collide = (x, z, r) => grid.add({ x, z, r });
  const gy = (x, z) => T.groundAt(x, z);
  const finish = (b) => { const g = b.build(); scene.add(g); groups.push(g); return g; };
  // local frame helper: origin (ox, oz), local +x along angle a
  const frame = (ox, oz, a) => (lx, lz) => [ox + lx * Math.cos(a) - lz * Math.sin(a), oz + lx * Math.sin(a) + lz * Math.cos(a)];

  // a raised house on stilts, doors open, in world coords
  function house(b, cx, cz, a, { w = 6, d = 5, stilt = 1.3, wall = M.planks, roof = M.rust, ruin = false, h = 2.3 } = {}) {
    const P = frame(cx, cz, a), y0 = gy(cx, cz), ry = -a;
    const put = (mat, lx, ly, lz, sx, sy, sz, rx = 0, rz = 0) => { const [x, z] = P(lx, lz); b.add(mat, box, x, y0 + ly, z, rx, ry, rz, sx, sy, sz); };
    for (let sx = -w / 2 + 0.2; sx <= w / 2 - 0.1; sx += (w - 0.4) / 2) for (const sz of [-d / 2 + 0.2, d / 2 - 0.2]) put(M.planks, sx, stilt / 2 - 0.3, sz, 0.2, stilt + 0.6, 0.2);
    put(M.planks, 0, stilt, 0, w, 0.15, d);
    const top = stilt + 0.08;
    put(wall, 0, top + h / 2, -d / 2, w, h, 0.1);
    put(wall, -w / 2, top + h / 2, 0, 0.1, h, d);
    if (!ruin) put(wall, w / 2, top + h / 2, 0, 0.1, h, d); else put(wall, w / 2, top + h * 0.3, -d / 4, 0.1, h * 0.6, d / 2);
    put(wall, -w / 4 - 0.45, top + h / 2, d / 2, w / 2 - 0.9, h, 0.1);
    put(wall, w / 4 + 0.45, top + h / 2, d / 2, w / 2 - 0.9, h, 0.1);
    put(wall, 0, top + h - 0.25, d / 2, 1.8, 0.5, 0.1);
    put(M.dark, 0, top + h / 2 - 0.25, d / 2 - 0.35, 1.7, h - 0.5, 0.05); // the dark inside, through the open door
    // the door itself, hanging open
    put(wall, 0.95, top + (h - 0.5) / 2, d / 2 + 0.45, 0.06, h - 0.5, 0.9);
    // window holes
    put(M.dark, -w / 2 - 0.01, top + h * 0.6, 0, 0.04, 0.7, 1.0);
    // roof: two sheets, the ruin's sagging
    put(roof, 0, top + h + 0.55, -d / 4 - 0.1, w + 0.8, 0.05, d / 2 + 0.7, 0.55, 0);
    put(roof, 0, top + h + (ruin ? 0.0 : 0.55), d / 4 + 0.1, w + 0.8, 0.05, d / 2 + 0.7, ruin ? -1.0 : -0.55, 0);
    for (let i = 0; i < 3; i++) put(M.planks, 0, stilt - 0.35 - i * 0.35, d / 2 + 0.5 + i * 0.35, 1.1, 0.08, 0.32);
    for (const lx of [-w / 4, w / 4]) { const [x, z] = P(lx, 0); collide(x, z, Math.max(w, d) / 3.2); }
  }

  const plankSign = (b, mat, x, z, a, height = 1.8) => {
    const y = gy(x, z), P = frame(x, z, a);
    const [p1x, p1z] = P(-0.8, 0), [p2x, p2z] = P(0.8, 0);
    b.add(M.planks, box, p1x, y + height / 2, p1z, 0, -a, 0, 0.12, height + 0.6, 0.12);
    b.add(M.planks, box, p2x, y + height / 2, p2z, 0, -a, 0, 0.12, height + 0.6, 0.12);
    b.add(mat, plane, x, y + height - 0.1, z, 0, -a + Math.PI / 2, 0, 2.2, 1.1, 1);
    b.add(mat, plane, x, y + height - 0.1, z, 0, -a - Math.PI / 2, 0, 2.2, 1.1, 1);
    collide(x, z, 0.9);
  };

  // red cloth tied round a trunk or a post: someone marked this place
  const redTie = (b, x, z, r = 0.25) => {
    const y = gy(x, z);
    b.add(M.planks, cyl, x, y + 1.5, z, 0, 0, 0, r * 0.8, 3.2, r * 0.8);
    b.add(M.red, cyl, x, y + 1.6, z, 0, 0, 0, r, 0.25, r);
    b.add(M.red, plane, x + r, y + 1.3, z, 0, rnd() * 6, 0.2, 0.15, 0.6, 1);
    collide(x, z, r + 0.1);
  };

  const sites = T.sites;
  const byType = (t) => sites.filter((s) => s.type === t);

  // ---- the kampung -------------------------------------------------------------------
  for (const s of byType('village')) {
    const b = new Builder();
    const road = s.road, n = road.length;
    const cols = [M.blue, M.green, M.pink, M.white, M.planks];
    for (let i = 0; i < 9; i++) {
      const f = 0.22 + i * 0.075;
      const k = Math.floor(n * f), p = road[k], q = road[Math.min(n - 1, k + 1)];
      const a = Math.atan2(q[1] - p[1], q[0] - p[0]);
      const side = i % 2 ? 1 : -1, off = 13 + rnd() * 5;
      const x = p[0] - Math.sin(a) * off * side, z = p[1] + Math.cos(a) * off * side;
      house(b, x, z, a + (side > 0 ? Math.PI : 0), { wall: cols[i % cols.length], ruin: rnd() < 0.3, w: 6 + rnd() * 2, d: 5 + rnd() });
      // washing line in front of some
      if (rnd() < 0.5) {
        const P = frame(x, z, a + (side > 0 ? Math.PI : 0)), y = gy(x, z);
        const [ax, az] = P(-3, 5.5), [bx, bz] = P(3, 5.5);
        b.bar(M.planks, V(ax, y - 0.3, az), V(ax, y + 2.2, az), 0.05).bar(M.planks, V(bx, y - 0.3, bz), V(bx, y + 2.2, bz), 0.05);
        b.bar(M.metal, V(ax, y + 2.1, az), V(bx, y + 2.1, bz), 0.01, 3);
        for (let c = 0; c < 3; c++) {
          const t = 0.2 + c * 0.3, cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
          const cloth = new THREE.Mesh(plane, c === 1 ? M.red : M.cloth);
          cloth.geometry = plane.clone().translate(0, -0.45, 0);
          cloth.position.set(cx, y + 2.1, cz); cloth.rotation.y = -Math.atan2(bz - az, bx - ax); cloth.scale.set(0.7, 0.9, 1);
          scene.add(cloth);
          animated.push((t2) => { cloth.rotation.x = Math.sin(t2 * 1.3 + c * 2) * 0.25 + Math.sin(t2 * 0.37) * 0.15; });
          groups.push(cloth);
        }
      }
    }
    // longhouse at the far end of the street
    {
      const p = road[Math.floor(n * 0.9)], q = road[n - 1];
      const a = Math.atan2(q[1] - p[1], q[0] - p[0]);
      const x = p[0] - Math.sin(a) * 20, z = p[1] + Math.cos(a) * 20;
      const P = frame(x, z, a), y = gy(x, z);
      for (let lx = -15; lx <= 15; lx += 3) for (const lz of [-4, 0, 4, 7]) { const [px, pz] = P(lx, lz); b.add(M.planks, box, px, y + 0.8, pz, 0, -a, 0, 0.22, 2.2, 0.22); }
      const put = (mat, lx, ly, lz, sx, sy, sz, rx = 0) => { const [px, pz] = P(lx, lz); b.add(mat, box, px, y + ly, pz, rx, -a, 0, sx, sy, sz); };
      put(M.planks, 0, 1.9, 1.5, 32, 0.15, 12);            // floor + open ruai (veranda)
      put(M.planks, 0, 3.2, -4.2, 32, 2.6, 0.12);          // back wall
      put(M.planks, 0, 3.2, 1.2, 32, 2.6, 0.12);           // front wall of the rooms
      for (let lx = -14; lx <= 14; lx += 4) put(M.dark, lx, 2.9, 1.28, 1.0, 1.9, 0.04); // doors, all open
      put(M.planks, 0, 2.4, 7.4, 32, 0.9, 0.1);             // veranda rail
      put(M.rust, 0, 5.2, -1.5, 34, 0.06, 7.5, 0.35);
      put(M.rust, 0, 5.0, 4.6, 34, 0.06, 6.5, -0.3);
      for (let lx = -12; lx <= 12; lx += 8) { const [px, pz] = P(lx, 0); collide(px, pz, 4.2); }
      for (let lx = -12; lx <= 12; lx += 8) { const [px, pz] = P(lx, 5); collide(px, pz, 3.2); }
    }
    // the shop at the start of the street
    {
      const p = road[Math.floor(n * 0.14)], q = road[Math.floor(n * 0.14) + 1];
      const a = Math.atan2(q[1] - p[1], q[0] - p[0]);
      const x = p[0] + Math.sin(a) * 11, z = p[1] - Math.cos(a) * 11;
      house(b, x, z, a, { wall: M.white, stilt: 0.4, w: 7, d: 6 });
      const P = frame(x, z, a), y = gy(x, z);
      const [sx, sz] = P(0, 3.3);
      b.add(sign('KEDAI', 'RUNCIT  AH SENG', '#d8c24a', '#23201a', '#23201a'), plane, sx, y + 3.3, sz, 0, -a + Math.PI, 0, 3.4, 0.9, 1);
    }
    // water tank on legs, a swing that moves by itself
    {
      const p = road[Math.floor(n * 0.5)], q = road[Math.floor(n * 0.5) + 1];
      const a = Math.atan2(q[1] - p[1], q[0] - p[0]);
      const P = frame(p[0], p[1], a);
      const [tx, tz] = P(0, 26), ty = gy(tx, tz);
      for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.bar(M.rust, V(tx + lx, ty - 0.5, tz + lz), V(tx + lx * 0.8, ty + 6, tz + lz * 0.8), 0.07);
      b.add(M.rust, cyl, tx, ty + 7, tz, 0, 0, 0, 1.4, 2, 1.4);
      collide(tx, tz, 1.5);
      const [wx, wz] = P(8, -22), wy = gy(wx, wz);
      b.bar(M.metal, V(wx - 1.2, wy - 0.3, wz - 0.8), V(wx - 1.2, wy + 2.6, wz), 0.05).bar(M.metal, V(wx - 1.2, wy - 0.3, wz + 0.8), V(wx - 1.2, wy + 2.6, wz), 0.05);
      b.bar(M.metal, V(wx + 1.2, wy - 0.3, wz - 0.8), V(wx + 1.2, wy + 2.6, wz), 0.05).bar(M.metal, V(wx + 1.2, wy - 0.3, wz + 0.8), V(wx + 1.2, wy + 2.6, wz), 0.05);
      b.bar(M.metal, V(wx - 1.2, wy + 2.6, wz), V(wx + 1.2, wy + 2.6, wz), 0.05);
      const swing = new THREE.Group();
      swing.position.set(wx, wy + 2.6, wz);
      const sb = new Builder();
      sb.bar(M.metal, V(-0.3, 0, 0), V(-0.3, -2.1, 0), 0.015, 3).bar(M.metal, V(0.3, 0, 0), V(0.3, -2.1, 0), 0.015, 3);
      sb.add(M.planks, box, 0, -2.1, 0, 0, 0, 0, 0.8, 0.05, 0.3);
      swing.add(sb.build());
      scene.add(swing); groups.push(swing);
      animated.push((t) => { swing.rotation.x = Math.sin(t * 1.9) * 0.35 * (0.6 + 0.4 * Math.sin(t * 0.13)); });
      collide(wx, wz, 1.3);
    }
    // name board at the entrance
    {
      const p = road[4], q = road[5], a = Math.atan2(q[1] - p[1], q[0] - p[0]);
      plankSign(b, sign('KG. LONG', 'GELAP', '#2f5a3a', '#e8e2cf', '#e8e2cf'), p[0] + Math.sin(a) * 6, p[1] - Math.cos(a) * 6, a);
    }
    finish(b);
  }

  // ---- football field --------------------------------------------------------------
  for (const s of byType('field')) {
    const b = new Builder(), P = frame(s.x, s.z, s.a), y = gy(s.x, s.z);
    for (const end of [-1, 1]) {
      const [a1x, a1z] = P(end * 18, -3), [a2x, a2z] = P(end * 18, 3);
      b.bar(M.white, V(a1x, y - 0.2, a1z), V(a1x, y + 2.2, a1z), 0.06).bar(M.white, V(a2x, y - 0.2, a2z), V(a2x, y + 2.2, a2z), 0.06);
      b.bar(M.white, V(a1x, y + 2.2, a1z), V(a2x, y + 2.2, a2z), 0.06);
      collide(a1x, a1z, 0.2); collide(a2x, a2z, 0.2);
    }
    finish(b);
  }

  // ---- oil palm estate: entrance sign and a guard hut ---------------------------------------
  for (const s of byType('plantation')) {
    const b = new Builder(), p = s.plant;
    plankSign(b, sign('LADANG', 'SAWIT  BLOK 7', '#8a3a24', '#e8e2cf', '#e8e2cf'), p.x + 6, p.z1 + 5, 0);
    house(b, p.x - 12, p.z1 + 9, 0, { stilt: 0.3, w: 4, d: 3.5, wall: M.planks });
    finish(b);
  }

  // ---- telecom mast -------------------------------------------------------------------
  for (const s of byType('telecom')) {
    const b = new Builder(), y = gy(s.x, s.z), H = 32;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.bar(M.metal, V(s.x + sx * 1.6, y - 0.5, s.z + sz * 1.6), V(s.x + sx * 0.3, y + H, s.z + sz * 0.3), 0.07);
    for (let lvl = 0; lvl < 8; lvl++) {
      const t0 = lvl / 8, t1 = (lvl + 1) / 8, w0 = 1.6 - 1.3 * t0, w1 = 1.6 - 1.3 * t1;
      for (const [a0, a1] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) {
        b.bar(M.metal, V(s.x + a0[0] * w0, y + t0 * H, s.z + a0[1] * w0), V(s.x + a1[0] * w1, y + t1 * H, s.z + a1[1] * w1), 0.03, 3);
      }
    }
    for (let i = 0; i < 3; i++) b.add(M.white, cyl, s.x + Math.cos(i * 2.1) * 0.6, y + H - 3 - i * 2, s.z + Math.sin(i * 2.1) * 0.6, Math.PI / 2, i * 2.1, 0, 0.45, 0.2, 0.45);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) collide(s.x + sx * 1.5, s.z + sz * 1.5, 0.3);
    // equipment hut and a sagging fence
    b.add(M.concrete, box, s.x + 7, y + 1.3, s.z, 0, 0.2, 0, 3.5, 2.6, 3);
    b.add(M.dark, box, s.x + 5.2, y + 1.1, s.z, 0, 0.2, 0, 0.05, 2.0, 1.0);
    collide(s.x + 7, s.z, 2.1);
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2, fx = s.x + Math.cos(a) * 11, fz = s.z + Math.sin(a) * 11;
      if (i === 4 || i === 5) continue; // gap where the gate fell
      b.bar(M.metal, V(fx, gy(fx, fz) - 0.3, fz), V(fx, gy(fx, fz) + 2.0 - (i % 3) * 0.3, fz), 0.04, 3);
      collide(fx, fz, 0.15);
    }
    // warning light on top, dead
    b.add(M.red, box, s.x, y + H + 0.3, s.z, 0, 0, 0, 0.3, 0.3, 0.3);
    finish(b);
  }

  // ---- lookout tower -----------------------------------------------------------------
  for (const s of byType('tower')) {
    const b = new Builder(), y = gy(s.x, s.z), H = 13;
    const leg = (sx, sz, t) => V(s.x + sx * (2.1 - t * 0.9), y - 1 + t * (H + 1), s.z + sz * (2.1 - t * 0.9));
    const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sz] of C) b.bar(M.rust, leg(sx, sz, 0), leg(sx, sz, 1), 0.09);
    for (let lvl = 0; lvl < 3; lvl++) {
      const t0 = 0.12 + lvl * 0.28, t1 = t0 + 0.28;
      for (let i = 0; i < 4; i++) { const [ax, az] = C[i], [bx, bz] = C[(i + 1) % 4]; b.bar(M.rust, leg(ax, az, t0), leg(bx, bz, t1), 0.04); b.bar(M.rust, leg(bx, bz, t0), leg(ax, az, t1), 0.04); }
    }
    b.add(M.planks, box, s.x, y + H + 0.1, s.z, 0, 0, 0, 3.4, 0.2, 3.4);
    b.add(M.planks, box, s.x, y + H + 0.6, s.z - 1.65, 0, 0, 0, 3.3, 1.0, 0.08);
    b.add(M.rust, new THREE.ConeGeometry(2.8, 1.5, 4, 1), s.x, y + H + 2.8, s.z, 0, Math.PI / 4, 0);
    for (const [sx, sz] of C) { b.add(M.planks, box, s.x + sx * 1.6, y + H + 1.1, s.z + sz * 1.6, 0, 0, 0, 0.12, 2, 0.12); collide(s.x + sx * 2.0, s.z + sz * 2.0, 0.3); }
    finish(b);
  }

  // ---- sawmill ----------------------------------------------------------------------
  for (const s of byType('sawmill')) {
    const b = new Builder(), P = frame(s.x, s.z, s.a), y = gy(s.x, s.z);
    const put = (mat, geo, lx, ly, lz, sx, sy, sz, rx = 0, rz = 0) => { const [px, pz] = P(lx, lz); b.add(mat, geo, px, y + ly, pz, rx, -s.a, rz, sx, sy, sz); };
    for (let lx = -10; lx <= 10; lx += 5) for (const lz of [-6, 6]) { put(M.planks, box, lx, 2.6, lz, 0.3, 5.6, 0.3); const [px, pz] = P(lx, lz); collide(px, pz, 0.35); }
    put(M.rust, box, 0, 5.8, -3.2, 22, 0.06, 7, 0.28);
    put(M.rust, box, 0, 5.8, 3.2, 22, 0.06, 7, -0.28);
    put(M.planks, box, 0, 0.5, 0, 12, 1.0, 2.2);            // saw bench
    put(M.metal, cyl, 1.5, 1.4, 0, 0.9, 0.04, 0.9, Math.PI / 2); // the blade
    put(M.log, cyl, -3, 1.35, 0, 0.45, 7, 0.45, 0, Math.PI / 2); // a log still on the bench
    for (let lx = -4; lx <= 4; lx += 4) { const [px, pz] = P(lx, 0); collide(px, pz, 1.3); }
    // sawdust heap and stacked planks
    put(M.planks, new THREE.ConeGeometry(3, 1.8, 7), 13, 0.9, 6, 1, 1, 1);
    for (let i = 0; i < 6; i++) put(M.planks, box, -14, 0.15 + i * 0.22, -2 + (i % 2) * 0.1, 5, 0.18, 2);
    { const [px, pz] = P(13, 6); collide(px, pz, 2.6); const [qx, qz] = P(-14, -2); collide(qx, qz, 1.8); }
    const [sx, sz] = P(0, -14);
    plankSign(b, sign('KILANG', 'PAPAN  SG. GELAP'), sx, sz, s.a);
    finish(b);
  }

  // ---- quarry: grey rubble and a rusted digger -----------------------------------------------
  for (const s of byType('quarry')) {
    const b = new Builder(), P = frame(s.x, s.z, s.a);
    const rock = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < 10; i++) {
      const [x, z] = P((rnd() - 0.5) * 30, (rnd() - 0.5) * 24), r = 1 + rnd() * 2.2;
      b.add(M.lime, rock, x, gy(x, z) + r * 0.3, z, rnd(), rnd() * 6, 0, r, r * 0.7, r);
      collide(x, z, r * 0.9);
    }
    const [dx, dz] = P(6, -6), dy = gy(dx, dz);
    b.add(M.paint, box, dx, dy + 1.6, dz, 0, -s.a, 0, 3, 1.8, 2.4);
    b.add(M.tyre, box, dx, dy + 0.45, dz - 1.2, 0, -s.a, 0, 3.6, 0.9, 0.6).add(M.tyre, box, dx, dy + 0.45, dz + 1.2, 0, -s.a, 0, 3.6, 0.9, 0.6);
    b.bar(M.paint, V(dx + 1, dy + 2.4, dz), V(dx + 4, dy + 4.2, dz + 0.5), 0.2).bar(M.paint, V(dx + 4, dy + 4.2, dz + 0.5), V(dx + 5.5, dy + 0.6, dz + 1), 0.16);
    collide(dx, dz, 2.2);
    finish(b);
  }

  // ---- logging camps, landings, hut --------------------------------------------------
  for (const s of byType('camp')) {
    const b = new Builder(), P = frame(s.x, s.z, s.a);
    const [h1x, h1z] = P(-6, 5), [h2x, h2z] = P(4, 8), [h3x, h3z] = P(-1, -7);
    house(b, h1x, h1z, s.a + 0.1, {}); house(b, h2x, h2z, s.a - 0.35, { ruin: true }); house(b, h3x, h3z, s.a + Math.PI + 0.2, {});
    for (let i = 0; i < 5; i++) { const [x, z] = P(8 + (i % 3) * 0.7, -4 - Math.floor(i / 3) * 0.7); b.add(M.rust, cyl, x, gy(x, z) + 0.45, z, 0, 0, 0, 0.3, 0.9, 0.3); }
    { const [x, z] = P(8.7, -4.3); collide(x, z, 1.3); }
    const [sx, sz] = P(-10, 0);
    plankSign(b, sign('KEM 3', 'SG. GELAP TIMBER'), sx, sz, s.a + Math.PI / 2);
    finish(b);
  }
  for (const s of byType('landing')) {
    const b = new Builder(), P = frame(s.x, s.z, s.a);
    const pile = (lx, lz, rot) => {
      [4, 3, 2].forEach((n, row) => { for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * 0.95, [x, z] = P(lx - off * Math.sin(rot), lz + off * Math.cos(rot));
        b.add(M.log, cyl, x, gy(x, z) + 0.45 + row * 0.8, z, 0, -(s.a + rot), Math.PI / 2, 0.47 + rnd() * 0.08, 9 + rnd(), 0.47 + rnd() * 0.08);
      } });
      for (const t of [-3, 0, 3]) { const [x, z] = P(lx + t * Math.cos(rot), lz + t * Math.sin(rot)); collide(x, z, 2.0); }
    };
    pile(-4, -6, 0.1); pile(6, 4, -0.2);
    finish(b);
  }
  for (const s of byType('hut')) {
    const b = new Builder();
    house(b, s.x, s.z, s.a, { stilt: 0.3, w: 3.6, d: 3, h: 2, wall: M.planks, ruin: true });
    // skulls on strings under the eaves
    const P = frame(s.x, s.z, s.a), y = gy(s.x, s.z);
    for (let i = 0; i < 4; i++) { const [x, z] = P(-1.4 + i * 0.9, 2.1); b.bar(M.metal, V(x, y + 2.2, z), V(x, y + 1.6, z), 0.01, 3); b.add(M.white, box, x, y + 1.5, z, 0, rnd(), 0, 0.2, 0.18, 0.25); }
    finish(b);
  }

  // ---- wrecks -------------------------------------------------------------------------
  for (const s of byType('truck')) {
    const b = new Builder(), P = frame(s.x, s.z, s.a), y = gy(s.x, s.z) - 0.25;
    const put = (mat, geo, lx, ly, lz, sx, sy, sz, rz = 0, rx = 0) => { const [px, pz] = P(lx, lz); b.add(mat, geo, px, y + ly, pz, rx, -s.a, rz, sx, sy, sz); };
    put(M.rust, box, 0, 0.95, 0, 7.2, 0.35, 1.6);
    put(M.paint, box, 2.6, 2.0, 0, 1.9, 1.7, 2.2);
    put(M.paint, box, 4.1, 1.55, 0, 1.3, 0.9, 1.9, -0.05);
    put(M.dark, box, 3.62, 2.25, 0, 0.05, 0.7, 1.9);
    for (const [lx, lz] of [[3.3, -1], [-1.6, -1], [-1.6, 1], [-2.8, -1], [-2.8, 1]]) put(M.tyre, cyl, lx, 0.55, lz, 0.55, 0.4, 0.55, 0, Math.PI / 2);
    put(M.log, cyl, -2, 1.55, -0.4, 0.45, 6.5, 0.45, Math.PI / 2);
    for (const lx of [-3, -0.5, 2, 4]) { const [px, pz] = P(lx, 0); collide(px, pz, 1.35); }
    finish(b);
  }
  for (const s of byType('dozer')) {
    const b = new Builder(), P = frame(s.x, s.z, s.a), y = gy(s.x, s.z) - 0.15;
    const put = (mat, lx, ly, lz, sx, sy, sz, rz = 0) => { const [px, pz] = P(lx, lz); b.add(mat, box, px, y + ly, pz, 0, -s.a, rz, sx, sy, sz); };
    put(M.paint, 0, 1.5, 0, 3.4, 1.4, 2.2);
    put(M.paint, -0.8, 2.8, 0, 1.6, 1.4, 1.8);
    put(M.dark, -0.8, 2.9, 0, 1.62, 0.8, 1.6);
    put(M.tyre, 0, 0.5, -1.35, 4, 1.0, 0.7); put(M.tyre, 0, 0.5, 1.35, 4, 1.0, 0.7);
    put(M.rust, 2.6, 0.9, 0, 0.25, 1.4, 3.6, 0.15);
    for (const lx of [-1.2, 1.4]) { const [px, pz] = P(lx, 0); collide(px, pz, 1.8); }
    finish(b);
  }
  for (const s of byType('plane')) {
    const b = new Builder(), P = frame(s.x, s.z, s.a), y = gy(s.x, s.z);
    const put = (mat, geo, lx, ly, lz, sx, sy, sz, rx = 0, ry = 0, rz = 0) => { const [px, pz] = P(lx, lz); b.add(mat, geo, px, y + ly, pz, rx, -s.a + ry, rz, sx, sy, sz); };
    put(M.white, cyl, 0, 1.1, 0, 1.2, 8, 1.2, 0, 0, Math.PI / 2 + 0.08);          // front half of the fuselage
    put(M.dark, cyl, 4.05, 1.4, 0, 1.1, 0.05, 1.1, 0, 0, Math.PI / 2);            // the torn open end
    put(M.white, cyl, -7.5, 0.8, 2.5, 0.9, 6, 0.9, 0, 0.5, Math.PI / 2 - 0.1);    // tail section, snapped off
    put(M.white, box, -10, 2.4, 3.8, 0.12, 2.6, 1.8, 0, 0.5, 0.2);                // tail fin
    put(M.white, box, 1, 0.6, -5.5, 2.2, 0.15, 7, 0, 0.1, -0.12);                  // wing
    put(M.dark, box, -2.8, 1.4, 1.2, 0.05, 0.5, 0.7, 0, 0, 0);                     // windows
    put(M.dark, box, -1.2, 1.4, 1.22, 0.05, 0.5, 0.7, 0, 0, 0);
    for (const [lx, lz, r] of [[-2, 0, 1.5], [2, 0, 1.5], [-7, 2.3, 1.2], [1, -5, 1.2], [1, -8, 1]]) { const [px, pz] = P(lx, lz); collide(px, pz, r); }
    // dolls hanging from the trees around it
    for (let i = 0; i < 6; i++) {
      const a = i * 1.1 + rnd(), d = 9 + rnd() * 6, x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d, dy = gy(x, z);
      b.bar(M.planks, V(x, dy - 0.3, z), V(x, dy + 4.5, z), 0.18);
      collide(x, z, 0.25);
      const doll = new THREE.Group();
      doll.position.set(x + 0.5, dy + 3.4, z);
      const db = new Builder();
      db.bar(M.metal, V(0, 0.9, 0), V(0, 0.2, 0), 0.008, 3);
      db.add(M.doll, box, 0, 0, 0, 0, 0, 0, 0.18, 0.35, 0.1).add(M.doll, box, 0, 0.24, 0, 0, 0, 0, 0.14, 0.14, 0.12);
      db.add(M.red, box, 0, -0.05, 0, 0, 0, 0, 0.2, 0.2, 0.11);
      doll.add(db.build());
      scene.add(doll); groups.push(doll);
      animated.push((t) => { doll.rotation.y = Math.sin(t * 0.4 + i) * 1.2; doll.rotation.z = Math.sin(t * 0.9 + i * 2) * 0.08; });
    }
    finish(b);
  }

  // ---- limestone and the cave -----------------------------------------------------------
  for (const s of byType('karst')) {
    const b = new Builder(), rock = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < 9; i++) {
      const lx = (rnd() - 0.5) * 30, lz = (rnd() - 0.5) * 30, w = 2.5 + rnd() * 3, h = 8 + rnd() * 16;
      const x = s.x + lx, z = s.z + lz;
      if (Math.hypot(lx, lz) < 7) continue;
      b.add(M.lime, rock, x, gy(x, z) + h * 0.35, z, (rnd() - 0.5) * 0.2, rnd() * 6, 0, w, h, w * (0.8 + rnd() * 0.4));
      collide(x, z, w * 0.85);
    }
    // the cave: a big rock mass with a black mouth
    const P = frame(s.x, s.z, s.a), [cx, cz] = P(0, -6), cy = gy(cx, cz);
    b.add(M.lime, rock, cx, cy + 5, cz, 0, s.a, 0, 9, 9, 6);
    const [mx, mz] = P(0, -0.4);
    b.add(M.dark, plane, mx, cy + 1.8, mz, 0, -s.a + Math.PI / 2 * 0 + Math.PI, 0, 3.6, 3.4, 1);
    b.add(M.dark, plane, mx, cy + 1.8, mz, 0, -s.a, 0, 3.6, 3.4, 1);
    for (const lx of [-5, 0, 5]) { const [px, pz] = P(lx, -6); collide(px, pz, 4.2); }
    finish(b);
  }

  // ---- the shrine: a spirit house on a post, offerings, red cloth all around ----------------------
  for (const s of byType('shrine')) {
    const b = new Builder(), y = gy(s.x, s.z);
    b.add(M.planks, box, s.x, y + 0.7, s.z, 0, s.a, 0, 0.18, 1.6, 0.18);
    b.add(M.red, box, s.x, y + 1.7, s.z, 0, s.a, 0, 0.9, 0.7, 0.7);
    b.add(M.rust, new THREE.ConeGeometry(0.75, 0.6, 4), s.x, y + 2.35, s.z, 0, s.a + Math.PI / 4, 0);
    b.add(M.dark, box, s.x + 0.46 * Math.cos(s.a), y + 1.65, s.z - 0.46 * Math.sin(s.a), 0, s.a, 0, 0.02, 0.4, 0.3);
    for (let i = 0; i < 5; i++) b.add(M.white, cyl, s.x + Math.cos(i) * 0.9, y + 0.08, s.z + Math.sin(i) * 0.9, 0, 0, 0, 0.12, 0.12, 0.12);
    collide(s.x, s.z, 0.6);
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 + rnd() * 0.4, d = 4 + rnd() * 4; redTie(b, s.x + Math.cos(a) * d, s.z + Math.sin(a) * d, 0.2 + rnd() * 0.2); }
    finish(b);
  }

  // ---- closed roads at the edge: barrier, sign, landslide ---------------------------------
  for (const s of byType('gate')) {
    const b = new Builder(), P = frame(s.x, s.z, s.a), y = gy(s.x, s.z);
    const [l1x, l1z] = P(0, -3.5), [l2x, l2z] = P(0, 3.5);
    b.bar(M.stripe, V(l1x, y - 0.3, l1z), V(l1x, y + 1.3, l1z), 0.1).bar(M.stripe, V(l2x, y - 0.3, l2z), V(l2x, y + 1.3, l2z), 0.1);
    b.bar(M.stripe, V(l1x, y + 1.1, l1z), V(l2x, y + 1.1, l2z), 0.08);
    for (let t = -3.5; t <= 3.5; t += 1.2) { const [x, z] = P(0.3, t); collide(x, z, 0.7); }
    const [sx, sz] = P(-3, -5.5);
    plankSign(b, sign('JALAN', 'DITUTUP  -  JANGAN MASUK', '#d8c24a', '#23201a', '#23201a'), sx, sz, s.a + Math.PI / 2);
    // landslide beyond: rock and dead trees across the road
    const rock = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < 12; i++) {
      const [x, z] = P(6 + rnd() * 14, (rnd() - 0.5) * 12), r = 1 + rnd() * 1.8;
      b.add(M.rock, rock, x, gy(x, z) + r * 0.4, z, rnd(), rnd() * 6, 0, r, r * 0.8, r);
      collide(x, z, r);
    }
    for (let i = 0; i < 4; i++) { const [x, z] = P(9 + i * 3, (rnd() - 0.5) * 6); b.add(M.log, cyl, x, gy(x, z) + 0.5, z, 0, rnd() * 3, Math.PI / 2, 0.45, 12, 0.45); collide(x, z, 1); }
    finish(b);
  }

  // ---- bridges ------------------------------------------------------------------------
  for (const br of T.bridges) {
    const b = new Builder(), d = br.deck, a = br.a;
    const P = frame(br.x, br.z, a);
    const segs = 14, seg = br.len / segs;
    for (let i = 0; i < segs; i++) {
      const u0 = -br.len / 2 + i * seg, u1 = u0 + seg, y0 = T.deckY(d, u0), y1 = T.deckY(d, u1);
      const [x, z] = P((u0 + u1) / 2, 0);
      b.add(M.planks, box, x, (y0 + y1) / 2 - 0.08, z, 0, -a, Math.atan2(y1 - y0, seg), seg / Math.cos(Math.atan2(y1 - y0, seg)) + 0.02, 0.16, br.w);
    }
    for (let u = -br.len / 2 + 2; u <= br.len / 2 - 2; u += 3) {
      const top = T.deckY(d, u);
      for (const side of [-1, 1]) {
        const [x, z] = P(u, side * (br.w / 2 - 0.1)), g = T.groundAt(x, z);
        if (top - g > 0.5) b.bar(M.log, V(x, g - 0.6, z), V(x, top, z), 0.16);
        const [rx, rz] = P(u, side * br.w / 2);
        b.add(M.planks, box, rx, top + 0.45, rz, 0, -a, 0, 0.12, 0.9, 0.12);
      }
    }
    for (const side of [-1, 1]) {
      const pts = [];
      for (let u = -br.len / 2 + 2; u <= br.len / 2 - 2 + 0.01; u += (br.len - 4) / 10) { const [x, z] = P(u, side * br.w / 2); pts.push(V(x, T.deckY(d, u) + 0.85, z)); }
      for (let i = 0; i < pts.length - 1; i++) if (!(side === 1 && i === 6)) b.bar(M.planks, pts[i], pts[i + 1], 0.05, 4);
    }
    finish(b);
  }

  // ---- power line along the tarmac and the loop near the village ------------------------------
  {
    const b = new Builder();
    const wires = [];
    const village = byType('village')[0];
    for (const r of T.roads) {
      if (r.type !== ROAD.TAR && !(r.type === ROAD.GRAVEL && r.name === 'Jalan Balak')) continue;
      let acc = 0, prev = null;
      for (let i = 1; i < r.pts.length; i++) {
        const [x, z] = r.pts[i], [px, pz] = r.pts[i - 1];
        acc += Math.hypot(x - px, z - pz);
        if (acc < 32) continue;
        acc = 0;
        if (r.type !== ROAD.TAR && Math.hypot(x - village.road[0][0], z - village.road[0][1]) > 260) { prev = null; continue; }
        const a = Math.atan2(z - pz, x - px), ox = x - Math.sin(a) * 6.5, oz = z + Math.cos(a) * 6.5;
        if (T.riverAt(ox, oz) !== null) { prev = null; continue; }
        const y = T.groundAt(ox, oz), lean = (rnd() - 0.5) * 0.12, top = V(ox + lean * 7, y + 7, oz);
        b.bar(M.planks, V(ox, y - 0.5, oz), top, 0.13, 5);
        b.add(M.planks, box, top.x, top.y - 0.3, top.z, 0, -a + Math.PI / 2, 0, 1.6, 0.1, 0.1);
        collide(ox, oz, 0.25);
        const ends = [-0.7, 0, 0.7].map((o) => V(top.x + Math.cos(a + Math.PI / 2) * o * -1, top.y - 0.25, top.z + Math.sin(a + Math.PI / 2) * o * -1));
        if (prev && rnd() > 0.1) for (let w = 0; w < 3; w++) {
          const A = prev[w], B = ends[w], mid = A.clone().lerp(B, 0.5); mid.y -= 0.9;
          wires.push(A.x, A.y, A.z, mid.x, mid.y, mid.z, mid.x, mid.y, mid.z, B.x, B.y, B.z);
        }
        prev = ends;
      }
    }
    finish(b);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x1a1c18 }));
    scene.add(lines);
  }

  // ---- red ties and DO NOT ENTER signs where the paths lead somewhere bad ---------------------
  {
    const b = new Builder();
    const warn = sign('JANGAN', 'MASUK', '#e8e2cf', '#8e1f16', '#8e1f16');
    for (const r of T.roads) {
      if (r.type !== ROAD.PATH) continue;
      const end = r.pts[r.pts.length - 1];
      const bad = sites.find((s) => ['plane', 'shrine', 'karst'].includes(s.type) && Math.hypot(s.x - end[0], s.z - end[1]) < 30);
      if (!bad) continue;
      const p = r.pts[2], q = r.pts[3], a = Math.atan2(q[1] - p[1], q[0] - p[0]);
      plankSign(b, warn, p[0] + Math.sin(a) * 2.2, p[1] - Math.cos(a) * 2.2, a + Math.PI / 2, 1.5);
      for (let i = 6; i < r.pts.length - 2; i += 7) redTie(b, r.pts[i][0] + Math.sin(a) * 2, r.pts[i][1] - Math.cos(a) * 2);
    }
    finish(b);
  }

  function update(camPos, far, time) {
    for (const g of groups) {
      const p = g.children.length && g.children[0].geometry && !g.position.lengthSq() ? g.children[0].geometry.boundingSphere : null;
      if (p) { g.visible = Math.hypot(p.center.x - camPos.x, p.center.z - camPos.z) < far + p.radius + 10; }
      else g.visible = Math.hypot(g.position.x - camPos.x, g.position.z - camPos.z) < far + 20;
    }
    for (const f of animated) f(time);
  }
  // bounding spheres for the distance check
  for (const g of groups) for (const m of g.children) if (m.geometry) m.geometry.computeBoundingSphere();
  return { update };
}
