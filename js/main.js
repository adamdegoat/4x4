import * as THREE from 'three';
import { makeTextures, PsxPipeline } from './psx.js';
import { buildWorld } from './world.js';
import { Vehicle } from './vehicle.js';
import { buildCockpit, HEAD } from './cockpit.js';
import { Sound } from './audio.js';
import { Input } from './input.js';

const Q = new URLSearchParams(location.search);
const LINES = +Q.get('res') || 240;       // vertical render resolution, the PS1 ran 240
const FOG = 0.052;
const FAR = 70;

if (Q.has('touch')) document.body.classList.add('touch');
if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

// ---- renderer ----
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
document.getElementById('view').appendChild(renderer.domElement);
const psx = new PsxPipeline(renderer, LINES);

const scene = new THREE.Scene();
const fogCol = new THREE.Color(0x0e1619);
scene.background = fogCol;
scene.fog = new THREE.FogExp2(fogCol, FOG);

const camera = new THREE.PerspectiveCamera(62, 1, 0.05, FAR);

// night: barely any moon gets through the canopy
scene.add(new THREE.HemisphereLight(0x3a4a66, 0x0c0a06, 1.4));
const moon = new THREE.DirectionalLight(0x7f93b8, 0.8);
moon.position.set(-30, 60, 20);
scene.add(moon);

// ---- world + car ----
const tex = makeTextures();
const world = buildWorld(scene, tex, 7);
const car = new Vehicle(world);
const carObj = new THREE.Group();
scene.add(carObj);
const cockpit = buildCockpit(carObj);
const s = world.terrain.start;
car.place(s.x, s.z, s.heading);

const sound = new Sound();
const input = new Input(document.body);
input.onLights = () => { cockpit.setLights(!cockpit.lightsOn); document.getElementById('btnLights').classList.toggle('off', !cockpit.lightsOn); if (!cockpit.lightsOn) cockpit.setRoof(false), document.getElementById('btnRoof').classList.remove('lit'); };
input.onRoof = () => { if (!cockpit.lightsOn) return; cockpit.setRoof(!cockpit.roofOn); document.getElementById('btnRoof').classList.toggle('lit', cockpit.roofOn); };
input.onReset = () => car.unflip();

// ---- sizing ----
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  psx.setSize(w, h);
}
psx.mat.uniforms.uTint.value.setScalar(1.15);
addEventListener('resize', resize);
resize();

// ---- camera: head on a soft neck, shake on knocks ----
const neck = new THREE.Vector3(), neckVel = new THREE.Vector3();
const prevVel = new THREE.Vector3();
let trauma = 0;
const _a = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
let lookYaw = 0;

function updateCamera(dt) {
  carObj.position.copy(car.pos);
  carObj.quaternion.copy(car.quat);
  carObj.updateMatrixWorld();
  // acceleration in car space pushes the head the other way
  _a.subVectors(car.vel, prevVel).divideScalar(Math.max(dt, 1e-3));
  prevVel.copy(car.vel);
  _q.copy(car.quat).invert();
  _a.applyQuaternion(_q);
  const target = new THREE.Vector3(-_a.x * 0.006, -_a.y * 0.004, -_a.z * 0.006).clampLength(0, 0.12);
  // spring-damper
  neckVel.addScaledVector(new THREE.Vector3().subVectors(target, neck), 90 * dt);
  neckVel.multiplyScalar(Math.exp(-11 * dt));
  neck.addScaledVector(neckVel, dt);

  const e = car.events;
  trauma = Math.min(1, trauma + e.impact * 0.9 + e.bump * 0.35);
  trauma = Math.max(0, trauma - dt * 1.6);
  const sh = trauma * trauma;
  const t = performance.now() / 1000;

  const head = HEAD.clone().add(neck);
  camera.position.copy(head).applyMatrix4(carObj.matrixWorld);
  // look a little into the turn, like a driver does
  lookYaw += ((-car.steer * 0.35) - lookYaw) * Math.min(1, dt * 4);
  _e.set(-0.06 + Math.sin(t * 41) * 0.02 * sh + neck.z * 0.4, lookYaw + Math.sin(t * 37) * 0.025 * sh, Math.sin(t * 29) * 0.02 * sh - neck.x * 0.3, 'YXZ');
  camera.quaternion.copy(car.quat).multiply(_q.setFromEuler(_e));
}

// ---- loop ----
const STEP = 1 / 120;
let acc = 0, last = performance.now(), running = false, paused = false;
let fpsT = 0, fpsN = 0, fps = 0;
const fpsEl = document.getElementById('fps');
const resetBtn = document.getElementById('btnReset');
if (Q.has('fps')) fpsEl.style.display = 'block';

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.1) dt = 0.1;
  if (running && !paused) {
    input.update(dt);
    car.input.steer = input.steer; car.input.gas = input.gas; car.input.brake = input.brake;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 6) { car.step(STEP); acc -= STEP; n++; }
    if (n === 6) acc = 0;
    resetBtn.classList.toggle('show', car.upsideTime > 1.5 || (car.upright < 0.5 && Math.abs(car.speed) < 1));
  }
  updateCamera(dt);
  cockpit.update(car, dt);
  world.update(camera.position, now / 1000, FAR);
  if (running) sound.update(car, dt);
  else for (const k in car.events) car.events[k] = 0;
  psx.render(scene, camera);

  fpsN++; fpsT += dt;
  if (fpsT > 0.5) { fps = fpsN / fpsT; fpsN = 0; fpsT = 0; fpsEl.textContent = fps.toFixed(0) + ' fps'; }
}
requestAnimationFrame(frame);

// ---- start / pause ----
const startEl = document.getElementById('start');
startEl.addEventListener('pointerdown', async (e) => {
  e.preventDefault();
  startEl.classList.add('gone');
  document.body.classList.add('playing');
  running = true; paused = false; last = performance.now();
  sound.start();
  try {
    if (document.body.classList.contains('touch') && document.documentElement.requestFullscreen && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      await screen.orientation?.lock?.('landscape').catch(() => {});
    }
  } catch (_) { /* iOS has no fullscreen for pages; fine */ }
});
input.onPause = () => {
  if (!running) return;
  paused = !paused;
  document.body.classList.toggle('paused', paused);
  if (paused) sound.ctx?.suspend(); else { sound.ctx?.resume(); last = performance.now(); }
};
document.getElementById('resume').addEventListener('pointerdown', (e) => { e.preventDefault(); input.onPause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && running && !paused) input.onPause(); });

// test hooks for the harness
window.__game = { car, world, camera, input, cockpit, get fps() { return fps; }, scene, renderer };
document.body.classList.add('ready');
