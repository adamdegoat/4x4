// What you see from the driver's seat: bonnet, dash with lit gauges, steering
// wheel, windscreen frame, snorkel, roll cage. Plus the headlights and their
// beams. All of it lives in the car's local space (-z forward).

import * as THREE from 'three';

export const HEAD = new THREE.Vector3(0, 0.74, 0.16);

function gaugeTexture(label, max, step) {
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#0a0c08'; g.beginPath(); g.arc(32, 32, 31, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#8fa66a'; g.fillStyle = '#b8cf86'; g.lineWidth = 2;
  for (let v = 0; v <= max; v += step) {
    const a = Math.PI * 0.75 + (v / max) * Math.PI * 1.5;
    g.beginPath(); g.moveTo(32 + Math.cos(a) * 24, 32 + Math.sin(a) * 24); g.lineTo(32 + Math.cos(a) * 29, 32 + Math.sin(a) * 29); g.stroke();
  }
  g.font = 'bold 9px monospace'; g.textAlign = 'center';
  g.fillText(label, 32, 48);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildCockpit(car) {
  const g = new THREE.Group();
  car.add(g);
  const paint = new THREE.MeshLambertMaterial({ color: 0x2f3a2a, fog: false });       // army-green body
  const dark = new THREE.MeshLambertMaterial({ color: 0x151613, fog: false });
  const metal = new THREE.MeshLambertMaterial({ color: 0x3d3f3a, fog: false });
  const rubber = new THREE.MeshLambertMaterial({ color: 0x0c0c0c, fog: false });

  const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); return b; };
  const bar = (a, b, r, m) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 6), m);
    cyl.position.copy(a).addScaledVector(d, 0.5);
    cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.add(cyl); return cyl;
  };

  // bonnet: a flat-topped wedge with a centre bulge
  {
    const shape = new THREE.Shape();
    shape.moveTo(-0.66, 0); shape.lineTo(0.66, 0); shape.lineTo(0.62, 0.9); shape.lineTo(-0.62, 0.9); shape.lineTo(-0.66, 0);
    const bonnet = new THREE.Mesh(new THREE.ShapeGeometry(shape), paint);
    bonnet.rotation.x = -Math.PI / 2 - 0.09;
    bonnet.position.set(0, 0.3, -0.64);
    g.add(bonnet);
    box(0.5, 0.05, 0.85, paint, 0, 0.3, -1.05).rotation.x = 0.09; // power bulge
    box(1.34, 0.28, 0.06, paint, 0, 0.18, -1.55); // grille face (seen when nose-down)
    // wings / fenders either side
    box(0.12, 0.08, 0.95, paint, -0.69, 0.3, -1.07);
    box(0.12, 0.08, 0.95, paint, 0.69, 0.3, -1.07);
  }

  // dashboard + binnacle
  box(1.34, 0.2, 0.36, dark, 0, 0.29, -0.46);
  box(0.46, 0.16, 0.12, dark, 0, 0.44, -0.37);
  const gauges = {};
  const makeGauge = (x, label, max, step) => {
    const m = new THREE.MeshBasicMaterial({ map: gaugeTexture(label, max, step), fog: false });
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.075, 12), m);
    face.position.set(x, 0.49, -0.305);
    face.rotation.x = -0.35;
    g.add(face);
    const nm = new THREE.MeshBasicMaterial({ color: 0xff7a2a, fog: false });
    const needle = new THREE.Mesh(new THREE.PlaneGeometry(0.006, 0.06), nm);
    needle.geometry.translate(0, 0.028, 0.002);
    face.add(needle);
    return needle;
  };
  gauges.speed = makeGauge(-0.1, 'KM/H', 80, 10);
  gauges.rpm = makeGauge(0.1, 'RPM', 6, 1);

  // steering wheel on a column
  const wheel = new THREE.Group();
  wheel.position.set(0, 0.45, -0.24);
  wheel.rotation.x = -0.42;
  g.add(wheel);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.022, 4, 12), rubber);
  wheel.add(rim);
  for (const a of [0, 1.9, -1.9]) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.17, 0.012), rubber);
    sp.geometry.translate(0, -0.085, 0);
    sp.rotation.z = a;
    wheel.add(sp);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 6), rubber);
  hub.rotation.x = Math.PI / 2; wheel.add(hub);

  // windscreen frame, roll cage, snorkel
  const A = (s) => new THREE.Vector3(0.64 * s, 0.39, -0.62), T = (s) => new THREE.Vector3(0.6 * s, 1.18, -0.4);
  bar(A(-1), T(-1), 0.03, paint); bar(A(1), T(1), 0.03, paint);
  bar(T(-1), T(1), 0.035, paint);
  bar(new THREE.Vector3(-0.64, 0.39, -0.62), new THREE.Vector3(0.64, 0.39, -0.62), 0.03, paint);
  // cage over the head and behind
  const R = (s) => new THREE.Vector3(0.62 * s, 1.2, 0.55);
  bar(T(-1), R(-1), 0.03, metal); bar(T(1), R(1), 0.03, metal);
  bar(R(-1), R(1), 0.03, metal);
  bar(R(-1), new THREE.Vector3(-0.66, 0.3, 0.62), 0.03, metal); bar(R(1), new THREE.Vector3(0.66, 0.3, 0.62), 0.03, metal);
  // door tops (it's an open little rig)
  box(0.06, 0.08, 1.2, paint, -0.7, 0.42, 0.0);
  box(0.06, 0.08, 1.2, paint, 0.7, 0.42, 0.0);
  // snorkel up the right pillar
  bar(new THREE.Vector3(0.78, 0.25, -0.7), new THREE.Vector3(0.74, 1.22, -0.46), 0.04, dark);
  const scoop = box(0.1, 0.1, 0.12, dark, 0.74, 1.26, -0.5); scoop.rotation.x = 0.3;
  // mirrors
  for (const s of [-1, 1]) {
    bar(new THREE.Vector3(0.66 * s, 0.45, -0.58), new THREE.Vector3(0.82 * s, 0.55, -0.6), 0.012, dark);
    box(0.16, 0.1, 0.03, dark, 0.86 * s, 0.57, -0.6);
  }
  // roof light bar (switchable, a trade-off later: brighter, but visible from far)
  const barMesh = box(0.8, 0.07, 0.08, dark, 0, 1.24, -0.42);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0x222222, fog: false });
  const lamps = box(0.72, 0.045, 0.01, lampMat, 0, 1.24, -0.465);

  // dash glow: a faint light so the cabin reads as a silhouette
  const dashLight = new THREE.PointLight(0x9fbf70, 0.6, 1.6, 1.5);
  dashLight.position.set(0, 0.5, -0.15);
  g.add(dashLight);

  // ---- headlights ----
  const lights = [];
  const beams = [];
  const beamGeo = new THREE.ConeGeometry(3.4, 20, 10, 1, true);
  beamGeo.translate(0, -10, 0);
  beamGeo.rotateX(Math.PI / 2); // cone opens toward -z
  { // fade the beam along its length with vertex colour
    const p = beamGeo.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { const t = 1 - Math.min(1, -p.getZ(i) / 20); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = t * t; }
    beamGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0.022, blending: THREE.AdditiveBlending, depthWrite: false, vertexColors: true, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const L = new THREE.SpotLight(0xffe8b8, 90, 50, 0.62, 0.6, 1.25);
    L.position.set(0.5 * s, 0.25, -1.58);
    L.target.position.set(0.9 * s, -0.9, -14);
    g.add(L); g.add(L.target);
    lights.push(L);
    const b = new THREE.Mesh(beamGeo, beamMat);
    b.position.copy(L.position);
    b.renderOrder = 5;
    g.add(b);
    beams.push(b);
  }
  // roof bar lights (off by default)
  const roof = new THREE.SpotLight(0xf4f6ff, 0, 90, 0.6, 0.35, 1.0);
  roof.position.set(0, 1.25, -0.5);
  roof.target.position.set(0, -0.6, -20);
  g.add(roof); g.add(roof.target);

  // point each beam cone along its light
  beams.forEach((b, i) => {
    const L = lights[i];
    const dir = new THREE.Vector3().subVectors(L.target.position, L.position).normalize();
    b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
  });

  let lightsOn = true, roofOn = false;
  function setLights(on) { lightsOn = on; lights.forEach((l) => (l.intensity = on ? 90 : 0)); beams.forEach((b) => (b.visible = on)); }
  function setRoof(on) { roofOn = on; roof.intensity = on ? 260 : 0; lampMat.color.set(on ? 0xfff6dd : 0x222222); }

  function update(v, dt) {
    wheel.rotation.z = -v.steer * 2.4;
    const kmh = Math.abs(v.speed) * 3.6;
    gauges.speed.rotation.z = -(Math.PI * 0.75 + (Math.min(kmh, 80) / 80) * Math.PI * 1.5) + Math.PI / 2 + Math.PI;
    const rpm = 0.9 + Math.min(5, Math.abs(v.speed) * 0.28 % 2.6 + v.input.gas * 1.4 + Math.abs(v.speed) * 0.08);
    gauges.rpm.rotation.z = -(Math.PI * 0.75 + (rpm / 6) * Math.PI * 1.5) + Math.PI / 2 + Math.PI;
  }

  return { group: g, update, setLights, setRoof, get lightsOn() { return lightsOn; }, get roofOn() { return roofOn; } };
}
