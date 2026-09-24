// Mini map (top right, turns with you) and the full map on the pause screen.
// The map picture is painted once at load: shaded land, rivers, every road by
// kind. Each frame only redraws a rotated window of it, ~15 times a second.

import { N, HALF, SIZE, ROAD } from './terrain.js';

const ROAD_STYLE = {
  [ROAD.TAR]: ['#2c2c2a', 5.5],
  [ROAD.GRAVEL]: ['#c9b98f', 5],
  [ROAD.TRACK]: ['#8a6a44', 3.2],
  [ROAD.PATH]: ['#b8a680', 1.4],
  [ROAD.ESTATE]: ['#a88c5c', 2.6],
};
const MAPPX = 960; // base picture: 1 px per metre

function paintBase(T) {
  const W = N - 1;
  const small = document.createElement('canvas');
  small.width = small.height = W;
  const g0 = small.getContext('2d');
  const img = g0.createImageData(W, W);
  const h = T.heights;
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const k = j * N + i;
    const dx = h[k + 1] - h[k], dz = h[k + N] - h[k];
    const shade = Math.max(0.5, Math.min(1.35, 1 - (dx + dz) * 0.3));
    let r = 48, g = 70, b = 42;
    const slope = Math.max(Math.abs(dx), Math.abs(dz)) / 2;
    if (slope > 0.8) { r = 110; g = 108; b = 96; } // cliffs
    if (T.inPlantation(-HALF + i * 2, -HALF + j * 2)) { r = 70; g = 84; b = 44; }
    const o = (j * W + i) * 4;
    img.data[o] = r * shade; img.data[o + 1] = g * shade; img.data[o + 2] = b * shade; img.data[o + 3] = 255;
  }
  g0.putImageData(img, 0, 0);
  const c = document.createElement('canvas');
  c.width = c.height = MAPPX;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.drawImage(small, 0, 0, MAPPX, MAPPX);
  const px = (v) => (v + HALF) / SIZE * MAPPX;
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const r of T.rivers) {
    g.strokeStyle = '#3e5a66'; g.lineWidth = r.half * 2 + 2;
    g.beginPath(); r.pts.forEach(([x, z], i) => (i ? g.lineTo(px(x), px(z)) : g.moveTo(px(x), px(z)))); g.stroke();
  }
  for (const type of [ROAD.PATH, ROAD.TRACK, ROAD.ESTATE, ROAD.GRAVEL, ROAD.TAR]) {
    const [col, w] = ROAD_STYLE[type];
    g.strokeStyle = col; g.lineWidth = w;
    if (type === ROAD.PATH) g.setLineDash([3, 3]); else g.setLineDash([]);
    for (const r of T.roads) if (r.type === type) { g.beginPath(); r.pts.forEach(([x, z], i) => (i ? g.lineTo(px(x), px(z)) : g.moveTo(px(x), px(z)))); g.stroke(); }
  }
  g.setLineDash([]);
  for (const b of T.bridges) {
    g.strokeStyle = '#e0cfa0'; g.lineWidth = 4;
    g.beginPath();
    g.moveTo(px(b.x - Math.cos(b.a) * b.len / 2), px(b.z - Math.sin(b.a) * b.len / 2));
    g.lineTo(px(b.x + Math.cos(b.a) * b.len / 2), px(b.z + Math.sin(b.a) * b.len / 2));
    g.stroke();
  }
  return c;
}

function icon(g, x, y, type, size = 1) {
  g.save();
  g.translate(x, y);
  g.scale(size, size);
  g.lineWidth = 1.5;
  g.strokeStyle = '#141a10';
  g.fillStyle = type === 'gate' || type === 'shrine' || type === 'plane' ? '#d9573a' : '#ffe7a8';
  g.beginPath();
  if (type === 'tower' || type === 'telecom') { g.moveTo(0, -6); g.lineTo(5, 5); g.lineTo(-5, 5); g.closePath(); }
  else if (type === 'karst') { g.moveTo(-6, 5); g.lineTo(-2, -5); g.lineTo(1, 1); g.lineTo(3, -3); g.lineTo(6, 5); g.closePath(); }
  else if (type === 'gate') { g.rect(-6, -2, 12, 4); }
  else if (type === 'village') { g.moveTo(-5, 5); g.lineTo(-5, -1); g.lineTo(0, -6); g.lineTo(5, -1); g.lineTo(5, 5); g.closePath(); }
  else if (type === 'plane' || type === 'shrine') { g.arc(0, 0, 4.5, 0, Math.PI * 2); }
  else { g.rect(-4.5, -4.5, 9, 9); }
  g.fill(); g.stroke();
  g.restore();
}

