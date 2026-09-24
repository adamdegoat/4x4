// Mini map (top right, turns with you) and the full map on the pause screen.
// The terrain picture is painted once at load; each frame only redraws a
// rotated window of it, a few times a second.

import { N, HALF, SIZE } from './terrain.js';

export const PLACES = {
  camp: 'Kem 3 (logging camp)',
  bridge: 'Gelap bridge',
  landing: 'Log landing',
  truck: 'Dead truck',
  tower: 'Lookout tower',
  karst: 'Batu Kapur (limestone)',
};

function paintBase(T) {
  const W = N - 1;
  const c = document.createElement('canvas');
  c.width = c.height = W;
  const g = c.getContext('2d');
  const img = g.createImageData(W, W);
  const h = T.heights;
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const k = j * N + i;
    // hill shading from the slope, light from the north-west
    const dx = h[k + 1] - h[k], dz = h[k + N] - h[k];
    const shade = Math.max(0.55, Math.min(1.35, 1 - (dx + dz) * 0.35));
    let r = 52, gg = 74, b = 44; // jungle
    const tr = T.trailW[k];
    r += (150 - r) * tr * 0.9; gg += (122 - gg) * tr * 0.9; b += (80 - b) * tr * 0.9;
    if (T.wet[k] > 0.5) { r = 62; gg = 84; b = 92; } // the stream
    const e = Math.max(Math.abs(i - W / 2), Math.abs(j - W / 2)) / (W / 2);
    const edge = e > 0.82 ? 0.55 : 1; // the impassable ridge reads darker
    const o = (j * W + i) * 4;
    img.data[o] = r * shade * edge; img.data[o + 1] = gg * shade * edge; img.data[o + 2] = b * shade * edge; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // the bridge as a pale plank line
  const s = T.sites.bridge, px = (x) => (x + HALF) / SIZE * W;
  g.strokeStyle = '#d8c79a'; g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(px(s.x - Math.cos(s.a) * s.len / 2), px(s.z - Math.sin(s.a) * s.len / 2));
  g.lineTo(px(s.x + Math.cos(s.a) * s.len / 2), px(s.z + Math.sin(s.a) * s.len / 2));
  g.stroke();
  return c;
}

function icon(g, x, y, key, size = 1) {
  g.save();
  g.translate(x, y);
  g.scale(size, size);
  g.lineWidth = 1.5;
  g.strokeStyle = '#141a10';
  g.fillStyle = '#ffe7a8';
  g.beginPath();
  if (key === 'tower') { g.moveTo(0, -6); g.lineTo(5, 5); g.lineTo(-5, 5); g.closePath(); }
  else if (key === 'karst') { g.moveTo(-6, 5); g.lineTo(-2, -5); g.lineTo(1, 1); g.lineTo(3, -3); g.lineTo(6, 5); g.closePath(); }
  else if (key === 'bridge') { g.rect(-6, -2.5, 12, 5); }
  else { g.rect(-4.5, -4.5, 9, 9); }
  g.fill(); g.stroke();
  g.restore();
}

export class MiniMap {
  constructor(T, el, fullEl) {
    this.T = T;
    this.base = paintBase(T);
    this.el = el;
    this.g = el.getContext('2d');
    this.fullEl = fullEl;
    this.acc = 1;
    this.viewR = 85; // metres from centre to rim
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const css = this.el.clientWidth || 112;
    this.el.width = this.el.height = Math.round(css * dpr);
  }

  update(dt, car) {
    this.acc += dt;
    if (this.acc < 0.066) return; // ~15 updates a second is plenty
    this.acc = 0;
    const g = this.g, W = this.el.width;
    if (!W) return;
    const R = W / 2, W0 = this.base.width;
    const k = R / this.viewR;             // screen px per metre
    const toImg = W0 / SIZE;              // base px per metre
    const fwd = { x: 0, z: -1 };
    // forward in world from the car's quaternion
    const q = car.quat;
    fwd.x = -(2 * (q.x * q.z + q.w * q.y));
    fwd.z = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const theta = -Math.PI / 2 - Math.atan2(fwd.z, fwd.x);

    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#1a2014'; g.fillRect(0, 0, W, W);
    g.translate(R, R);
    g.rotate(theta);
    g.scale(k / toImg, k / toImg);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.base, -(car.pos.x + HALF) * toImg, -(car.pos.z + HALF) * toImg);
    g.restore();

    // landmarks stay upright
    const c = Math.cos(theta), s = Math.sin(theta);
    for (const key in this.T.sites) {
      const p = this.T.sites[key];
      const dx = (p.x - car.pos.x) * k, dz = (p.z - car.pos.z) * k;
      let sx = dx * c - dz * s, sy = dx * s + dz * c;
      const d = Math.hypot(sx, sy), lim = R - 8;
      const off = d > lim;
      if (off) { sx *= lim / d; sy *= lim / d; } // pin to the rim, pointing the way
      g.globalAlpha = off ? 0.55 : 1;
      icon(g, R + sx, R + sy, key, (W / 112) * (off ? 0.7 : 0.9));
    }
    g.globalAlpha = 1;

    // north marker on the rim
    const na = -Math.PI / 2 + theta;
    g.fillStyle = '#e9e1c2';
    g.font = `${Math.round(W / 9)}px VT323, monospace`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', R + Math.cos(na) * (R - W / 14), R + Math.sin(na) * (R - W / 14));

    // you: an arrow pointing up
    g.fillStyle = '#ff7a2a'; g.strokeStyle = '#141a10'; g.lineWidth = W / 90;
    g.beginPath();
    const u = W / 22;
    g.moveTo(R, R - u * 1.4); g.lineTo(R + u, R + u); g.lineTo(R, R + u * 0.4); g.lineTo(R - u, R + u); g.closePath();
    g.fill(); g.stroke();

    g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(233,225,194,.5)'; g.lineWidth = W / 60; g.stroke();
  }

  // big map for the pause screen, north up, every place named
  drawFull(car) {
    const el = this.fullEl, dpr = Math.min(devicePixelRatio || 1, 2);
    const css = el.clientHeight || 300;
    el.width = el.height = Math.round(css * dpr);
    const g = el.getContext('2d'), W = el.width, k = W / SIZE;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.base, 0, 0, W, W);
    g.font = `${Math.round(W / 22)}px VT323, monospace`;
    g.textBaseline = 'middle';
    for (const key in this.T.sites) {
      const p = this.T.sites[key];
      const x = (p.x + HALF) * k, y = (p.z + HALF) * k;
      icon(g, x, y, key, W / 260);
      const left = x > W * 0.62;
      g.textAlign = left ? 'right' : 'left';
      const tx = x + (left ? -1 : 1) * W / 40;
      g.lineWidth = W / 110; g.strokeStyle = '#141a10'; g.strokeText(PLACES[key], tx, y);
      g.fillStyle = '#ffe7a8'; g.fillText(PLACES[key], tx, y);
    }
    // you
    const x = (car.pos.x + HALF) * k, y = (car.pos.z + HALF) * k;
    const q = car.quat;
    const fx = -(2 * (q.x * q.z + q.w * q.y)), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const a = Math.atan2(fz, fx) + Math.PI / 2;
    g.save(); g.translate(x, y); g.rotate(a);
    const u = W / 45;
    g.fillStyle = '#ff7a2a'; g.strokeStyle = '#141a10'; g.lineWidth = W / 200;
    g.beginPath(); g.moveTo(0, -u * 1.4); g.lineTo(u, u); g.lineTo(0, u * 0.4); g.lineTo(-u, u); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
}
