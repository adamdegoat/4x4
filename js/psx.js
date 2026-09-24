// The PS1 look: tiny nearest-filtered textures, vertices that snap to a coarse
// screen grid (the classic PS1 wobble), a low-resolution render upscaled with
// hard pixels, 15-bit colour with ordered dithering, and film grain.

import * as THREE from 'three';

export const psxUniforms = {
  uSnap: { value: new THREE.Vector2(320, 240) }, // snapping grid in screen pixels
};

// Patch a material so its vertices snap. Cockpit parts skip this (they're
// glued to the camera, and snapping would make them shimmer).
export function psxify(mat, extra = null, key = '') {
  mat.onBeforeCompile = (sh) => {
    if (extra) extra(sh);
    sh.uniforms.uSnap = psxUniforms.uSnap;
    sh.vertexShader = 'uniform vec2 uSnap;\n' + sh.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      if (gl_Position.w > 0.5) {
        vec2 g = uSnap * 0.5;
        vec2 ndc = gl_Position.xy / gl_Position.w;
        ndc = floor(ndc * g + 0.5) / g;
        gl_Position.xy = ndc * gl_Position.w;
      }`
    );
  };
  mat.customProgramCacheKey = () => 'psx' + key;
  return mat;
}

// ---- tiny procedural textures ---------------------------------------------------
function canvasTex(size, draw, { repeat = true, alpha = false } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.premultiplyAlpha = false;
  if (alpha) t.format = THREE.RGBAFormat;
  return t;
}

function rng(seed) {
  let a = seed;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

const px = (g, x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };

export function makeTextures() {
  const T = {};

  // leaf litter and soil
  T.ground = canvasTex(64, (g, s) => {
    const r = rng(3);
    g.fillStyle = '#4a3a28'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      const v = r();
      const col = v < 0.3 ? '#3a2c1d' : v < 0.55 ? '#5c4630' : v < 0.7 ? '#6b5233' : v < 0.8 ? '#43462a' : v < 0.88 ? '#7a5a2e' : '#2b2116';
      const x = (r() * s) | 0, y = (r() * s) | 0;
      g.fillStyle = col;
      g.fillRect(x, y, 1 + ((r() * 3) | 0), 1 + ((r() * 2) | 0));
    }
  });

  // bark: vertical grooves, lichen blotches
  T.bark = canvasTex(32, (g, s) => {
    const r = rng(11);
    g.fillStyle = '#5b5046'; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x++) {
      const v = r();
      g.fillStyle = v < 0.25 ? '#3d352e' : v < 0.5 ? '#6a5f53' : v < 0.6 ? '#7d7466' : '#554a40';
      g.fillRect(x, 0, 1, s);
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = r() < 0.5 ? '#6f7a55' : '#8a8f78';
      g.fillRect((r() * s) | 0, (r() * s) | 0, 2 + ((r() * 3) | 0), 1 + ((r() * 3) | 0));
    }
  });

  // mossy log
  T.log = canvasTex(32, (g, s) => {
    const r = rng(21);
    g.fillStyle = '#4b4232'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) {
      const v = r();
      g.fillStyle = v < 0.4 ? '#4f6030' : v < 0.6 ? '#3a3226' : v < 0.8 ? '#62553e' : '#36441f';
      g.fillRect((r() * s) | 0, (r() * s) | 0, 1 + ((r() * 4) | 0), 1);
    }
  });

  T.rock = canvasTex(32, (g, s) => {
    const r = rng(5);
    g.fillStyle = '#5d5d55'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 300; i++) {
      const v = r();
      g.fillStyle = v < 0.3 ? '#4a4a44' : v < 0.55 ? '#6e6d63' : v < 0.75 ? '#4f5e36' : '#3a3a35';
      g.fillRect((r() * s) | 0, (r() * s) | 0, 1 + ((r() * 2) | 0), 1 + ((r() * 2) | 0));
    }
  });

  // broad jungle leaves on a card (alpha)
  T.leaves = canvasTex(64, (g, s) => {
    const r = rng(7);
    g.clearRect(0, 0, s, s);
    for (let i = 0; i < 26; i++) {
      const cx = 6 + r() * (s - 12), cy = 6 + r() * (s - 14);
      const a = r() * Math.PI * 2, L = 7 + r() * 9, W = 2.5 + r() * 3.5;
      const v = r();
      g.fillStyle = v < 0.3 ? '#2f4a22' : v < 0.6 ? '#3e5c2a' : v < 0.85 ? '#264019' : '#50703a';
      g.beginPath();
      g.ellipse(cx, cy, L, W, a, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#1c2e12'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx - Math.cos(a) * L, cy - Math.sin(a) * L); g.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); g.stroke();
    }
    hardAlpha(g, s);
  }, { repeat: false, alpha: true });

  // fern / palm frond: a spine with leaflets
  T.frond = canvasTex(64, (g, s) => {
    const r = rng(9);
    g.clearRect(0, 0, s, s);
    for (let f = 0; f < 3; f++) {
      const x0 = 14 + f * 18;
      g.strokeStyle = '#2d4520'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x0, s); g.quadraticCurveTo(x0 + 6, s * 0.5, x0 + (r() - 0.5) * 10, 2); g.stroke();
      for (let y = 4; y < s - 2; y += 3) {
        const t = y / s, span = 3 + t * 8;
        const cx = x0 + (1 - t) * 4 * (r() - 0.3);
        g.fillStyle = r() < 0.5 ? '#3b5a26' : '#2e4a1e';
        g.fillRect(cx - span, y, span, 2);
        g.fillStyle = r() < 0.5 ? '#46692d' : '#355222';
        g.fillRect(cx, y + 1, span, 2);
      }
    }
    hardAlpha(g, s);
  }, { repeat: false, alpha: true });

  // hanging vine / liana strip
  T.vine = canvasTex(16, (g, s) => {
    const r = rng(13);
    g.clearRect(0, 0, s, s);
    g.fillStyle = '#3b3526'; g.fillRect(7, 0, 2, s);
    for (let y = 0; y < s; y += 2) {
      if (r() < 0.6) { g.fillStyle = r() < 0.5 ? '#35502a' : '#2a4020'; g.fillRect(r() < 0.5 ? 4 : 9, y, 3, 2); }
    }
  }, { repeat: true, alpha: true });

  // palm crown frond: long single frond
  T.palm = canvasTex(64, (g, s) => {
    const r = rng(17);
    g.clearRect(0, 0, s, s);
    g.strokeStyle = '#3a3f22'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(s / 2, s); g.lineTo(s / 2, 0); g.stroke();
    for (let y = 2; y < s - 2; y += 2) {
      const t = 1 - Math.abs(y / s - 0.45) * 1.6;
      const span = Math.max(2, t * 28);
      g.fillStyle = r() < 0.5 ? '#3f5a24' : '#2f4a1c';
      g.fillRect(s / 2 - span, y + (r() < 0.5 ? 1 : 0), span - 1, 1);
      g.fillStyle = r() < 0.5 ? '#48652b' : '#35521f';
      g.fillRect(s / 2 + 1, y + (r() < 0.5 ? 1 : 0), span - 1, 1);
    }
    hardAlpha(g, s);
  }, { repeat: false, alpha: true });

  return T;
}

// alpha to 0/1 and fade out the outer pixel ring so cards never show seams
function hardAlpha(g, s) {
  const d = g.getImageData(0, 0, s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = (y * s + x) * 4;
    const edge = x === 0 || y === 0 || x === s - 1 || y === s - 1;
    d.data[i + 3] = !edge && d.data[i + 3] > 100 ? 255 : 0;
  }
  g.putImageData(d, 0, 0);
}

// ---- low-res render + PS1 output pass ----------------------------------------------
export class PsxPipeline {
  constructor(renderer, lines = 240) {
    this.renderer = renderer;
    this.lines = lines;
    this.rt = new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: true, samples: 0, type: THREE.UnsignedByteType,
    });
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        uRes: { value: new THREE.Vector2(4, 4) },
        uSeed: { value: 0 },
        uGrain: { value: 0.06 },
        uFlash: { value: 0 },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        precision highp float;
        uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uSeed; uniform float uGrain; uniform float uFlash; uniform vec3 uTint;
        varying vec2 vUv;
        float bayer(vec2 p){
          // 4x4 ordered dither
          int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
          int i = x + y * 4;
          float m[16];
          m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;
          m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
          for (int k=0;k<16;k++) if (k==i) return m[k]/16.0 - 0.5;
          return 0.0;
        }
        float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031 + uSeed); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
        void main(){
          vec2 pix = floor(vUv * uRes);
          vec2 uv = (pix + 0.5) / uRes;
          vec3 c = texture2D(tDiffuse, uv).rgb; // hardware-decoded to linear (sRGB target)
          c *= uTint;
          c = mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
          // grain, per low-res pixel, fresh seed every frame
          c += (hash(pix) - 0.5) * uGrain;
          // vignette
          vec2 v = vUv - 0.5; c *= 1.0 - dot(v, v) * 0.9;
          c += uFlash;
          // 15-bit colour with ordered dither (the PS1's own trick)
          c = floor(c * 31.0 + bayer(pix) + 0.5) / 31.0;
          gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h) {
    const lh = this.lines;
    const lw = Math.round(lh * (w / h));
    this.rt.setSize(lw, lh);
    this.mat.uniforms.uRes.value.set(lw, lh);
    psxUniforms.uSnap.value.set(lw, lh);
  }

  render(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    r.setRenderTarget(null);
    this.mat.uniforms.uSeed.value = Math.random();
    r.render(this.scene, this.cam);
  }
}
