// The ground: one height grid shared by the rendered mesh and the physics,
// so the wheels sit exactly on what you see. Pure math, no three.js.
//
// World units are metres. x/z run from -HALF to +HALF. Cells are CELL wide and
// every cell is split into two triangles along the (i,j+1)-(i+1,j) diagonal;
// heightAt() interpolates on those same triangles.

import { fbm, valueNoise, mulberry32, smoothstep, clamp, lerp } from './noise.js';

export const SIZE = 400;
export const HALF = SIZE / 2;
export const CELL = 2;
export const N = SIZE / CELL + 1; // vertices per side

export function buildTerrain(seed = 7) {
  const rnd = mulberry32(seed);

  // --- old logging trail: a smooth random walk across the map -------------
  const trail = [];
  {
    let x = -HALF + 25, z = -120, ang = 0.25;
    while (x < HALF - 25 && trail.length < 400) {
      trail.push([x, z]);
      ang += (rnd() - 0.5) * 0.5 - z * 0.0009; // gently pulled back to the middle
      ang = clamp(ang, -1.0, 1.0);
      x += Math.cos(ang) * 4; z += Math.sin(ang) * 4;
    }
  }
  // a second branch heading north from the middle
  const branch = [];
  {
    const s = trail[Math.floor(trail.length * 0.45)];
    let x = s[0], z = s[1], ang = Math.PI / 2 + 0.3;
    while (z < HALF - 30 && branch.length < 200) {
      branch.push([x, z]);
      ang += (rnd() - 0.5) * 0.45 + (Math.PI / 2 - ang) * 0.05;
      x += Math.cos(ang) * 4; z += Math.sin(ang) * 4;
    }
  }
  const paths = [trail, branch];

  // --- stream: a meandering channel crossing west to east --------------------
  const streamZ = (x) => 55 + Math.sin(x / 47) * 28 + Math.sin(x / 13 + 1.7) * 5;

  const distToPaths = (x, z) => {
    let best = 1e9;
    for (const p of paths) {
      for (let i = 0; i < p.length - 1; i++) {
        const ax = p[i][0], az = p[i][1], bx = p[i + 1][0], bz = p[i + 1][1];
        const dx = bx - ax, dz = bz - az;
        const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
        const ex = ax + dx * t - x, ez = az + dz * t - z;
        const d = ex * ex + ez * ez;
        if (d < best) best = d;
      }
    }
    return Math.sqrt(best);
  };

  // Broad landform, used on its own for the trail bed and the water line.
  const broad = (x, z) =>
    fbm(x / 95, z / 95, 4, seed) * 13 + fbm(x / 34, z / 34, 3, seed + 5) * 3.2;

  const heights = new Float32Array(N * N);
  const trailW = new Float32Array(N * N); // 1 on the trail, 0 off it
  const mud = new Float32Array(N * N);    // 0..1 how boggy
  const wet = new Float32Array(N * N);    // 1 in the stream bed

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      const k = j * N + i;
      let h = broad(x, z);
      // rough ground: roots, ruts and hummocks
      const rough = fbm(x / 6.5, z / 6.5, 2, seed + 9) * 0.9;

      const dp = distToPaths(x, z);
      const onTrail = 1 - smoothstep(2.5, 6.5, dp);
      trailW[k] = onTrail;
      h += rough * (1 - onTrail * 0.75);
      // the trail is slightly sunken, worn in by old logging trucks
      h -= onTrail * 0.35;

      // stream channel
      const ds = Math.abs(z - streamZ(x));
      const bank = 1 - smoothstep(3.5, 11, ds);
      wet[k] = 1 - smoothstep(3.0, 5.5, ds);
      h -= bank * 2.4;

      // mud: patches that like low ground and the trail
      const m = valueNoise(x / 18, z / 18, seed + 33);
      mud[k] = clamp((m - 0.55) * 4 + onTrail * 0.35 + bank * 0.4, 0, 1);

      // map edge: a steep ridge you cannot drive over
      const e = Math.max(Math.abs(x), Math.abs(z));
      h += smoothstep(HALF - 40, HALF, e) * 28;

      heights[k] = h;
    }
  }

  // flat water surface per x column: a little below the bed rim
  const waterY = (x) => {
    const z = streamZ(x);
    return broad(x, z) - 1.35;
  };

  // --- landmarks: where the named places sit --------------------------------
  const sites = {};
  {
    // bridge: where a path crosses the stream
    let best = null;
    for (const p of paths) for (let i = 2; i < p.length - 2; i++) {
      const d = Math.abs(p[i][1] - streamZ(p[i][0]));
      if (!best || d < best.d) best = { d, p, i };
    }
    const { p, i } = best;
    const a = Math.atan2(p[i + 2][1] - p[i - 2][1], p[i + 2][0] - p[i - 2][0]);
    sites.bridge = { x: p[i][0], z: streamZ(p[i][0]), a, len: 24, w: 4.2 };

    const side = (pt, nxt, off) => { // point offset to the left of the path
      const a = Math.atan2(nxt[1] - pt[1], nxt[0] - pt[0]);
      return { x: pt[0] - Math.sin(a) * off, z: pt[1] + Math.cos(a) * off, a };
    };
    const j = Math.floor(trail.length * 0.45);
    sites.camp = side(trail[j - 6], trail[j - 5], -17);
    sites.truck = side(trail[Math.floor(trail.length * 0.78)], trail[Math.floor(trail.length * 0.78) + 1], 5.5);
    const e = branch[branch.length - 1], e2 = branch[branch.length - 3];
    sites.landing = { x: e[0], z: e[1], a: Math.atan2(e[1] - e2[1], e[0] - e2[0]) };

    // tower on the highest open ground, karst outcrop somewhere quiet
    let hi = null, karst = null;
    for (let k = 0; k < 900; k++) {
      const x = (rnd() * 2 - 1) * 140, z = (rnd() * 2 - 1) * 140;
      if (distToPaths(x, z) < 12 || Math.abs(z - streamZ(x)) < 14) continue;
      const far = (o) => !o || Math.hypot(o.x - x, o.z - z) > 60;
      const h = broad(x, z);
      if (!hi || h > hi.h) hi = { x, z, h };
      if (Object.values(sites).every(far) && (!karst || distToPaths(x, z) > distToPaths(karst.x, karst.z)) && distToPaths(x, z) < 45) karst = { x, z };
    }
    sites.tower = { x: hi.x, z: hi.z };
    sites.karst = karst || { x: 100, z: -100 };
  }
  // level the ground for the camp and the log landing
  const flatten = (cx, cz, r) => {
    let sum = 0, n = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      if (Math.hypot(x - cx, z - cz) < r * 0.5) { sum += heights[j * N + i]; n++; }
    }
    const target = sum / Math.max(1, n);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL, d = Math.hypot(x - cx, z - cz);
      if (d < r) { const k = j * N + i; heights[k] += (target - heights[k]) * (1 - smoothstep(r * 0.65, r, d)); mud[k] *= 0.4; }
    }
  };
  flatten(sites.camp.x, sites.camp.z, 18);
  flatten(sites.landing.x, sites.landing.z, 20);
  const nearSite = (x, z, pad = 0) => {
    const r = { camp: 16, landing: 18, truck: 6, tower: 7, karst: 12, bridge: 14 };
    for (const k in sites) if (Math.hypot(x - sites[k].x, z - sites[k].z) < r[k] + pad) return k;
    return null;
  };

  // --- obstacles the wheels can climb: fallen logs and rocks ----------------
  const logs = [];
  const rocks = [];
  const heightRaw = (x, z) => sampleGrid(heights, x, z);
  let guard = 0;
  while (logs.length < 70 && guard++ < 2000) {
    const x = (rnd() * 2 - 1) * (HALF - 45), z = (rnd() * 2 - 1) * (HALF - 45);
    const nearTrail = distToPaths(x, z) < 6;
    if (nearTrail && rnd() > 0.35) continue; // a few block the trail on purpose
    if (nearSite(x, z, 6)) continue;
    const len = 5 + rnd() * 9, r = 0.2 + rnd() * 0.24, a = rnd() * Math.PI;
    const y = heightRaw(x, z) + r * 0.55; // half sunk into the leaf litter
    logs.push({ x, z, a, len, r, y, ca: Math.cos(a), sa: Math.sin(a) });
  }
  guard = 0;
  while (rocks.length < 160 && guard++ < 3000) {
    const x = (rnd() * 2 - 1) * (HALF - 40), z = (rnd() * 2 - 1) * (HALF - 40);
    const near = Math.abs(z - streamZ(x)) < 10 ? 1 : 0; // rocks cluster in the stream
    if (!near && rnd() > 0.45) continue;
    if (nearSite(x, z, 2)) continue;
    const r = 0.25 + rnd() * rnd() * 0.8;
    rocks.push({ x, z, r, y: heightRaw(x, z) - r * 0.35 });
  }

  // spatial bins for obstacles (10 m)
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
  // the bridge deck: a driveable plank surface, sloped bank to bank
  {
    const b = sites.bridge, ca = Math.cos(b.a), sa = Math.sin(b.a);
    const y0 = sampleGrid(heights, b.x - ca * b.len / 2, b.z - sa * b.len / 2) + 0.12;
    const y1 = sampleGrid(heights, b.x + ca * b.len / 2, b.z + sa * b.len / 2) + 0.12;
    const mid = Math.max(y0, y1, waterY(b.x) + 0.9);
    const deck = { type: 2, x: b.x, z: b.z, ca, sa, len: b.len, w: b.w, y0, y1, mid };
    b.deck = deck;
    const r = b.len / 2 + 1;
    binAdd(deck, b.x - r, b.z - r, b.x + r, b.z + r);
  }

  function obstacleTop(x, z) {
    const a = Math.floor((x + HALF) / BIN), b = Math.floor((z + HALF) / BIN);
    if (a < 0 || b < 0 || a >= BN || b >= BN) return -1e9;
    let top = -1e9;
    for (const o of bins[b * BN + a]) {
      if (o.type === 0) {
        const dx = x - o.x, dz = z - o.z;
        const along = dx * o.ca + dz * o.sa;
        if (Math.abs(along) > o.len / 2) continue;
        const across = -dx * o.sa + dz * o.ca;
        if (Math.abs(across) >= o.r) continue;
        const t = o.y + Math.sqrt(o.r * o.r - across * across);
        if (t > top) top = t;
      } else if (o.type === 2) {
        const dx = x - o.x, dz = z - o.z;
        const along = dx * o.ca + dz * o.sa, across = -dx * o.sa + dz * o.ca;
        if (Math.abs(along) > o.len / 2 || Math.abs(across) > o.w / 2) continue;
        const t = deckY(o, along);
        if (t > top) top = t;
      } else {
        const dx = x - o.x, dz = z - o.z, d2 = dx * dx + dz * dz;
        if (d2 >= o.r * o.r) continue;
        const t = o.y + Math.sqrt(o.r * o.r - d2) * 0.8;
        if (t > top) top = t;
      }
    }
    return top;
  }

  // deck height: ramps up from each bank to a level middle section
  function deckY(o, along) {
    const u = along / (o.len / 2); // -1..1
    const ramp = 0.35;
    if (u < -1 + ramp) return o.y0 + (o.mid - o.y0) * ((u + 1) / ramp);
    if (u > 1 - ramp) return o.y1 + (o.mid - o.y1) * ((1 - u) / ramp);
    return o.mid;
  }

  const heightAt = (x, z) => Math.max(sampleGrid(heights, x, z), obstacleTop(x, z));
  const groundAt = (x, z) => sampleGrid(heights, x, z);
  const fieldAt = (arr, x, z) => sampleGrid(arr, x, z);

  // surface grip + drag at a point
  function surfaceAt(x, z) {
    const m = fieldAt(mud, x, z);
    const w = Math.abs(z - streamZ(x)) < 9 && heightAt(x, z) < waterY(x) ? 1 : 0; // only the stream itself, and not on the bridge
    return { mud: m, water: w, grip: lerp(1.0, 0.5, m) * (w ? 0.75 : 1) };
  }

  const start = { x: trail[3][0], z: trail[3][1], heading: Math.atan2(trail[6][0] - trail[3][0], trail[6][1] - trail[3][1]) };

  const waterDepthAt = (x, z) => (Math.abs(z - streamZ(x)) < 9 ? Math.max(0, waterY(x) - heightAt(x, z)) : 0);

  return { sites, nearSite, deckY, waterDepthAt, heights, trailW, mud, wet, logs, rocks, paths, streamZ, waterY, heightAt, groundAt, surfaceAt, distToPaths, start, broad };
}

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
