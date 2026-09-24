// Builds the jungle around the map: ground, rivers, trees, undergrowth, logs,
// rocks, the oil palm estate. The map is ~1 km across, so it is cut into 48 m
// chunks that are only built when you get near them, and only drawn when close.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildTerrain, sampleGrid, SIZE, HALF, CELL, N, ROAD } from './terrain.js';
import { mulberry32, clamp, fbm } from './noise.js';
import { psxify } from './psx.js';
import { dappleHook } from './sky.js';

const CHUNK = 48;
const CN = SIZE / CHUNK;
const CELLS = CHUNK / CELL;

// ---------- collider grid for trunks ----------------------------------------------
class TreeGrid {
  constructor(cell = 6) { this.cell = cell; this.n = Math.ceil(SIZE / cell); this.bins = Array.from({ length: this.n * this.n }, () => []); this.out = []; }
  add(t) {
    const c = this.cell, n = this.n;
    const a0 = clamp(Math.floor((t.x - t.r + HALF) / c), 0, n - 1), a1 = clamp(Math.floor((t.x + t.r + HALF) / c), 0, n - 1);
    const b0 = clamp(Math.floor((t.z - t.r + HALF) / c), 0, n - 1), b1 = clamp(Math.floor((t.z + t.r + HALF) / c), 0, n - 1);
    for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) this.bins[b * n + a].push(t);
  }
  query(x, z) {
    const c = this.cell, n = this.n, out = this.out; out.length = 0;
    const a = Math.floor((x + HALF) / c), b = Math.floor((z + HALF) / c);
    for (let bb = b - 1; bb <= b + 1; bb++) for (let aa = a - 1; aa <= a + 1; aa++) {
      if (aa < 0 || bb < 0 || aa >= n || bb >= n) continue;
      for (const t of this.bins[bb * n + aa]) if (!out.includes(t)) out.push(t);
    }
    return out;
  }
}

// ---------- geometry helpers -------------------------------------------------------
export function crossedCards(w, h, count, y0 = 0) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const g = new THREE.PlaneGeometry(w, h);
    g.translate(0, h / 2 + y0, 0);
    g.rotateY((i / count) * Math.PI);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

function giantTreeGeo() {
  const trunk = new THREE.CylinderGeometry(0.62, 0.95, 34, 7, 3, true);
  trunk.translate(0, 17, 0);
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + Math.sin(y * 0.21) * 0.25); }
  const uv = trunk.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 12);
  const parts = [trunk.toNonIndexed()];
  // buttress roots: thin triangular fins, the Borneo giant's signature
  for (let f = 0; f < 4; f++) {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(2.3, 0); s.quadraticCurveTo(0.9, 0.6, 0.35, 3.6); s.lineTo(0, 3.6); s.lineTo(0, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: false, curveSegments: 2 });
    g.translate(0.45, 0, -0.08);
    g.rotateY(f * Math.PI / 2 + 0.4 + (f % 2) * 0.3);
    const u = g.attributes.uv;
    for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * 0.6, u.getY(i) * 0.6);
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  return mergeGeometries(parts);
}

function trunkGeo(r0, r1, h, sides, vRep) {
  const g = new THREE.CylinderGeometry(r0, r1, h, sides, 2, true);
  g.translate(0, h / 2, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * vRep);
  return g.toNonIndexed();
}

