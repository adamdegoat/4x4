// Named places on the map: the old logging camp, the bridge, the log landing,
// a dead logging truck, a lookout tower and a limestone outcrop.
// Each landmark's parts are merged per material, so a whole camp is a handful
// of draw calls. Trunk-style circle colliders keep the car out of solid bits.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { psxify } from './psx.js';
import { dappleHook } from './sky.js';
import { mulberry32 } from './noise.js';

class Builder {
  constructor() { this.parts = new Map(); }
  add(mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return this;
  }
  bar(mat, a, b, r) {
    const d = new THREE.Vector3().subVectors(b, a);
    const g = new THREE.CylinderGeometry(r, r, d.length(), 5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    const e = new THREE.Euler().setFromQuaternion(q);
    const c = a.clone().addScaledVector(d, 0.5);
    return this.add(mat, g, c.x, c.y, c.z, e.x, e.y, e.z);
  }
  build() {
    const g = new THREE.Group();
    for (const [mat, list] of this.parts) g.add(new THREE.Mesh(mergeGeometries(list), mat));
    return g;
  }
}

function signTexture(lines) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#e8e2cf'; g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#8a3a24'; g.fillRect(0, 0, 128, 6); g.fillRect(0, 58, 128, 6);
  g.fillStyle = '#23201a'; g.textAlign = 'center';
  g.font = 'bold 22px monospace'; g.fillText(lines[0], 64, 30);
  g.font = 'bold 11px monospace'; g.fillText(lines[1], 64, 48);
  // grime
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(60,50,30,${Math.random() * 0.35})`; g.fillRect(Math.random() * 128, Math.random() * 64, 2, 2); }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildLandmarks(scene, world, tex) {
  const T = world.terrain, S = T.sites, grid = world.treeGrid;
  const rnd = mulberry32(404);
  const L = (o) => psxify(new THREE.MeshLambertMaterial(o), dappleHook, 'd');
  const M = {
    planks: L({ map: tex.planks }),
    rust: L({ map: tex.rust, side: THREE.DoubleSide }),
    lime: L({ map: tex.lime }),
    paint: L({ map: tex.paint }),
    log: world.mats.log,
    tyre: L({ color: 0x1a1a18 }),
    sign: L({ map: signTexture(['KEM 3', 'SG. GELAP TIMBER']) }),
  };
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 7);
  const groups = [];

  // place a local-space landmark at a site: local +x runs along angle a
  const place = (b, site, a, y) => {
    const g = b.build();
    g.position.set(site.x, y, site.z);
    g.rotation.y = -a;
    scene.add(g);
    groups.push(g);
    return g;
  };
  const toWorld = (site, a, lx, lz) => ({ x: site.x + lx * Math.cos(a) - lz * Math.sin(a), z: site.z + lx * Math.sin(a) + lz * Math.cos(a) });
  const collide = (site, a, lx, lz, r) => { const p = toWorld(site, a, lx, lz); grid.add({ x: p.x, z: p.z, r }); };

  // ---- the old logging camp: huts on stilts, drums, a sign -------------------
  {
    const s = S.camp, a = s.a, y = T.groundAt(s.x, s.z);
    const b = new Builder();
    const hut = (hx, hz, rot, ruin) => {
      const c = Math.cos(rot), sn = Math.sin(rot);
      const P = (lx, lz) => [hx + lx * c - lz * sn, hz + lx * sn + lz * c];
      for (const [sx, sz] of [[-2.3, -1.8], [0, -1.8], [2.3, -1.8], [-2.3, 1.8], [0, 1.8], [2.3, 1.8]]) {
        const [px, pz] = P(sx, sz); b.add(M.planks, box, px, 0.6, pz, 0, -rot, 0, 0.2, 2.2, 0.2);
      }
      const [fx, fz] = P(0, 0);
      b.add(M.planks, box, fx, 1.3, fz, 0, -rot, 0, 5, 0.15, 4);
      const wall = (lx, lz, w, d, h = 2.2) => { const [wx, wz] = P(lx, lz); b.add(M.planks, box, wx, 1.38 + h / 2, wz, 0, -rot, 0, w, h, d); };
      wall(0, -2, 5, 0.1);
      wall(-2.5, 0, 0.1, 4);
      if (!ruin) wall(2.5, 0, 0.1, 4); else wall(2.5, -1.2, 0.1, 1.6, 1.3);
      wall(-1.6, 2, 1.8, 0.1); wall(1.6, 2, 1.8, 0.1); wall(0, 2, 1.4, 0.1, 0.5);
      // roof: two sheets of rusty iron, one hanging loose on the ruin
      const [rx, rz] = P(0, -1.05), [rx2, rz2] = P(0, 1.05);
      b.add(M.rust, box, rx, 4.0, rz, 0.5, -rot, 0, 5.8, 0.04, 2.5);
      b.add(M.rust, box, rx2, ruin ? 3.3 : 4.0, rz2, ruin ? -0.9 : -0.5, -rot, 0, 5.8, 0.04, 2.5);
      // steps
      for (let i = 0; i < 3; i++) { const [sx, sz] = P(0, 2.3 + i * 0.35); b.add(M.planks, box, sx, 1.0 - i * 0.35, sz, 0, -rot, 0, 1.0, 0.08, 0.3); }
      // colliders over the footprint
      for (const [cx, cz] of [[-1.5, 0], [1.5, 0]]) { const [px, pz] = P(cx, cz); collide(s, a, px, pz, 2.1); }
    };
    hut(-6, 0, 0.1, false);
    hut(4, -3, -0.35, true);
    hut(-1, 8, 0.25, false);
    // fuel drums
    for (let i = 0; i < 5; i++) {
      const dx = 7 + (i % 3) * 0.7, dz = 4 + Math.floor(i / 3) * 0.7;
      b.add(M.rust, cyl, dx, 0.45, dz, 0, 0, 0, 0.3, 0.9, 0.3);
    }
    b.add(M.rust, cyl, 8.4, 0.3, 6.2, 0, 0.6, Math.PI / 2, 0.3, 0.9, 0.3);
    collide(s, a, 7.7, 4.4, 1.3);
    // sign by the trail
    b.add(M.planks, box, 0, 1.0, -10.5, 0, 0, 0, 0.12, 2.4, 0.12).add(M.planks, box, 1.6, 1.0, -10.5, 0, 0, 0, 0.12, 2.4, 0.12);
    const sg = new THREE.PlaneGeometry(2.2, 1.1);
    b.add(M.sign, sg, 0.8, 1.75, -10.43, 0, 0, 0);
    b.add(M.sign, sg, 0.8, 1.75, -10.57, 0, Math.PI, 0);
    collide(s, a, 0.8, -10.5, 0.9);
    place(b, s, a, y);
  }

  // ---- the bridge: plank deck on piles, rails --------------------------------
  {
    const s = S.bridge, d = s.deck, a = s.a;
    const b = new Builder();
    const segs = 16, seg = s.len / segs;
    for (let i = 0; i < segs; i++) {
      const u0 = -s.len / 2 + i * seg, u1 = u0 + seg;
      const y0 = T.deckY(d, u0), y1 = T.deckY(d, u1);
      const ang = Math.atan2(y1 - y0, seg);
      b.add(M.planks, box, (u0 + u1) / 2, (y0 + y1) / 2 - 0.08, 0, 0, 0, ang, seg / Math.cos(ang) + 0.02, 0.16, s.w);
    }
    for (let u = -s.len / 2 + 2; u <= s.len / 2 - 2; u += 3) {
      const top = T.deckY(d, u);
      for (const side of [-1, 1]) {
        const p = toWorld(s, a, u, side * (s.w / 2 - 0.1));
        const g = T.groundAt(p.x, p.z);
        if (top - g > 0.5) b.add(M.log, cyl, u, (top + g) / 2 - 0.3, side * (s.w / 2 - 0.1), 0, 0, 0, 0.16, top - g + 0.6, 0.16);
        b.add(M.planks, box, u, top + 0.45, side * (s.w / 2), 0, 0, 0, 0.12, 0.9, 0.12);
      }
    }
    for (const side of [-1, 1]) for (let i = 0; i < segs; i++) {
      const u0 = -s.len / 2 + 2 + i * ((s.len - 4) / segs), u1 = u0 + (s.len - 4) / segs;
      const y0 = T.deckY(d, u0) + 0.85, y1 = T.deckY(d, u1) + 0.85;
      if (i % 5 === 3 && side === 1) continue; // a broken rail
      b.add(M.planks, box, (u0 + u1) / 2, (y0 + y1) / 2, side * (s.w / 2), 0, 0, Math.atan2(y1 - y0, u1 - u0), u1 - u0 + 0.05, 0.08, 0.08);
    }
    place(b, s, a, 0);
  }

  // ---- log landing: stacked timber waiting for a truck that never came -------------
  {
    const s = S.landing, a = s.a, y = T.groundAt(s.x, s.z);
    const b = new Builder();
    const pile = (px, pz, rot) => {
      const rows = [4, 3, 2];
      rows.forEach((n, row) => {
        for (let i = 0; i < n; i++) {
          const off = (i - (n - 1) / 2) * 0.95;
          const c = Math.cos(rot), sn = Math.sin(rot);
          b.add(M.log, cyl, px - off * sn, 0.45 + row * 0.8, pz + off * c, Math.PI / 2, -rot + Math.PI / 2, 0, 0.47 + rnd() * 0.08, 9 + rnd(), 0.47 + rnd() * 0.08);
        }
      });
      for (const t of [-3, 0, 3]) collide(s, a, px + t * Math.cos(rot), pz + t * Math.sin(rot), 2.0);
    };
    pile(-4, -5, 0.1);
    pile(5, 3, -0.2);
    // a few strays
    b.add(M.log, cyl, -1, 0.4, 7, Math.PI / 2, 0.7, 0, 0.42, 8, 0.42);
    place(b, s, a, y);
  }

  // ---- dead logging truck ----------------------------------------------------
  {
    const s = S.truck, a = s.a, y = T.groundAt(s.x, s.z) - 0.25;
    const b = new Builder();
    b.add(M.rust, box, 0, 0.95, 0, 0, 0, 0, 7.2, 0.35, 1.6);
    b.add(M.paint, box, 2.6, 2.0, 0, 0, 0, 0, 1.9, 1.7, 2.2);
    b.add(M.paint, box, 4.1, 1.55, 0, 0, 0, -0.05, 1.3, 0.9, 1.9);
    b.add(M.tyre, box, 3.62, 2.25, 0, 0, 0, 0, 0.05, 0.7, 1.9); // empty windscreen hole reads dark
    for (const x of [-0.8, -3.2]) for (const zz of [-0.95, 0.95]) b.add(M.rust, box, x, 1.9, zz, 0, 0, 0, 0.15, 1.8, 0.15);
    for (const [x, zz] of [[3.3, -1.0], [3.3, 1.0], [-1.6, -1.0], [-1.6, 1.0], [-2.8, -1.0], [-2.8, 1.0]]) {
      if (x === 3.3 && zz > 0) { b.add(M.tyre, cyl, x + 0.4, 0.35, zz + 0.6, 0, 0, 0.2, 0.55, 0.4, 0.55); continue; } // wheel fell off
      b.add(M.tyre, cyl, x, 0.55, zz, Math.PI / 2, 0, 0, 0.55, 0.4, 0.55);
    }
    b.add(M.log, cyl, -2, 1.55, -0.4, 0, 0, Math.PI / 2, 0.45, 6.5, 0.45);
    b.add(M.log, cyl, -2, 1.55, 0.5, 0, 0, Math.PI / 2, 0.42, 6.2, 0.42);
    const g = place(b, s, a, y);
    g.rotation.z = 0.05; g.rotation.x = 0.07;
    for (const x of [-3, -0.5, 2, 4]) collide(s, a, x, 0, 1.35);
  }

  // ---- lookout tower on the high ground -----------------------------------
  {
    const s = S.tower, y = T.groundAt(s.x, s.z);
    const b = new Builder();
    const H = 13, V = (x, yy, z) => new THREE.Vector3(x, yy, z);
    const leg = (sx, sz, t) => V(sx * (2.1 - t * 0.9), -1 + t * (H + 1), sz * (2.1 - t * 0.9));
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sz] of corners) b.bar(M.rust, leg(sx, sz, 0), leg(sx, sz, 1), 0.09);
    for (let lvl = 0; lvl < 3; lvl++) {
      const t0 = 0.12 + lvl * 0.28, t1 = t0 + 0.28;
      for (let i = 0; i < 4; i++) {
        const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
        b.bar(M.rust, leg(ax, az, t0), leg(bx, bz, t1), 0.04);
        b.bar(M.rust, leg(bx, bz, t0), leg(ax, az, t1), 0.04);
      }
    }
    b.add(M.planks, box, 0, H + 0.1, 0, 0, 0, 0, 3.4, 0.2, 3.4);
    for (const [sx, sz] of corners) b.add(M.planks, box, sx * 1.6, H + 1.1, sz * 1.6, 0, 0, 0, 0.12, 2, 0.12);
    b.add(M.planks, box, 0, H + 0.6, -1.65, 0, 0, 0, 3.3, 1.0, 0.08);
    b.add(M.planks, box, -1.65, H + 0.6, 0, 0, 0, 0, 0.08, 1.0, 3.3);
    const roof = new THREE.ConeGeometry(2.8, 1.5, 4, 1);
    b.add(M.rust, roof, 0, H + 2.8, 0, 0, Math.PI / 4, 0);
    for (const [sx, sz] of corners) collide(s, 0, sx * 2.0, sz * 2.0, 0.3);
    place(b, s, 0, y);
  }

  // ---- limestone outcrop ------------------------------------------------------
  {
    const s = S.karst;
    const b = new Builder();
    const rock = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < 7; i++) {
      const lx = (rnd() - 0.5) * 16, lz = (rnd() - 0.5) * 16;
      const w = 2 + rnd() * 2.5, h = 6 + rnd() * 12;
      const gy = T.groundAt(s.x + lx, s.z + lz);
      b.add(M.lime, rock, lx, gy + h * 0.35, lz, (rnd() - 0.5) * 0.2, rnd() * 6, (rnd() - 0.5) * 0.2, w, h, w * (0.8 + rnd() * 0.4));
      grid.add({ x: s.x + lx, z: s.z + lz, r: w * 0.85 });
    }
    place(b, s, 0, 0);
  }

  function update(camPos, far) {
    for (const g of groups) g.visible = Math.hypot(g.position.x - camPos.x, g.position.z - camPos.z) < far + 35;
  }
  return { update };
}
