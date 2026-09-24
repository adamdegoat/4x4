// The uneasy stuff. No jump scares: a thin figure that stands in the mist and
// is gone when you get close, the insects going quiet around it, and sounds
// with no source. Places with history (the shrine, the plane, the kampung,
// the camp) make it more likely.

import * as THREE from 'three';
import { mulberry32 } from './noise.js';

function figureMesh() {
  const g = new THREE.Group();
  // unlit and outside the fog: a flat dark shape, only half swallowed by the mist (set per frame)
  const m = new THREE.MeshBasicMaterial({ color: 0x0c0d0b, fog: false });
  const add = (w, h, d, x, y, z, rz = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.z = rz; g.add(b); };
  add(0.42, 1.1, 0.22, 0, 1.55, 0);          // body, too long
  add(0.26, 0.32, 0.26, 0.03, 2.28, 0, 0.25); // head, tilted
  add(0.1, 1.25, 0.1, -0.29, 1.35, 0, 0.05);  // arms hang past the knees
  add(0.1, 1.25, 0.1, 0.29, 1.35, 0, -0.05);
  add(0.13, 1.0, 0.13, -0.1, 0.5, 0);
  add(0.13, 1.0, 0.13, 0.1, 0.5, 0);
  // long hair over the face
  add(0.3, 0.7, 0.05, 0.03, 2.0, 0.14, 0.2);
  g.userData.mat = m;
  return g;
}

export class Haunt {
  constructor(scene, world, sound) {
    this.T = world.terrain; this.world = world; this.sound = sound;
    this.fig = figureMesh();
    this.fig.visible = false;
    this.fogColor = scene.fog.color;
    scene.add(this.fig);
    this.rnd = mulberry32(666);
    this.next = 25 + this.rnd() * 20; // first one comes fairly soon
    this.life = 0;
    this.eventT = 8;
    this.shown = 0;
  }

  // how strange is this spot? 0 ordinary jungle .. 1 somewhere bad
  dread(p) {
    let d = 0;
    for (const s of this.T.sites) {
      const w = { shrine: 1, plane: 1, village: 0.7, camp: 0.6, hut: 0.6, karst: 0.5, sawmill: 0.4 }[s.type] || 0;
      if (!w) continue;
      const r = Math.hypot(s.x - p.x, s.z - p.z);
      d = Math.max(d, w * (1 - Math.min(1, Math.max(0, (r - s.r) / 120))));
    }
    return d;
  }

  // only where you could actually see it: no hill or big trunk in between
  inSight(cam, x, z) {
    const top = this.T.groundAt(x, z) + 1.8;
    for (let t = 0.08; t < 0.97; t += 0.06) {
      const px = cam.x + (x - cam.x) * t, pz = cam.z + (z - cam.z) * t, py = cam.y + (top - cam.y) * t;
      if (this.T.heightAt(px, pz) > py - 0.3) return false;
      for (const o of this.world.treeGrid.query(px, pz)) if (o.r > 0.4 && Math.hypot(o.x - px, o.z - pz) < o.r) return false;
    }
    return true;
  }

  spawn(cam, carFwd) {
    // stand it off to the side ahead, in the mist, never on a road
    for (let k = 0; k < 40; k++) {
      const ang = Math.atan2(carFwd.z, carFwd.x) + (this.rnd() - 0.5) * 1.6;
      const d = 24 + this.rnd() * 9;
      const x = cam.x + Math.cos(ang) * d, z = cam.z + Math.sin(ang) * d;
      if (this.T.roadAt(x, z)[0] > 0.1 || this.T.riverAt(x, z) !== null) continue;
      if (!this.inSight(cam, x, z)) continue;
      this.fig.position.set(x, this.T.groundAt(x, z) - 0.05, z);
      this.fig.rotation.y = Math.atan2(cam.x - x, cam.z - z); // facing you
      this.fig.visible = true;
      this.life = 5 + this.rnd() * 6;
      this.shown++;
      this.sound.silence(this.life + 3);
      return true;
    }
    return false;
  }

  update(dt, cam, carFwd, speed, running) {
    if (!running) return;
    const dread = this.dread(cam);
    if (this.fig.visible) {
      this.life -= dt;
      // darker the closer it is; far off it's a grey shape in the haze
      const fd = Math.hypot(this.fig.position.x - cam.x, this.fig.position.z - cam.z);
      this.fig.userData.mat.color.copy(this.fogColor).multiplyScalar(0.12 + 0.55 * Math.min(1, Math.max(0, (fd - 12) / 30)));
      const d = Math.hypot(this.fig.position.x - cam.x, this.fig.position.z - cam.z);
      if (d < 14 || this.life <= 0) {
        this.fig.visible = false;
        this.next = 50 + this.rnd() * 70 - dread * 30;
        if (d < 14) this.sound.whoosh();
      }
    } else {
      this.next -= dt * (1 + dread * 1.5);
      if (this.next <= 0 && !this.spawn(cam, carFwd)) this.next = 5;
    }
    // sounds with no source, more often in bad places
    this.eventT -= dt * (1 + dread * 2);
    if (this.eventT <= 0) {
      const r = this.rnd();
      if (r < 0.35) this.sound.creak();
      else if (r < 0.6) this.sound.gong();
      else if (r < 0.8 && dread > 0.3) this.sound.hum();
      else this.sound.knock();
      this.eventT = 14 + this.rnd() * 22;
    }
    // radio hiss near the telecom mast
    const mast = this.T.sites.find((s) => s.type === 'telecom');
    if (mast) this.sound.static(Math.max(0, 1 - Math.hypot(mast.x - cam.x, mast.z - cam.z) / 90));
  }
}