function palmGeo(fronds = 8, w = 0.9, L = 2.8, tilt = -0.85) {
  const parts = [];
  for (let i = 0; i < fronds; i++) {
    const g = new THREE.PlaneGeometry(w, L, 1, 3);
    g.translate(0, L / 2, 0);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const y = p.getY(k); p.setZ(k, -y * y * 0.12 * (2.8 / L)); }
    g.rotateX(tilt + (i % 3) * 0.2);
    g.rotateY((i / fronds) * Math.PI * 2);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

// ---------- the world --------------------------------------------------------------
export function buildWorld(scene, tex, seed = 7) {
  const terrain = buildTerrain(seed);
  const T = terrain;
  const treeGrid = new TreeGrid();
  const brush = new Float32Array(N * N);

  // ---- materials ----
  const L = (o) => psxify(new THREE.MeshLambertMaterial(o), dappleHook, 'd');
  // ground: leaf litter, blended per vertex into gravel, tarmac or bare rock
  const surfU = { tGravel: { value: tex.gravel }, tTar: { value: tex.tar }, tRock: { value: tex.lime } };
  const groundHook = (sh) => {
    dappleHook(sh);
    Object.assign(sh.uniforms, surfU);
    sh.vertexShader = 'attribute vec3 aSurf; varying vec3 vSurf; varying vec2 vWUv;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\n vSurf = aSurf; vWUv = (modelMatrix * vec4(transformed, 1.0)).xz / 4.0;');
    sh.fragmentShader = 'uniform sampler2D tGravel, tTar, tRock; varying vec3 vSurf; varying vec2 vWUv;\n' + sh.fragmentShader.replace(
      '#include <map_fragment>', `#include <map_fragment>
      vec3 sg = texture2D(tGravel, vWUv).rgb, st = texture2D(tTar, vWUv).rgb, sr = texture2D(tRock, vWUv * 0.6).rgb;
      diffuseColor.rgb = mix(diffuseColor.rgb, sg, vSurf.x);
      diffuseColor.rgb = mix(diffuseColor.rgb, st, vSurf.y);
      diffuseColor.rgb = mix(diffuseColor.rgb, sr, vSurf.z);`);
  };
  const mats = {
    ground: psxify(new THREE.MeshLambertMaterial({ map: tex.ground, vertexColors: true }), groundHook, 'g'),
    bark: L({ map: tex.bark }),
    leaves: L({ map: tex.leaves, alphaTest: 0.5, side: THREE.DoubleSide }),
    frond: L({ map: tex.frond, alphaTest: 0.5, side: THREE.DoubleSide }),
    palm: L({ map: tex.palm, alphaTest: 0.5, side: THREE.DoubleSide }),
    vine: L({ map: tex.vine, alphaTest: 0.5, side: THREE.DoubleSide }),
    log: L({ map: tex.log }),
    rock: L({ map: tex.rock }),
    water: psxify(new THREE.MeshPhongMaterial({ color: 0x4e3f26, specular: 0x7f8a80, shininess: 30, transparent: true, opacity: 0.92 })),
  };

  // ---- geometry used everywhere ----
  const G = {
    giant: giantTreeGeo(),
    gCrown: crossedCards(7, 4.5, 4, -2.2),
    mid: trunkGeo(0.2, 0.3, 16, 5, 8),
    crown: crossedCards(4, 3.5, 3, -1.75),
    uTrunk: trunkGeo(0.04, 0.07, 3.2, 4, 2),
    uCards: crossedCards(2.6, 2.2, 3, 1.3),
    bertam: palmGeo(),
    fern: crossedCards(1.3, 1.1, 3),
    vine: (() => { const g = new THREE.PlaneGeometry(0.35, 11); g.translate(0, 5.5, 0); const u = g.attributes.uv; for (let i = 0; i < u.count; i++) u.setY(i, u.getY(i) * 20); return g; })(),
    log: (() => { const g = new THREE.CylinderGeometry(1, 1, 1, 7, 1); const u = g.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * 2, u.getY(i) * 4); return g; })(),
    rock: new THREE.DodecahedronGeometry(1, 0),
    oilTrunk: trunkGeo(0.32, 0.42, 1, 6, 3),
    oilCrown: palmGeo(14, 1.3, 4.2, -1.05),
  };

  // obstacles pre-binned by chunk
  const chunkIndex = (x, z) => clamp(Math.floor((z + HALF) / CHUNK), 0, CN - 1) * CN + clamp(Math.floor((x + HALF) / CHUNK), 0, CN - 1);
  const logsBy = new Map(), rocksBy = new Map();
  for (const l of T.logs) { const k = chunkIndex(l.x, l.z); if (!logsBy.has(k)) logsBy.set(k, []); logsBy.get(k).push(l); }
  for (const r of T.rocks) { const k = chunkIndex(r.x, r.z); if (!rocksBy.has(k)) rocksBy.set(k, []); rocksBy.get(k).push(r); }

  // ---- placement rules ----
  const roadAt = (x, z) => T.roadAt(x, z);
  const inWater = (x, z) => T.riverAt(x, z) !== null && T.groundAt(x, z) < T.riverAt(x, z) + 0.15;
  const steep = (x, z) => { const h = T.groundAt(x, z); return Math.max(Math.abs(T.groundAt(x + 1.5, z) - h), Math.abs(T.groundAt(x, z + 1.5) - h)) / 1.5; };
  const siteAt = (x, z, pad = 0) => T.nearSite(x, z, pad);
  const clearFor = (x, z, roadPad, sitePad = 0) => {
    const [w] = roadAt(x, z);
    if (w > roadPad) return false;
    if (inWater(x, z) || T.inPlantation(x, z, 2)) return false;
    return !siteAt(x, z, sitePad);
  };
  const trunkHit = (x, z, r) => treeGrid.query(x, z).some((t) => Math.hypot(t.x - x, t.z - z) < t.r + r);
  const addBrush = (x, z, amt, rad) => {
    const r = Math.ceil(rad / CELL);
    const ci = Math.round((x + HALF) / CELL), cj = Math.round((z + HALF) / CELL);
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const d = Math.hypot(i - ci, j - cj) * CELL;
      if (d <= rad) brush[j * N + i] = Math.min(1.5, brush[j * N + i] + amt * (1 - d / rad));
    }
  };

  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpE = new THREE.Euler();
  const tint = new THREE.Color(), cA = new THREE.Color(), cB = new THREE.Color();

  function instanced(group, list, geo, mat, colorVar, rnd, order = 0) {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((o, i) => {
      if (o.q) tmpQ.copy(o.q); else tmpQ.setFromEuler(tmpE.set(o.rx || 0, o.ry || 0, o.rz || 0));
      im.setMatrixAt(i, tmpM.compose(tmpP.set(o.x, o.y, o.z), tmpQ, tmpS.set(o.sx ?? o.s, o.sy ?? o.s, o.sz ?? o.s)));
      if (colorVar) { const v = 1 - colorVar / 2 + rnd() * colorVar; tint.setRGB(v * (0.95 + rnd() * 0.1), v, v * (0.9 + rnd() * 0.1)); im.setColorAt(i, tint); }
    });
    im.computeBoundingSphere();
    im.renderOrder = order;
    group.add(im);
  }

  // ---- chunks ----
  const chunks = [];
  for (let cz = 0; cz < CN; cz++) for (let cx = 0; cx < CN; cx++) {
    chunks.push({ cx, cz, x: -HALF + (cx + 0.5) * CHUNK, z: -HALF + (cz + 0.5) * CHUNK, built: false, far: null, near: null });
  }

  function buildGround(c) {
    const vn = CELLS + 1;
    const pos = new Float32Array(vn * vn * 3), uv = new Float32Array(vn * vn * 2), col = new Float32Array(vn * vn * 3), surf = new Float32Array(vn * vn * 3);
    for (let j = 0; j < vn; j++) for (let i = 0; i < vn; i++) {
      const gi = c.cx * CELLS + i, gj = c.cz * CELLS + j, k = gj * N + gi, o = j * vn + i;
      const x = -HALF + gi * CELL, z = -HALF + gj * CELL;
      const h = T.heights[k];
      pos[o * 3] = x; pos[o * 3 + 1] = h; pos[o * 3 + 2] = z;
      uv[o * 2] = x / 4; uv[o * 2 + 1] = z / 4;
      const rw = T.roadW[k], rt = T.roadT[k], m = T.mud[k], w = T.wet[k];
      const blotch = fbm(x / 9, z / 9, 2, 99) * 0.5 + 0.5;
      cA.setRGB(0.9 + blotch * 0.25, 0.9 + blotch * 0.2, 0.85);
      let sg = 0, st = 0, sr = 0;
      if (rw > 0) {
        if (rt === ROAD.TAR) st = rw;
        else if (rt === ROAD.GRAVEL) sg = rw * 0.9;
        else if (rt === ROAD.ESTATE) { sg = rw * 0.5; cB.setRGB(1.2, 1.0, 0.8); cA.lerp(cB, rw * 0.5); }
        else if (rt === ROAD.TRACK) { cB.setRGB(1.1, 0.95, 0.8); cA.lerp(cB, rw * 0.6); }
        else { cB.setRGB(1.15, 1.05, 0.9); cA.lerp(cB, rw * 0.45); }
      }
      cB.setRGB(0.45, 0.4, 0.36); cA.lerp(cB, m * 0.7 * (1 - st));
      cB.setRGB(0.3, 0.33, 0.32); cA.lerp(cB, w);
      // steep ground and cliffs show bare limestone
      const i1 = Math.min(N - 1, gi + 1), j1 = Math.min(N - 1, gj + 1);
      const slope = Math.max(Math.abs(T.heights[gj * N + i1] - h), Math.abs(T.heights[j1 * N + gi] - h)) / CELL;
      sr = clamp((slope - 0.75) * 1.6, 0, 1) * (1 - st);
      col[o * 3] = cA.r; col[o * 3 + 1] = cA.g; col[o * 3 + 2] = cA.b;
      surf[o * 3] = sg; surf[o * 3 + 1] = st; surf[o * 3 + 2] = sr;
    }
    const idx = [];
    for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) {
      const a = j * vn + i, b = a + 1, cc = a + vn, d = cc + 1;
      idx.push(a, cc, b, d, b, cc); // same split as sampleGrid()
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSurf', new THREE.BufferAttribute(surf, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return new THREE.Mesh(g, mats.ground);
  }

  // per square metre
  const D = { giant: 0.0015, mid: 0.012, under: 0.034, bertam: 0.015, fern: 0.09, vine: 0.01 };

  function buildChunk(c) {
    const rnd = mulberry32(seed * 7919 + c.cx * 131 + c.cz * 977);
    const x0 = -HALF + c.cx * CHUNK, z0 = -HALF + c.cz * CHUNK, A = CHUNK * CHUNK;
    const pick = () => [x0 + rnd() * CHUNK, z0 + rnd() * CHUNK];
    const far = new THREE.Group(), near = new THREE.Group();
    far.add(buildGround(c));
    const L = { giant: [], gCrown: [], mid: [], crown: [], uTrunk: [], uCards: [], bertam: [], fern: [], vine: [], log: [], rock: [], oilTrunk: [], oilCrown: [] };
    const edge = (x, z) => Math.max(Math.abs(x), Math.abs(z)) > HALF - 10;
    const scatter = (n, fn) => { const cnt = Math.round(n * A); for (let i = 0; i < cnt; i++) { const [x, z] = pick(); if (!edge(x, z)) fn(x, z); } };

    scatter(D.giant, (x, z) => {
      if (!clearFor(x, z, 0.02, 4) || trunkHit(x, z, 3.5) || steep(x, z) > 1.2) return;
      const s = 0.8 + rnd() * 0.75, y = T.groundAt(x, z) - 0.3;
      treeGrid.add({ x, z, r: 0.95 * s + 0.35, big: true });
      L.giant.push({ x, y, z, s, ry: rnd() * 6.28 });
      L.gCrown.push({ x, y: y + 30 + rnd() * 3, z, s: 2.2 + rnd() * 1.2, sy: 0.7, ry: rnd() * 6.28 });
    });
    scatter(D.mid, (x, z) => {
      if (!clearFor(x, z, 0.02, 2) || trunkHit(x, z, 1.2)) return;
      const s = 0.75 + rnd() * 0.6, sy = 0.7 + rnd() * 0.6, y = T.groundAt(x, z) - 0.2;
      treeGrid.add({ x, z, r: 0.3 * s + 0.05 });
      L.mid.push({ x, y, z, s, sy, ry: rnd() * 6.28, rz: (rnd() - 0.5) * 0.08 });
      L.crown.push({ x, y: y + 16 * sy - 2, z, s: 1.6 + rnd(), ry: rnd() * 6.28 });
    });
    scatter(D.under, (x, z) => {
      if (!clearFor(x, z, 0.2)) return;
      const s = 0.7 + rnd() * 0.7;
      addBrush(x, z, 0.45, 1.6 * s);
      const o = { x, y: T.groundAt(x, z) - 0.1, z, s, ry: rnd() * 6.28 };
      L.uTrunk.push(o); L.uCards.push(o);
    });
    scatter(D.bertam, (x, z) => {
      if (!clearFor(x, z, 0.3)) return;
      const s = 0.8 + rnd() * 0.8;
      addBrush(x, z, 0.55, 1.8 * s);
      L.bertam.push({ x, y: T.groundAt(x, z) - 0.05, z, s, ry: rnd() * 6.28 });
    });
    scatter(D.fern, (x, z) => {
      const [w, t] = roadAt(x, z);
      if (w > (t === ROAD.PATH || t === ROAD.TRACK ? 0.75 : 0.35) || inWater(x, z)) return;
      const site = siteAt(x, z);
      if (site && site.type !== 'village' && site.type !== 'field' && rnd() < 0.8) return; // the village is overgrown
      if (T.inPlantation(x, z) && rnd() < 0.6) return;
      const s = 0.6 + rnd() * 0.8;
      addBrush(x, z, 0.12, 0.9 * s);
      L.fern.push({ x, y: T.groundAt(x, z) - 0.05, z, s, ry: rnd() * 6.28 });
    });
    scatter(D.vine, (x, z) => {
      if (!clearFor(x, z, 0.8)) return;
      L.vine.push({ x, y: T.groundAt(x, z) + 1.4 + rnd() * 2.2, z, s: 1, ry: rnd() * 6.28 });
    });

    // oil palm estate rows (some of them dead, crowns gone)
    const P = T.plant;
    if (x0 + CHUNK > P.x0 && x0 < P.x1 && z0 + CHUNK > P.z0 && z0 < P.z1) {
      const sp = 9;
      for (let gz = Math.ceil((z0 - P.z0) / sp) * sp + P.z0; gz < z0 + CHUNK; gz += sp) {
        const row = Math.round((gz - P.z0) / sp);
        for (let gx = Math.ceil((x0 - P.x0) / sp) * sp + P.x0 + (row % 2) * sp / 2; gx < x0 + CHUNK; gx += sp) {
          if (!T.inPlantation(gx, gz) || roadAt(gx, gz)[0] > 0.05) continue;
          const h = 4.5 + rnd() * 2.5, y = T.groundAt(gx, gz) - 0.1;
          treeGrid.add({ x: gx, z: gz, r: 0.5 });
          L.oilTrunk.push({ x: gx, y, z: gz, s: 1, sy: h, ry: rnd() * 6.28, rz: (rnd() - 0.5) * 0.06 });
          if (rnd() > 0.15) L.oilCrown.push({ x: gx, y: y + h - 0.3, z: gz, s: 0.9 + rnd() * 0.3, ry: rnd() * 6.28 });
        }
      }
    }

    for (const l of logsBy.get(c.cz * CN + c.cx) || []) {
      const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -l.a);
      const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
      L.log.push({ x: l.x, y: l.y, z: l.z, sx: l.r, sy: l.len, sz: l.r, q: qy.multiply(qz) });
    }
    for (const r of rocksBy.get(c.cz * CN + c.cx) || []) L.rock.push({ x: r.x, y: r.y, z: r.z, sx: r.r, sy: r.r * 0.8, sz: r.r * (0.8 + rnd() * 0.4), ry: rnd() * 6.28, rx: (rnd() - 0.5) * 0.4 });

    instanced(far, L.giant, G.giant, mats.bark, 0.35, rnd);
    instanced(far, L.gCrown, G.gCrown, mats.leaves, 0.3, rnd);
    instanced(far, L.mid, G.mid, mats.bark, 0.4, rnd);
    instanced(far, L.crown, G.crown, mats.leaves, 0.4, rnd);
    instanced(far, L.oilTrunk, G.oilTrunk, mats.bark, 0.3, rnd);
    instanced(far, L.oilCrown, G.oilCrown, mats.palm, 0.5, rnd);
    instanced(near, L.uTrunk, G.uTrunk, mats.bark, 0, rnd);
    instanced(near, L.uCards, G.uCards, mats.leaves, 0.5, rnd);
    instanced(near, L.bertam, G.bertam, mats.palm, 0.45, rnd);
    instanced(near, L.fern, G.fern, mats.frond, 0.5, rnd);
    instanced(near, L.vine, G.vine, mats.vine, 0, rnd);
    instanced(near, L.log, G.log, mats.log, 0, rnd);
    instanced(near, L.rock, G.rock, mats.rock, 0.3, rnd);
    scene.add(far); scene.add(near);
    c.far = far; c.near = near; c.built = true;
  }

  // ---- rivers: water ribbons, cut into pieces so they cull ----
  for (const r of T.rivers) {
    const P = r.pts, piece = 24;
    for (let s0 = 0; s0 < P.length - 1; s0 += piece) {
      const pos = [], idx = [];
      const s1 = Math.min(P.length - 1, s0 + piece);
      for (let s = s0; s <= s1; s++) {
        const a = s > 0 ? P[s - 1] : P[s], b = s < P.length - 1 ? P[s + 1] : P[s];
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), nx = -Math.sin(ang), nz = Math.cos(ang);
        const y = r.level[s], w = r.half + 1.8;
        pos.push(P[s][0] + nx * w, y, P[s][1] + nz * w, P[s][0] - nx * w, y, P[s][1] - nz * w);
        if (s < s1) { const q = (s - s0) * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mats.water);
      m.renderOrder = 1;
      scene.add(m);
    }
  }

  // ---- streaming ----
  const BUILD_R = 135, NEAR_R = 58;
  function ensure(camPos, budget) {
    let built = 0;
    // nearest unbuilt chunks first
    const want = [];
    for (const c of chunks) {
      if (c.built) continue;
      const d = Math.hypot(c.x - camPos.x, c.z - camPos.z);
      if (d < BUILD_R) want.push([d, c]);
    }
    want.sort((a, b) => a[0] - b[0]);
    for (const [, c] of want) { if (built >= budget) break; buildChunk(c); built++; }
    return built;
  }

  const brushAt = (x, z) => sampleGrid(brush, x, z);

  function update(camPos, time, farDist) {
    ensure(camPos, 1);
    const lim = farDist + CHUNK * 0.72, nl = NEAR_R + CHUNK * 0.72;
    for (const c of chunks) {
      if (!c.built) continue;
      const d = Math.hypot(c.x - camPos.x, c.z - camPos.z);
      c.far.visible = d < lim;
      c.near.visible = d < nl;
    }
  }

  return { terrain, treeGrid, brushAt, update, ensure, mats, chunks, G };
}
