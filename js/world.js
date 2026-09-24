// Builds the jungle: ground, stream, trees, undergrowth, logs, rocks, fireflies.
// Everything is split into 50 m chunks so the phone only draws what's near.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildTerrain, sampleGrid, SIZE, HALF, CELL, N } from './terrain.js';
import { mulberry32, clamp, fbm } from './noise.js';
import { psxify } from './psx.js';
import { dappleHook } from './sky.js';

const CHUNK = 50;
const CN = SIZE / CHUNK;

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
function crossedCards(w, h, count, y0 = 0) {
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
  // slight kinks in the trunk
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + Math.sin(y * 0.21) * 0.25); }
  // uv: bark repeats up the trunk
  const uv = trunk.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 12);
  const parts = [trunk];
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
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

function midTreeGeo() {
  const trunk = new THREE.CylinderGeometry(0.2, 0.3, 16, 5, 2, true);
  trunk.translate(0, 8, 0);
  const uv = trunk.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 8);
  return trunk.toNonIndexed();
}

function palmGeo(fronds = 8) {
  const parts = [];
  for (let i = 0; i < fronds; i++) {
    const g = new THREE.PlaneGeometry(0.9, 2.8, 1, 3);
    g.translate(0, 1.4, 0);
    // droop: bend the tip down
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const y = p.getY(k); p.setZ(k, -y * y * 0.12); }
    g.rotateX(-0.85 + (i % 3) * 0.2);
    g.rotateY((i / fronds) * Math.PI * 2);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

function understoryGeo() {
  const trunk = new THREE.CylinderGeometry(0.04, 0.07, 3.2, 4, 1, true);
  trunk.translate(0, 1.6, 0);
  const cards = crossedCards(2.6, 2.2, 3, 1.3);
  // trunk gets the bark part of the atlas-less setup: we keep them separate draw calls instead
  return { trunk: trunk.toNonIndexed(), cards };
}

// ---------- the world --------------------------------------------------------------
export function buildWorld(scene, tex, seed = 7) {
  const terrain = buildTerrain(seed);
  const rnd = mulberry32(seed * 31 + 5);
  const treeGrid = new TreeGrid();
  const brush = new Float32Array(N * N); // undergrowth density on the height grid
  const chunks = [];
  for (let cz = 0; cz < CN; cz++) for (let cx = 0; cx < CN; cx++) {
    const g = new THREE.Group();
    g.userData.cx = -HALF + (cx + 0.5) * CHUNK; g.userData.cz = -HALF + (cz + 0.5) * CHUNK;
    scene.add(g);
    chunks.push(g);
  }
  const chunkOf = (x, z) => chunks[clamp(Math.floor((z + HALF) / CHUNK), 0, CN - 1) * CN + clamp(Math.floor((x + HALF) / CHUNK), 0, CN - 1)];

  // ---- materials ----
  const L = (o) => psxify(new THREE.MeshLambertMaterial(o), dappleHook, 'd');
  const mats = {
    ground: L({ map: tex.ground, vertexColors: true }),
    bark: L({ map: tex.bark }),
    leaves: L({ map: tex.leaves, alphaTest: 0.5, side: THREE.DoubleSide }),
    frond: L({ map: tex.frond, alphaTest: 0.5, side: THREE.DoubleSide }),
    palm: L({ map: tex.palm, alphaTest: 0.5, side: THREE.DoubleSide }),
    vine: L({ map: tex.vine, alphaTest: 0.5, side: THREE.DoubleSide }),
    log: L({ map: tex.log }),
    rock: L({ map: tex.rock }),
    water: psxify(new THREE.MeshPhongMaterial({ color: 0x5a4424, specular: 0x9aa890, shininess: 40, transparent: true, opacity: 0.9 })),
  };

  // ---- ground chunks ----
  const cellsPer = CHUNK / CELL;
  const cA = new THREE.Color(), cB = new THREE.Color();
  for (let cz = 0; cz < CN; cz++) for (let cx = 0; cx < CN; cx++) {
    const vn = cellsPer + 1;
    const pos = new Float32Array(vn * vn * 3), uv = new Float32Array(vn * vn * 2), col = new Float32Array(vn * vn * 3);
    for (let j = 0; j < vn; j++) for (let i = 0; i < vn; i++) {
      const gi = cx * cellsPer + i, gj = cz * cellsPer + j, k = gj * N + gi, o = j * vn + i;
      const x = -HALF + gi * CELL, z = -HALF + gj * CELL;
      pos[o * 3] = x; pos[o * 3 + 1] = terrain.heights[k]; pos[o * 3 + 2] = z;
      uv[o * 2] = x / 4; uv[o * 2 + 1] = z / 4;
      // colour: leaf litter, lighter bare trail, dark wet mud
      const tr = terrain.trailW[k], m = terrain.mud[k], w = terrain.wet[k];
      const blotch = fbm(x / 9, z / 9, 2, 99) * 0.5 + 0.5;
      cA.setRGB(0.9 + blotch * 0.25, 0.9 + blotch * 0.2, 0.85);
      cB.setRGB(1.25, 1.1, 0.95); cA.lerp(cB, tr * 0.6);
      cB.setRGB(0.45, 0.4, 0.36); cA.lerp(cB, m * 0.7);
      cB.setRGB(0.3, 0.33, 0.32); cA.lerp(cB, w);
      col[o * 3] = cA.r; col[o * 3 + 1] = cA.g; col[o * 3 + 2] = cA.b;
    }
    const idx = [];
    for (let j = 0; j < cellsPer; j++) for (let i = 0; i < cellsPer; i++) {
      const a = j * vn + i, b = a + 1, c = a + vn, d = c + 1;
      // triangles (i,j)(i,j+1)(i+1,j) and (i+1,j+1)(i+1,j)(i,j+1): same split as sampleGrid()
      idx.push(a, c, b, d, b, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mats.ground);
    chunks[cz * CN + cx].add(mesh);
  }

  // ---- stream surface ----
  {
    const segs = SIZE / 2;
    const pos = [], idx = [];
    for (let s = 0; s <= segs; s++) {
      const x = -HALF + s * 2, zc = terrain.streamZ(x), y = terrain.waterY(x);
      pos.push(x, y, zc - 9, x, y, zc + 9);
      if (s < segs) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    // cut the long ribbon into chunk-sized pieces for culling
    const water = new THREE.Mesh(g, mats.water);
    water.renderOrder = 1;
    scene.add(water);
  }

  // ---- placement helpers ----
  const onTrail = (x, z) => sampleGrid(terrain.trailW, x, z);
  const inWater = (x, z) => Math.abs(z - terrain.streamZ(x)) < 9 && terrain.groundAt(x, z) < terrain.waterY(x) + 0.1;
  const inset = HALF - 6;
  const pick = () => [(rnd() * 2 - 1) * inset, (rnd() * 2 - 1) * inset];
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpE = new THREE.Euler();
  const tint = new THREE.Color();

  // collect instances per chunk, then build InstancedMeshes
  function scatter(count, accept, make) {
    const per = new Map();
    let guard = 0, placed = 0;
    while (placed < count && guard++ < count * 8) {
      const [x, z] = pick();
      if (!accept(x, z) || terrain.nearSite(x, z)) continue;
      const inst = make(x, z);
      if (!inst) continue;
      const ch = chunkOf(x, z);
      if (!per.has(ch)) per.set(ch, []);
      per.get(ch).push(inst);
      placed++;
    }
    return per;
  }
  function instance(per, geo, mat, { colorVar = 0 } = {}) {
    for (const [ch, list] of per) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((o, i) => {
        tmpE.set(o.rx || 0, o.ry || 0, o.rz || 0);
        tmpQ.setFromEuler(tmpE);
        tmpS.set(o.sx ?? o.s, o.sy ?? o.s, o.sz ?? o.s);
        tmpP.set(o.x, o.y, o.z);
        im.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
        if (colorVar) { const v = 1 - colorVar / 2 + rnd() * colorVar; tint.setRGB(v * (0.95 + rnd() * 0.1), v, v * (0.9 + rnd() * 0.1)); im.setColorAt(i, tint); }
      });
      im.computeBoundingSphere();
      ch.add(im);
    }
  }
  const addBrush = (x, z, amt, rad) => {
    const r = Math.ceil(rad / CELL);
    const ci = Math.round((x + HALF) / CELL), cj = Math.round((z + HALF) / CELL);
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const d = Math.hypot(i - ci, j - cj) * CELL;
      if (d <= rad) brush[j * N + i] = Math.min(1.5, brush[j * N + i] + amt * (1 - d / rad));
    }
  };

  const trunkHit = (x, z, r) => treeGrid.query(x, z).some((t) => Math.hypot(t.x - x, t.z - z) < t.r + r);

  // giants
  const giants = scatter(260, (x, z) => onTrail(x, z) < 0.05 && !inWater(x, z), (x, z) => {
    if (trunkHit(x, z, 3.5)) return null;
    const s = 0.8 + rnd() * 0.75;
    const y = terrain.groundAt(x, z) - 0.3;
    treeGrid.add({ x, z, r: 0.95 * s + 0.35, big: true });
    return { x, y, z, s, ry: rnd() * 6.28 };
  });
  instance(giants, giantTreeGeo(), mats.bark, { colorVar: 0.35 });
  const gCrowns = new Map();
  for (const [ch, list] of giants) gCrowns.set(ch, list.map((o) => ({ x: o.x, y: o.y + 30 + rnd() * 3, z: o.z, s: 2.2 + rnd() * 1.2, sy: 0.7, ry: rnd() * 6.28 })));
  instance(gCrowns, crossedCards(7, 4.5, 4, -2.2), mats.leaves, { colorVar: 0.3 });

  // mid trees
  const mids = scatter(2200, (x, z) => onTrail(x, z) < 0.05 && !inWater(x, z), (x, z) => {
    if (trunkHit(x, z, 1.2)) return null;
    const s = 0.75 + rnd() * 0.6;
    treeGrid.add({ x, z, r: 0.3 * s + 0.05 });
    return { x, y: terrain.groundAt(x, z) - 0.2, z, s, sy: 0.7 + rnd() * 0.6, ry: rnd() * 6.28, rz: (rnd() - 0.5) * 0.08 };
  });
  instance(mids, midTreeGeo(), mats.bark, { colorVar: 0.4 });
  // their crowns: leaf clusters high up
  const crowns = new Map();
  for (const [ch, list] of mids) crowns.set(ch, list.map((o) => ({ x: o.x, y: o.y + 16 * o.sy - 2, z: o.z, s: 1.6 + rnd(), ry: rnd() * 6.28 })));
  instance(crowns, crossedCards(4, 3.5, 3, -1.75), mats.leaves, { colorVar: 0.4 });

  // understory saplings: thin, you can push through them
  const us = understoryGeo();
  const under = scatter(6000, (x, z) => onTrail(x, z) < 0.25 && !inWater(x, z), (x, z) => {
    const s = 0.7 + rnd() * 0.7;
    addBrush(x, z, 0.45, 1.6 * s);
    return { x, y: terrain.groundAt(x, z) - 0.1, z, s, ry: rnd() * 6.28 };
  });
  instance(under, us.trunk, mats.bark);
  instance(under, us.cards, mats.leaves, { colorVar: 0.5 });

  // stemless palms (bertam) — big fans at windscreen height
  const palms = scatter(2600, (x, z) => onTrail(x, z) < 0.35 && !inWater(x, z), (x, z) => {
    const s = 0.8 + rnd() * 0.8;
    addBrush(x, z, 0.55, 1.8 * s);
    return { x, y: terrain.groundAt(x, z) - 0.05, z, s, ry: rnd() * 6.28 };
  });
  instance(palms, palmGeo(), mats.palm, { colorVar: 0.45 });

  // ferns and ground cover
  const ferns = scatter(16000, (x, z) => onTrail(x, z) < 0.6 && !inWater(x, z), (x, z) => {
    const s = 0.6 + rnd() * 0.8;
    addBrush(x, z, 0.12, 0.9 * s);
    return { x, y: terrain.groundAt(x, z) - 0.05, z, s, ry: rnd() * 6.28 };
  });
  instance(ferns, crossedCards(1.3, 1.1, 3), mats.frond, { colorVar: 0.5 });

  // hanging lianas
  const vineGeo = new THREE.PlaneGeometry(0.35, 11);
  vineGeo.translate(0, 5.5, 0);
  { const u = vineGeo.attributes.uv; for (let i = 0; i < u.count; i++) u.setY(i, u.getY(i) * 20); }
  const vines = scatter(1600, (x, z) => onTrail(x, z) < 0.9, (x, z) => ({ x, y: terrain.groundAt(x, z) + 1.4 + rnd() * 2.2, z, s: 1, ry: rnd() * 6.28 }));
  instance(vines, vineGeo, mats.vine);

  // logs
  const logGeo = new THREE.CylinderGeometry(1, 1, 1, 7, 1);
  { const u = logGeo.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * 2, u.getY(i) * 4); }
  const logPer = new Map();
  for (const l of terrain.logs) {
    const ch = chunkOf(l.x, l.z);
    if (!logPer.has(ch)) logPer.set(ch, []);
    logPer.get(ch).push({ x: l.x, y: l.y, z: l.z, sx: l.r, sy: l.len, sz: l.r, rz: Math.PI / 2, ry: -l.a });
  }
  // rotation order: Euler XYZ applies Z first in local terms; we want tip-over then yaw
  for (const [, list] of logPer) for (const o of list) { o.rx = 0; }
  instanceLogs(logPer);
  function instanceLogs(per) {
    for (const [ch, list] of per) {
      const im = new THREE.InstancedMesh(logGeo, mats.log, list.length);
      list.forEach((o, i) => {
        const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.ry);
        const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
        tmpQ.copy(qy).multiply(qz);
        im.setMatrixAt(i, tmpM.compose(tmpP.set(o.x, o.y, o.z), tmpQ, tmpS.set(o.sx, o.sy, o.sz)));
      });
      im.computeBoundingSphere();
      ch.add(im);
    }
  }

  // rocks
  const rockPer = new Map();
  for (const r of terrain.rocks) {
    const ch = chunkOf(r.x, r.z);
    if (!rockPer.has(ch)) rockPer.set(ch, []);
    rockPer.get(ch).push({ x: r.x, y: r.y, z: r.z, sx: r.r, sy: r.r * 0.8, sz: r.r * (0.8 + rnd() * 0.4), ry: rnd() * 6.28, rx: (rnd() - 0.5) * 0.4 });
  }
  instance(rockPer, new THREE.DodecahedronGeometry(1, 0), mats.rock, { colorVar: 0.3 });

  // ---- fireflies ----
  const FF = 160;
  const ffGeo = new THREE.BufferGeometry();
  const ffPos = new Float32Array(FF * 3), ffPhase = new Float32Array(FF);
  for (let i = 0; i < FF; i++) { ffPos[i * 3] = (rnd() - 0.5) * 60; ffPos[i * 3 + 1] = rnd() * 4 + 0.5; ffPos[i * 3 + 2] = (rnd() - 0.5) * 60; ffPhase[i] = rnd() * 50; }
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
  ffGeo.setAttribute('aPhase', new THREE.BufferAttribute(ffPhase, 1));
  const ffMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uAlpha: { value: 1 } },
    vertexShader: `
      attribute float aPhase; uniform float uTime; uniform vec3 uCenter; varying float vA;
      void main(){
        vec3 p = position;
        p.xz = mod(p.xz - uCenter.xz + 30.0, 60.0) - 30.0 + uCenter.xz; // wrap around the player
        p.y += uCenter.y - 1.0 + sin(uTime * 0.7 + aPhase) * 0.4;
        p.x += sin(uTime * 0.3 + aPhase * 2.0) * 0.6;
        float b = sin(uTime * 1.3 + aPhase * 7.0);
        vA = smoothstep(0.6, 1.0, b);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = 2.0;
      }`,
    fragmentShader: `uniform float uAlpha; varying float vA; void main(){ float a = vA * uAlpha; if (a < 0.05) discard; gl_FragColor = vec4(vec3(0.75, 1.0, 0.35) * a, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const fireflies = new THREE.Points(ffGeo, ffMat);
  fireflies.frustumCulled = false;
  scene.add(fireflies);

  // ---- sun shafts: soft slanted beams where light breaks through the canopy ----
  // Additive, faded by distance in the shader (normal fog would brighten them).
  const shaftGeo = crossedCards(3.2, 26, 2, 0);
  { // lean the beams down-sun: the sun sits low in the west (-x)
    const m = new THREE.Matrix4().makeRotationZ(0.55);
    shaftGeo.applyMatrix4(m);
  }
  const shaftMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xfff0c8) }, uStrength: { value: 0.22 } },
    vertexShader: `
      varying float vFade; varying vec2 vUv;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vec4 mv = viewMatrix * wp;
        float d = -mv.z;
        vFade = smoothstep(2.5, 9.0, d) * (1.0 - smoothstep(26.0, 58.0, d));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uStrength; uniform float uTime;
      varying float vFade; varying vec2 vUv;
      void main(){
        // soft across the beam, fading out near the ground and high up
        float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
        float along = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
        float flicker = 0.85 + 0.15 * sin(uTime * 0.6 + vUv.y * 3.0);
        float a = across * across * along * vFade * uStrength * flicker;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const shafts = scatter(420, (x, z) => !inWater(x, z), (x, z) => ({ x, y: terrain.groundAt(x, z) - 1, z, s: 0.8 + rnd() * 0.9, sy: 1, ry: (rnd() - 0.5) * 0.5 }));
  // keep the lean pointing the same way: yaw only a little
  for (const [ch, list] of shafts) {
    const im = new THREE.InstancedMesh(shaftGeo, shaftMat, list.length);
    list.forEach((o, i) => im.setMatrixAt(i, tmpM.compose(tmpP.set(o.x, o.y, o.z), tmpQ.setFromEuler(tmpE.set(0, o.ry, 0)), tmpS.set(o.s, 1, o.s))));
    im.computeBoundingSphere();
    im.renderOrder = 4;
    ch.add(im);
  }

  const brushAt = (x, z) => sampleGrid(brush, x, z);

  function update(camPos, time, farDist, ff = 1) {
    ffMat.uniforms.uAlpha.value = ff;
    fireflies.visible = ff > 0.02;
    const lim = farDist + CHUNK * 0.75;
    for (const ch of chunks) {
      const dx = ch.userData.cx - camPos.x, dz = ch.userData.cz - camPos.z;
      ch.visible = dx * dx + dz * dz < lim * lim;
    }
    ffMat.uniforms.uTime.value = time;
    ffMat.uniforms.uCenter.value.copy(camPos);
    shaftMat.uniforms.uTime.value = time;
  }

  return { terrain, treeGrid, brushAt, update, mats, chunks, shaftMat };
}
