// The map: Ulu Sungai Gelap, ~1 km across. Pure math, no three.js.
//
// One height grid is shared by the rendered ground and the physics, so the
// wheels sit exactly on what you see. Roads, rivers and places are generated
// here too, then "stamped" into per-cell fields the rest of the game reads.
//
// World units are metres. x/z run from -HALF to +HALF. Cells are CELL wide and
// every cell is split into two triangles along the (i,j+1)-(i+1,j) diagonal;
// sampleGrid() interpolates on those same triangles.

import { fbm, valueNoise, mulberry32, smoothstep, clamp, lerp } from './noise.js';

export const SIZE = 960;
export const HALF = SIZE / 2;
export const CELL = 2;
export const N = SIZE / CELL + 1; // vertices per side

// road kinds: half width, how hard it flattens the ground, how sunken, grip
export const ROAD = { TAR: 0, GRAVEL: 1, TRACK: 2, PATH: 3, ESTATE: 4 };
export const RT = [
  { name: 'tarmac', half: 3.3, flat: 1.0, sink: 0.08, grip: 1.15, rough: 0.05 },
  { name: 'gravel', half: 3.8, flat: 0.95, sink: 0.12, grip: 0.92, rough: 0.12 },
  { name: 'track', half: 2.4, flat: 0.75, sink: 0.3, grip: 0.8, rough: 0.35 },
  { name: 'path', half: 1.1, flat: 0.4, sink: 0.12, grip: 0.9, rough: 0.7 },
  { name: 'estate', half: 2.3, flat: 0.85, sink: 0.15, grip: 0.9, rough: 0.25 },
];

export function sampleGrid(arr, x, z) {
  const fx = clamp((x + HALF) / CELL, 0, N - 1.0001);
  const fz = clamp((z + HALF) / CELL, 0, N - 1.0001);
  const i = Math.floor(fx), j = Math.floor(fz);
  const u = fx - i, v = fz - j;
  const h00 = arr[j * N + i], h10 = arr[j * N + i + 1];
  const h01 = arr[(j + 1) * N + i], h11 = arr[(j + 1) * N + i + 1];
  if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
  return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}
const cellOf = (x, z) => [Math.round((x + HALF) / CELL), Math.round((z + HALF) / CELL)];