const forward = (q) => ({ x: -(2 * (q.x * q.z + q.w * q.y)), z: -(1 - 2 * (q.x * q.x + q.y * q.y)) });

export class MiniMap {
  constructor(T, el, fullEl) {
    this.T = T;
    this.base = paintBase(T);
    this.el = el; this.g = el.getContext('2d');
    this.fullEl = fullEl;
    this.acc = 1;
    this.viewR = 95;
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const css = this.el.clientWidth || 112;
    this.el.width = this.el.height = Math.round(css * dpr);
  }

  update(dt, car) {
    this.acc += dt;
    if (this.acc < 0.066) return;
    this.acc = 0;
    const g = this.g, W = this.el.width;
    if (!W) return;
    const R = W / 2, k = R / this.viewR, toImg = MAPPX / SIZE;
    const f = forward(car.quat);
    const theta = -Math.PI / 2 - Math.atan2(f.z, f.x);
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#1a2014'; g.fillRect(0, 0, W, W);
    g.translate(R, R); g.rotate(theta); g.scale(k / toImg, k / toImg);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.base, -(car.pos.x + HALF) * toImg, -(car.pos.z + HALF) * toImg);
    g.restore();
    const c = Math.cos(theta), s = Math.sin(theta);
    for (const p of this.T.sites) {
      if (p.type === 'field') continue;
      const dx = (p.x - car.pos.x) * k, dz = (p.z - car.pos.z) * k;
      let sx = dx * c - dz * s, sy = dx * s + dz * c;
      const d = Math.hypot(sx, sy), lim = R - 8, off = d > lim;
      if (off) continue; // only what's around you; the pause map shows the rest
      icon(g, R + sx, R + sy, p.type, (W / 112) * 0.9);
    }
    const na = -Math.PI / 2 + theta;
    g.fillStyle = '#e9e1c2';
    g.font = `${Math.round(W / 9)}px VT323, monospace`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', R + Math.cos(na) * (R - W / 14), R + Math.sin(na) * (R - W / 14));
    g.fillStyle = '#ff7a2a'; g.strokeStyle = '#141a10'; g.lineWidth = W / 90;
    const u = W / 22;
    g.beginPath(); g.moveTo(R, R - u * 1.4); g.lineTo(R + u, R + u); g.lineTo(R, R + u * 0.4); g.lineTo(R - u, R + u); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(233,225,194,.5)'; g.lineWidth = W / 60; g.stroke();
  }

  // the big map on the pause screen, north up, every place named
  drawFull(car) {
    const el = this.fullEl, dpr = Math.min(devicePixelRatio || 1, 2);
    const css = el.clientHeight || 300;
    el.width = el.height = Math.round(css * dpr);
    const g = el.getContext('2d'), W = el.width, k = W / SIZE;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base, 0, 0, W, W);
    g.font = `${Math.round(W / 26)}px VT323, monospace`;
    g.textBaseline = 'middle';
    for (const p of this.T.sites) {
      if (p.type === 'field' || p.type === 'gate') continue;
      const x = (p.x + HALF) * k, y = (p.z + HALF) * k;
      icon(g, x, y, p.type, W / 300);
      const left = x > W * 0.6;
      g.textAlign = left ? 'right' : 'left';
      const tx = x + (left ? -1 : 1) * W / 45;
      g.lineWidth = W / 130; g.strokeStyle = '#141a10'; g.strokeText(p.name, tx, y);
      g.fillStyle = '#ffe7a8'; g.fillText(p.name, tx, y);
    }
    for (const p of this.T.sites) if (p.type === 'gate') icon(g, (p.x + HALF) * k, (p.z + HALF) * k, 'gate', W / 300);
    const x = (car.pos.x + HALF) * k, y = (car.pos.z + HALF) * k, f = forward(car.quat);
    g.save(); g.translate(x, y); g.rotate(Math.atan2(f.z, f.x) + Math.PI / 2);
    const u = W / 45;
    g.fillStyle = '#ff7a2a'; g.strokeStyle = '#141a10'; g.lineWidth = W / 200;
    g.beginPath(); g.moveTo(0, -u * 1.4); g.lineTo(u, u); g.lineTo(0, u * 0.4); g.lineTo(-u, u); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
}
