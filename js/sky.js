// Time of day: the drive starts late afternoon and sinks into night.
// One set of keyframes drives the fog, sky light, sun/moon, the dappled
// sunlight on the jungle floor and the fireflies.

import * as THREE from 'three';

export const DAY = {
  startHour: 16.75,   // 4:45 pm
  endHour: 19.75,     // 7:45 pm, full night; it stays night after this
  minutes: 7,         // real minutes from start to full night
};

// t: 0 = 4:45 pm, 1 = night
const KEYS = [
  // t = 0 is the game's daylight: heavy overcast, grey-green haze, flat light
  { t: 0.0,  fog: 0x6c776f, dens: 0.036, sky: 0xa3ada4, gnd: 0x2e2c24, hemi: 2.5, sun: 0xcfd6cc, sunI: 1.2, elev: 55, dap: 0.3, ff: 0, tint: 1.06 },
  { t: 0.42, fog: 0x9c8a64, dens: 0.033, sky: 0xd8b284, gnd: 0x33271a, hemi: 1.7, sun: 0xffab62, sunI: 2.1, elev: 9, dap: 0.8, ff: 0, tint: 1.0 },
  { t: 0.6,  fog: 0x4a4b58, dens: 0.040, sky: 0x6a6a88, gnd: 0x1a1510, hemi: 1.4, sun: 0xff7a48, sunI: 0.6, elev: 1, dap: 0.25, ff: 0.3, tint: 1.05 },
  { t: 0.78, fog: 0x1b232d, dens: 0.047, sky: 0x44547a, gnd: 0x100d09, hemi: 1.4, sun: 0x8090b8, sunI: 0.6, elev: 40, dap: 0.0, ff: 0.8, tint: 1.12 },
  { t: 1.0,  fog: 0x0e1619, dens: 0.052, sky: 0x3a4a66, gnd: 0x0c0a06, hemi: 1.4, sun: 0x7f93b8, sunI: 0.8, elev: 55, dap: 0.0, ff: 1, tint: 1.15 },
];

export const dappleUniforms = {
  uDapple: { value: 1 },
  uDapTex: { value: null },
  uDapShift: { value: new THREE.Vector2() },
};

// Patch for world materials: sun flecks through the canopy, stronger by day.
export function dappleHook(sh) {
  sh.uniforms.uDapple = dappleUniforms.uDapple;
  sh.uniforms.uDapTex = dappleUniforms.uDapTex;
  sh.uniforms.uDapShift = dappleUniforms.uDapShift;
  sh.vertexShader = 'varying vec2 vDapXZ;\n' + sh.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    vec4 dwp = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      dwp = instanceMatrix * dwp;
    #endif
    dwp = modelMatrix * dwp;
    vDapXZ = dwp.xz + vec2(dwp.y * 0.35, dwp.y * 0.2);`
  );
  sh.fragmentShader = 'uniform float uDapple; uniform sampler2D uDapTex; uniform vec2 uDapShift; varying vec2 vDapXZ;\n' + sh.fragmentShader.replace(
    '#include <map_fragment>',
    `#include <map_fragment>
    float dap = texture2D(uDapTex, vDapXZ / 17.0 + uDapShift).r;
    diffuseColor.rgb *= mix(1.0, 0.42 + dap * 1.55, uDapple);`
  );
}

function dappleTexture() {
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
  let a = 99;
  const r = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  // soft sun spots, drawn wrapped so the texture tiles
  for (let i = 0; i < 70; i++) {
    const x = r() * s, y = r() * s, rad = 3 + r() * r() * 16, v = 0.35 + r() * 0.65;
    for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, `rgba(255,255,255,${v})`);
      gr.addColorStop(0.55, `rgba(255,255,255,${v * 0.6})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter; // PS1: hard-edged light patches
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

const cA = new THREE.Color(), cB = new THREE.Color();
const lerpHex = (out, a, b, t) => out.set(a).lerp(cB.set(b), t);

export class Sky {
  constructor(scene, hemi, sun, startT = 0) {
    this.scene = scene; this.hemi = hemi; this.sun = sun;
    this.t = startT;
    dappleUniforms.uDapTex.value = dappleTexture();
    this.state = { dark: 0, ff: 0, tint: 1 };
  }

  // hh:mm pm for the clock
  clock() {
    const h = DAY.startHour + (DAY.endHour - DAY.startHour) * Math.min(1, this.t) + Math.max(0, this.t - 1) * 3;
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh >= 12 && hh < 24 ? 'PM' : 'AM'}`;
  }

  update(dt, time, running) {
    if (running) this.t += dt / (DAY.minutes * 60);
    const t = Math.min(1, this.t);
    let i = 0;
    while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const k = THREE.MathUtils.smoothstep(t, a.t, b.t);
    const L = (p) => a[p] + (b[p] - a[p]) * k;

    lerpHex(this.scene.fog.color, a.fog, b.fog, k);
    this.scene.fog.density = L('dens');
    this.scene.background = this.scene.fog.color;
    lerpHex(this.hemi.color, a.sky, b.sky, k);
    lerpHex(this.hemi.groundColor, a.gnd, b.gnd, k);
    this.hemi.intensity = L('hemi');
    lerpHex(this.sun.color, a.sun, b.sun, k);
    this.sun.intensity = L('sunI');
    // sun sets in the west (-x); after dusk the same light becomes the moon, high in the east
    const elev = THREE.MathUtils.degToRad(L('elev'));
    const az = t < 0.7 ? -1 : 1;
    this.sun.position.set(az * Math.cos(elev) * 80, Math.sin(elev) * 80 + 2, 25);

    dappleUniforms.uDapple.value = L('dap');
    // leaves sway: the flecks drift a touch
    dappleUniforms.uDapShift.value.set(Math.sin(time * 0.35) * 0.004, Math.cos(time * 0.27) * 0.004);

    this.state.ff = L('ff');
    this.state.tint = L('tint');
    this.state.dark = THREE.MathUtils.clamp((t - 0.45) / 0.45, 0, 1); // 0 by day, 1 at night
    return this.state;
  }
}