export function buildTerrain(seed = 7) {
  const rnd = mulberry32(seed);

  // ---- landform ------------------------------------------------------------------
  const broad = (x, z) =>
    fbm(x / 150, z / 150, 4, seed) * 24 + fbm(x / 48, z / 48, 3, seed + 5) * 5;
  const rough = (x, z) => fbm(x / 6.5, z / 6.5, 2, seed + 9) * 0.9;
  const edgeE = (x, z) => Math.max(Math.abs(x), Math.abs(z)) + fbm(x / 40, z / 40, 2, seed + 71) * 14;
  const INNER = HALF - 95; // everything interesting stays inside this

  // ---- rivers --------------------------------------------------------------------
  const rivers = [];
  {
    // Sungai Gelap: west to east
    const pts = [];
    let x = -HALF - 10, z = (rnd() - 0.5) * 160, ang = 0, target = (rnd() - 0.5) * 200;
    while (x < HALF + 10) {
      pts.push([x, z]);
      ang += (rnd() - 0.5) * 0.3 - (z - target) * 0.0015 - ang * 0.04;
      ang = clamp(ang, -0.85, 0.85);
      if (rnd() < 0.02) target = (rnd() - 0.5) * 300;
      x += Math.cos(ang) * 6; z += Math.sin(ang) * 6;
    }
    rivers.push({ name: 'Sungai Gelap', pts, half: 6.5 });
    // a tributary coming down from the north
    const main = pts;
    const t = [];
    let tx = (rnd() - 0.5) * 300, tz = -HALF - 10, ta = Math.PI / 2;
    for (let i = 0; i < 400; i++) {
      t.push([tx, tz]);
      let dMain = 1e9; for (const p of main) dMain = Math.min(dMain, Math.hypot(p[0] - tx, p[1] - tz));
      if (dMain < 5) break;
      ta += (rnd() - 0.5) * 0.35 + (Math.PI / 2 - ta) * 0.04;
      tx += Math.cos(ta) * 5; tz += Math.sin(ta) * 5;
    }
    rivers.push({ name: 'Anak Sungai Mati', pts: t, half: 3.2 });
  }
  // water level along each river: follows the land, only ever runs downhill
  for (const r of rivers) {
    r.level = r.pts.map(([x, z]) => broad(x, z) - 1.8);
    for (let pass = 0; pass < 3; pass++) for (let i = 1; i < r.level.length - 1; i++) r.level[i] = (r.level[i - 1] + r.level[i] + r.level[i + 1]) / 3;
    for (let i = 1; i < r.level.length; i++) r.level[i] = Math.min(r.level[i], r.level[i - 1]);
  }
  {
    // tributary must meet the main river at or above its level
    const [main, trib] = rivers;
    const end = trib.pts[trib.pts.length - 1];
    let bi = 0, bd = 1e9; main.pts.forEach((p, i) => { const d = Math.hypot(p[0] - end[0], p[1] - end[1]); if (d < bd) { bd = d; bi = i; } });
    const floor = main.level[bi];
    trib.level = trib.level.map((l) => Math.max(l, floor));
  }

  // ---- roads ---------------------------------------------------------------------
  const roads = [];
  const addRoad = (type, pts, name = '') => { if (pts.length > 2) roads.push({ type, pts, name }); return pts; };
  const nearRiver = (x, z, pad) => {
    for (const r of rivers) for (let i = 0; i < r.pts.length; i += 2) if (Math.hypot(r.pts[i][0] - x, r.pts[i][1] - z) < r.half + pad) return true;
    return false;
  };

  // a road that picks its way across the land: prefers gentle ground, can be pulled to a target
  function walk(x, z, ang, steps, { step = 5, wander = 0.3, target = null, pull = 0.5, stopAt = null, bound = INNER, avoidRiver = 0 } = {}) {
    const pts = [[x, z]];
    for (let i = 0; i < steps; i++) {
      let best = null;
      for (const turn of [-2, -1, -0.5, 0, 0.5, 1, 2]) {
        const a = ang + turn * 0.12 * (1 + wander);
        const nx = x + Math.cos(a) * step, nz = z + Math.sin(a) * step;
        let cost = Math.abs(broad(nx, nz) - broad(x, z)) / step * 10 + Math.abs(turn) * 0.15 + rnd() * wander;
        if (target) { let da = Math.atan2(target[1] - z, target[0] - x) - a; da = Math.atan2(Math.sin(da), Math.cos(da)); cost += Math.abs(da) * pull; }
        if (Math.max(Math.abs(nx), Math.abs(nz)) > bound) cost += 50;
        if (avoidRiver && nearRiver(nx, nz, avoidRiver)) cost += 3;
        if (!best || cost < best.cost) best = { cost, a, nx, nz };
      }
      ang = best.a; x = best.nx; z = best.nz;
      pts.push([x, z]);
      if (stopAt && stopAt(x, z)) break;
      if (target && Math.hypot(target[0] - x, target[1] - z) < step) break;
    }
    return pts;
  }

  // main gravel loop around the middle of the map
  const ring = [];
  {
    const R = 285, n = 300;
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI * 2;
      const r = R + fbm(Math.cos(t) * 2, Math.sin(t) * 2, 3, seed + 13) * 80;
      ring.push([Math.cos(t) * r, Math.sin(t) * r]);
    }
    addRoad(ROAD.GRAVEL, ring, 'Jalan Balak');
  }
  const ringAt = (t) => ring[Math.floor(((t % 1) + 1) % 1 * (ring.length - 1))];
  const ringDir = (p) => Math.atan2(p[1], p[0]);

  // the village: a tarmac spur off the loop, heading inward
  const vT = rnd();
  const vStart = ringAt(vT);
  const vRoad = addRoad(ROAD.TAR, walk(vStart[0], vStart[1], ringDir(vStart) + Math.PI, 36, { step: 5, wander: 0.05, target: [vStart[0] * 0.25, vStart[1] * 0.25], pull: 0.3 }), 'Jalan Kampung');
  const vMid = vRoad[Math.floor(vRoad.length * 0.55)];
  const vEnd = vRoad[vRoad.length - 1];
  // gravel carries on from the village across the middle to the far side of the loop
  const far = ringAt(vT + 0.5);
  addRoad(ROAD.GRAVEL, walk(vEnd[0], vEnd[1], Math.atan2(far[1] - vEnd[1], far[0] - vEnd[0]), 120, { step: 5, wander: 0.2, target: far, pull: 0.8 }), 'Jalan Tengah');

  // two old roads out to the edge, both closed
  const exits = [];
  for (const dt of [0.25, 0.68]) {
    const p = ringAt(vT + dt), a = ringDir(p);
    const pts = walk(p[0], p[1], a, 60, { step: 5, wander: 0.15, target: [Math.cos(a) * (HALF - 60), Math.sin(a) * (HALF - 60)], pull: 0.7, bound: HALF - 40 });
    addRoad(ROAD.GRAVEL, pts, 'Jalan Lama');
    exits.push(pts);
  }

  // oil palm estate: a block of land with a grid of estate roads
  const pT = vT + 0.42 + rnd() * 0.12;
  const pc = ringAt(pT);
  const plant = { x: pc[0] * 0.55, z: pc[1] * 0.55, w: 210, d: 170 };
  plant.x0 = plant.x - plant.w / 2; plant.x1 = plant.x + plant.w / 2; plant.z0 = plant.z - plant.d / 2; plant.z1 = plant.z + plant.d / 2;
  for (let gx = plant.x0; gx <= plant.x1 + 1; gx += 42) addRoad(ROAD.ESTATE, Array.from({ length: 18 }, (_, i) => [gx, plant.z0 + i * plant.d / 17]));
  for (let gz = plant.z0; gz <= plant.z1 + 1; gz += 42) addRoad(ROAD.ESTATE, Array.from({ length: 22 }, (_, i) => [plant.x0 + i * plant.w / 21, gz]));
  addRoad(ROAD.ESTATE, walk(plant.x, plant.z1, Math.atan2(pc[1] - plant.z1, pc[0] - plant.x), 40, { target: pc, pull: 0.9, wander: 0.1 }));
  const inPlantation = (x, z, pad = 0) => x > plant.x0 - pad && x < plant.x1 + pad && z > plant.z0 - pad && z < plant.z1 + pad;

  // high ground: telecom mast on the highest hill, a gravel spur up to it
  let hill = null, hill2 = null;
  for (let k = 0; k < 2500; k++) {
    const x = (rnd() * 2 - 1) * (INNER - 30), z = (rnd() * 2 - 1) * (INNER - 30);
    if (inPlantation(x, z, 30) || nearRiver(x, z, 40)) continue;
    const h = broad(x, z);
    if (!hill || h > hill.h) { if (hill && Math.hypot(hill.x - x, hill.z - z) > 180) hill2 = hill; hill = { x, z, h }; }
    else if ((!hill2 || h > hill2.h) && Math.hypot(hill.x - x, hill.z - z) > 180) hill2 = { x, z, h };
  }
  {
    let best = ring[0]; for (const p of ring) if (Math.hypot(p[0] - hill.x, p[1] - hill.z) < Math.hypot(best[0] - hill.x, best[1] - hill.z)) best = p;
    addRoad(ROAD.GRAVEL, walk(best[0], best[1], Math.atan2(hill.z - best[1], hill.x - best[0]), 90, { target: [hill.x, hill.z], pull: 0.7, wander: 0.2 }), 'Jalan Menara');
  }

  // logging tracks: rutted, muddy, wandering off the loop into the jungle
  const trackEnds = [];
  const tracks = [];
  for (let i = 0; i < 14; i++) {
    const p = ringAt(rnd()), outward = rnd() < 0.5;
    const a = ringDir(p) + (outward ? 0 : Math.PI) + (rnd() - 0.5) * 1.2;
    const pts = walk(p[0], p[1], a, 22 + Math.floor(rnd() * 30), { step: 5, wander: 0.5, stopAt: (x, z) => inPlantation(x, z, 8) });
    if (pts.length < 10) continue;
    addRoad(ROAD.TRACK, pts);
    tracks.push(pts);
    trackEnds.push({ x: pts[pts.length - 1][0], z: pts[pts.length - 1][1], a: Math.atan2(pts[pts.length - 1][1] - pts[pts.length - 3][1], pts[pts.length - 1][0] - pts[pts.length - 3][0]), pts });
  }

  // ---- places ----------------------------------------------------------------------
  const sites = [];
  const addSite = (type, name, x, z, a, r, extra = {}) => { const s = { type, name, x, z, a, r, ...extra }; sites.push(s); return s; };
  const farFromSites = (x, z, d) => sites.every((s) => Math.hypot(s.x - x, s.z - z) > d + s.r);
  const along = (pts, f, off = 0) => {
    const i = clamp(Math.floor(pts.length * f), 1, pts.length - 2);
    const a = Math.atan2(pts[i + 1][1] - pts[i - 1][1], pts[i + 1][0] - pts[i - 1][0]);
    return { x: pts[i][0] - Math.sin(a) * off, z: pts[i][1] + Math.cos(a) * off, a };
  };
  {
    const va = along(vRoad, 0.55);
    addSite('village', 'Kampung Long Gelap', vMid[0], vMid[1], va.a, 60, { road: vRoad });
    const fp = along(vRoad, 0.8, 34);
    addSite('field', 'Padang bola', fp.x, fp.z, fp.a, 26);
    addSite('plantation', 'Ladang Sawit Mati', plant.x, plant.z, 0, 0, { plant });
    addSite('telecom', 'Menara telekom', hill.x, hill.z, 0, 14);
    if (hill2) addSite('tower', 'Menara tinjau', hill2.x, hill2.z, 0, 7);
    // sawmill beside the loop, near the river if we can
    let sm = null;
    for (let i = 0; i < ring.length; i += 3) { const p = along(ring, i / ring.length, 28); if (nearRiver(p.x, p.z, 30) && !nearRiver(p.x, p.z, 12) && farFromSites(p.x, p.z, 40)) { sm = p; break; } }
    sm = sm || along(ring, vT + 0.15, 28);
    addSite('sawmill', 'Kilang papan', sm.x, sm.z, sm.a, 24);
    // quarry off the loop
    const q = along(ring, ((vT + 0.83) % 1), -34);
    if (farFromSites(q.x, q.z, 20)) addSite('quarry', 'Kuari lama', q.x, q.z, q.a, 26);
    // track ends: camp, landings, and wrecks halfway down tracks
    const ends = trackEnds.filter((e) => farFromSites(e.x, e.z, 20) && !nearRiver(e.x, e.z, 12));
    const kinds = [['camp', 'Kem 3', 18], ['landing', 'Tapak balak', 18], ['landing', 'Tapak balak 2', 18], ['hut', 'Pondok pemburu', 7]];
    kinds.forEach(([t, n, r], i) => { const e = ends[i]; if (e) addSite(t, n, e.x, e.z, e.a, r); });
    const mids = tracks.filter((t) => t.length > 16);
    if (mids[0]) { const p = along(mids[0], 0.55, 5.5); if (farFromSites(p.x, p.z, 8)) addSite('truck', 'Lori mati', p.x, p.z, p.a, 6); }
    if (mids[1]) { const p = along(mids[1], 0.45, -5); if (farFromSites(p.x, p.z, 8)) addSite('dozer', 'Jentolak', p.x, p.z, p.a, 6); }
    // deep jungle: limestone with a cave, a plane wreck, a shrine
    const lonely = (pad) => {
      for (let k = 0; k < 600; k++) {
        const x = (rnd() * 2 - 1) * (INNER - 20), z = (rnd() * 2 - 1) * (INNER - 20);
        if (inPlantation(x, z, 40) || nearRiver(x, z, 25) || !farFromSites(x, z, pad)) continue;
        let dr = 1e9; for (const r of roads) for (let i = 0; i < r.pts.length; i += 2) dr = Math.min(dr, Math.hypot(r.pts[i][0] - x, r.pts[i][1] - z));
        if (dr > 45 && dr < 110) return { x, z };
      }
      return null;
    };
    const k = lonely(60); if (k) addSite('karst', 'Batu Kapur', k.x, k.z, rnd() * 6, 22);
    const pw = lonely(60); if (pw) addSite('plane', 'Bangkai kapal terbang', pw.x, pw.z, rnd() * 6, 16);
    const sh = lonely(40); if (sh) addSite('shrine', 'Tempat keramat', sh.x, sh.z, rnd() * 6, 5);
    // closed road ends at the edge
    exits.forEach((pts, i) => { const e = along(pts, 0.86); addSite('gate', 'Jalan ditutup', e.x, e.z, e.a, 8); });
  }

  // footpaths: narrow, winding, everywhere; some lead to the lonely places
  const anyRoadPoint = () => { const r = roads[Math.floor(rnd() * roads.length)]; return r.pts[Math.floor(rnd() * r.pts.length)]; };
  for (const s of sites) {
    if (!['karst', 'plane', 'shrine', 'hut'].includes(s.type)) continue;
    let best = null;
    for (const r of roads) if (r.type !== ROAD.PATH) for (const p of r.pts) { const d = Math.hypot(p[0] - s.x, p[1] - s.z); if (!best || d < best.d) best = { d, p }; }
    if (best && best.d > 8) addRoad(ROAD.PATH, walk(best.p[0], best.p[1], Math.atan2(s.z - best.p[1], s.x - best.p[0]), 60, { step: 3, wander: 0.6, target: [s.x, s.z], pull: 0.6 }));
  }
  for (let i = 0; i < 34; i++) {
    const p = anyRoadPoint();
    if (!p || inPlantation(p[0], p[1], 5)) continue;
    addRoad(ROAD.PATH, walk(p[0], p[1], rnd() * Math.PI * 2, 12 + Math.floor(rnd() * 40), { step: 3, wander: 0.9 }));
  }

  // ---- stamp roads and rivers into the grid ---------------------------------------
  const NN = N * N;
  const heights = new Float32Array(NN);
  const roadW = new Float32Array(NN);
  const roadT = new Uint8Array(NN).fill(255);
  const roadY = new Float32Array(NN);
  const riverD = new Float32Array(NN).fill(1e4);
  const riverL = new Float32Array(NN);
  const riverH = new Float32Array(NN); // half width of the nearest river
  const mud = new Float32Array(NN);
  const wet = new Float32Array(NN);

  // road centreline heights: smoothed land, with the grade limited
  for (const r of roads) {
    const raw = r.pts.map(([x, z]) => broad(x, z));
    const W = r.type === ROAD.PATH ? 1 : 4;
    let y = raw.map((_, i) => { let s = 0, n = 0; for (let k = -W; k <= W; k++) { const v = raw[i + k]; if (v !== undefined) { s += v; n++; } } return s / n; });
    const maxG = r.type === ROAD.PATH ? 0.6 : r.type === ROAD.TRACK ? 0.9 : 0.55; // metres per 5 m step
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < y.length; i++) y[i] = clamp(y[i], y[i - 1] - maxG, y[i - 1] + maxG);
      for (let i = y.length - 2; i >= 0; i--) y[i] = clamp(y[i], y[i + 1] - maxG, y[i + 1] + maxG);
    }
    r.cy = y;
  }
  const stampSeg = (ax, az, bx, bz, reach, fn) => {
    const [i0, j0] = cellOf(Math.min(ax, bx) - reach, Math.min(az, bz) - reach);
    const [i1, j1] = cellOf(Math.max(ax, bx) + reach, Math.max(az, bz) + reach);
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    for (let j = Math.max(0, j0); j <= Math.min(N - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
      const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
      if (d <= reach) fn(j * N + i, d, t);
    }
  };
  for (const r of roads) {
    const spec = RT[r.type];
    for (let s = 0; s < r.pts.length - 1; s++) {
      const [ax, az] = r.pts[s], [bx, bz] = r.pts[s + 1];
      stampSeg(ax, az, bx, bz, spec.half + 3, (k, d, t) => {
        const w = 1 - smoothstep(spec.half, spec.half + 2.8, d);
        if (w > roadW[k] + 0.001 || (w >= roadW[k] - 0.001 && r.type < roadT[k])) {
          roadW[k] = w; roadT[k] = r.type; roadY[k] = lerp(r.cy[s], r.cy[s + 1], t);
        }
      });
    }
  }
  for (const r of rivers) {
    for (let s = 0; s < r.pts.length - 1; s++) {
      const [ax, az] = r.pts[s], [bx, bz] = r.pts[s + 1];
      stampSeg(ax, az, bx, bz, r.half + 45, (k, d, t) => {
        if (d < riverD[k]) { riverD[k] = d; riverL[k] = lerp(r.level[s], r.level[s + 1], t); riverH[k] = r.half; }
      });
    }
  }

  // ---- heights ------------------------------------------------------------------------
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -HALF + i * CELL, z = -HALF + j * CELL, k = j * N + i;
    let h = broad(x, z);
    const w = roadW[k], spec = w > 0 ? RT[roadT[k]] : null;
    h += rough(x, z) * (spec ? 1 - w * (1 - spec.rough) : 1);
    if (spec) h = lerp(h, roadY[k] - spec.sink, w * spec.flat);
    // ruts on logging tracks
    if (spec && roadT[k] === ROAD.TRACK) h -= Math.abs(Math.sin((x * 0.7 + z * 0.3) * 0.15)) * 0.05 * w;
    // river valley: bed, banks, and the valley sides
    if (riverD[k] < 1e3) {
      const d = riverD[k], half = riverH[k], L = riverL[k];
      const bed = d < half ? L - 1.3 * (1 - (d / half) ** 2) - 0.2 : L + 0.25 + Math.pow(d - half, 1.25) * 0.38;
      h = Math.min(h, bed);
      wet[k] = 1 - smoothstep(half - 0.5, half + 1.5, d);
    }
    heights[k] = h;
  }
  // level ground for places
  const flatten = (cx, cz, r, drop = 0) => {
    let sum = 0, n = 0;
    stampSeg(cx, cz, cx, cz, r * 0.5, (k) => { sum += heights[k]; n++; });
    const target = sum / Math.max(1, n) - drop;
    stampSeg(cx, cz, cx, cz, r, (k, d) => { heights[k] += (target - heights[k]) * (1 - smoothstep(r * 0.65, r, d)); });
  };
  for (const s of sites) {
    if (s.type === 'quarry') flatten(s.x, s.z, s.r, 4.5);
    else if (['village', 'field', 'sawmill', 'camp', 'landing', 'telecom'].includes(s.type)) flatten(s.x, s.z, s.r * (s.type === 'village' ? 0.9 : 1));
  }
  // map edge: jagged cliffs all the way round
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -HALF + i * CELL, z = -HALF + j * CELL, k = j * N + i;
    const e = edgeE(x, z);
    heights[k] += smoothstep(HALF - 80, HALF - 30, e) * 48 + smoothstep(HALF - 40, HALF - 5, e) * 30;
  }

  // ---- mud -----------------------------------------------------------------------------
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -HALF + i * CELL, z = -HALF + j * CELL, k = j * N + i;
    const m = valueNoise(x / 18, z / 18, seed + 33);
    let v = (m - 0.55) * 4;
    if (roadW[k] > 0) {
      const t = roadT[k], w = roadW[k];
      if (t === ROAD.TRACK) v = v * (1 - w) + (0.35 + m * 0.6) * w;
      else if (t === ROAD.PATH) v = v * (1 - w) + 0.25 * w;
      else v *= 1 - w;
    }
    if (riverD[k] < riverH[k] + 10) v += 0.4;
    mud[k] = clamp(v, 0, 1);
  }

  // ---- bridges where roads cross rivers ------------------------------------------
  const bridges = [];
  for (const r of roads) {
    if (r.type === ROAD.PATH) continue;
    let last = -99;
    for (let s = 1; s < r.pts.length - 1; s++) {
      const [x, z] = r.pts[s];
      const [ci, cj] = cellOf(x, z);
      if (ci < 0 || cj < 0 || ci >= N || cj >= N) continue;
      const k = cj * N + ci;
      if (riverD[k] > riverH[k] + 0.5 || s - last < 6) continue;
      last = s;
      const a = Math.atan2(r.pts[s + 1][1] - r.pts[s - 1][1], r.pts[s + 1][0] - r.pts[s - 1][0]);
      bridges.push({ x, z, a, len: 2 * riverH[k] + 14, w: r.type === ROAD.TRACK ? 4.2 : 5.6, L: riverL[k], type: r.type });
    }
  }

  // ---- obstacles the wheels can climb: fallen logs, rocks, bridge decks ---------------------
  const nearSite = (x, z, pad = 0) => {
    for (const s of sites) if (s.r && Math.hypot(x - s.x, z - s.z) < s.r + pad) return s;
    return null;
  };
  const roadAt = (x, z) => { const [i, j] = cellOf(x, z); if (i < 0 || j < 0 || i >= N || j >= N) return [0, 255]; const k = j * N + i; return [roadW[k], roadT[k]]; };
  const logs = [], rocks = [];
  const heightRaw = (x, z) => sampleGrid(heights, x, z);
  const lim = INNER + 20;
  let guard = 0;
  while (logs.length < 380 && guard++ < 8000) {
    const x = (rnd() * 2 - 1) * lim, z = (rnd() * 2 - 1) * lim;
    const [w, t] = roadAt(x, z);
    if (w > 0.2 && (t !== ROAD.TRACK && t !== ROAD.PATH || rnd() > 0.25)) continue;
    if (nearSite(x, z, 6) || inPlantation(x, z, 4)) continue;
    const len = 5 + rnd() * 9, r = 0.2 + rnd() * 0.24, a = rnd() * Math.PI;
    logs.push({ x, z, a, len, r, y: heightRaw(x, z) + r * 0.55, ca: Math.cos(a), sa: Math.sin(a) });
  }
  guard = 0;
  while (rocks.length < 700 && guard++ < 12000) {
    const x = (rnd() * 2 - 1) * lim, z = (rnd() * 2 - 1) * lim;
    const [ci, cj] = cellOf(x, z), k = cj * N + ci;
    const nearR = riverD[k] < riverH[k] + 8;
    if (!nearR && rnd() > 0.35) continue;
    if (roadW[k] > 0.3 || nearSite(x, z, 2)) continue;
    const r = 0.25 + rnd() * rnd() * 0.8;
    rocks.push({ x, z, r, y: heightRaw(x, z) - r * 0.35 });
  }

  const BIN = 10, BN = Math.ceil(SIZE / BIN);
  const bins = Array.from({ length: BN * BN }, () => []);
  const binAdd = (o, x0, z0, x1, z1) => {
    const a0 = clamp(Math.floor((x0 + HALF) / BIN), 0, BN - 1), a1 = clamp(Math.floor((x1 + HALF) / BIN), 0, BN - 1);
    const b0 = clamp(Math.floor((z0 + HALF) / BIN), 0, BN - 1), b1 = clamp(Math.floor((z1 + HALF) / BIN), 0, BN - 1);
    for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) bins[b * BN + a].push(o);
  };
  for (const l of logs) {
    const hx = l.ca * l.len / 2, hz = l.sa * l.len / 2;
    l.type = 0;
    binAdd(l, Math.min(-hx, hx) + l.x - 1, Math.min(-hz, hz) + l.z - 1, Math.max(-hx, hx) + l.x + 1, Math.max(-hz, hz) + l.z + 1);
  }
  for (const r of rocks) { r.type = 1; binAdd(r, r.x - r.r, r.z - r.r, r.x + r.r, r.z + r.r); }
  for (const b of bridges) {
    const ca = Math.cos(b.a), sa = Math.sin(b.a);
    b.y0 = sampleGrid(heights, b.x - ca * b.len / 2, b.z - sa * b.len / 2) + 0.1;
    b.y1 = sampleGrid(heights, b.x + ca * b.len / 2, b.z + sa * b.len / 2) + 0.1;
    b.mid = Math.max(b.y0, b.y1, b.L + 1.0);
    b.deck = { type: 2, x: b.x, z: b.z, ca, sa, len: b.len, w: b.w, y0: b.y0, y1: b.y1, mid: b.mid };
    const r = b.len / 2 + 1;
    binAdd(b.deck, b.x - r, b.z - r, b.x + r, b.z + r);
  }

  // deck height: ramps up from each bank to a level middle section
  function deckY(o, al) {
    const u = al / (o.len / 2), ramp = 0.3;
    if (u < -1 + ramp) return o.y0 + (o.mid - o.y0) * ((u + 1) / ramp);
    if (u > 1 - ramp) return o.y1 + (o.mid - o.y1) * ((1 - u) / ramp);
    return o.mid;
  }
  function obstacleTop(x, z) {
    const a = Math.floor((x + HALF) / BIN), b = Math.floor((z + HALF) / BIN);
    if (a < 0 || b < 0 || a >= BN || b >= BN) return -1e9;
    let top = -1e9;
    for (const o of bins[b * BN + a]) {
      const dx = x - o.x, dz = z - o.z;
      if (o.type === 0) {
        const al = dx * o.ca + dz * o.sa;
        if (Math.abs(al) > o.len / 2) continue;
        const ac = -dx * o.sa + dz * o.ca;
        if (Math.abs(ac) >= o.r) continue;
        const t = o.y + Math.sqrt(o.r * o.r - ac * ac);
        if (t > top) top = t;
      } else if (o.type === 2) {
        const al = dx * o.ca + dz * o.sa, ac = -dx * o.sa + dz * o.ca;
        if (Math.abs(al) > o.len / 2 || Math.abs(ac) > o.w / 2) continue;
        const t = deckY(o, al);
        if (t > top) top = t;
      } else {
        const d2 = dx * dx + dz * dz;
        if (d2 >= o.r * o.r) continue;
        const t = o.y + Math.sqrt(o.r * o.r - d2) * 0.8;
        if (t > top) top = t;
      }
    }
    return top;
  }

  const groundAt = (x, z) => sampleGrid(heights, x, z);
  const heightAt = (x, z) => Math.max(groundAt(x, z), obstacleTop(x, z));
  const riverAt = (x, z) => { const [i, j] = cellOf(x, z); if (i < 0 || j < 0 || i >= N || j >= N) return null; const k = j * N + i; return riverD[k] < riverH[k] + 1 ? riverL[k] : null; };
  const waterDepthAt = (x, z) => { const L = riverAt(x, z); return L === null ? 0 : Math.max(0, L - heightAt(x, z)); };

  function surfaceAt(x, z) {
    const m = sampleGrid(mud, x, z);
    const w = waterDepthAt(x, z) > 0 ? 1 : 0;
    const [rw, rt] = roadAt(x, z);
    let grip = lerp(1.0, 0.5, m);
    if (rw > 0.5 && rt !== 255) grip = lerp(grip, RT[rt].grip * (rt === ROAD.TRACK ? lerp(1, 0.6, m) : 1), rw);
    return { mud: rt === ROAD.TAR && rw > 0.5 ? 0 : m, water: w, grip: grip * (w ? 0.75 : 1), road: rw > 0.5 ? rt : 255 };
  }

  // start: rolling into the empty village on the tarmac
  const s0 = vRoad[3], s1 = vRoad[7];
  const start = { x: s0[0], z: s0[1], heading: Math.atan2(s1[0] - s0[0], s1[1] - s0[1]) };

  return {
    heights, roadW, roadT, riverD, riverH, riverL, mud, wet,
    roads, rivers, bridges, sites, plant, logs, rocks,
    heightAt, groundAt, surfaceAt, waterDepthAt, riverAt, deckY, nearSite, inPlantation, roadAt,
    broad, start, INNER,
  };
}
