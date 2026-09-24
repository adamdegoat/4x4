// Touch first. Left thumb: GAS and BRAKE. Right thumb: the steering pad pinned
// bottom-right. Swipe anywhere else to turn your head and look around; the view
// drifts back to the front when you let go. Keyboard + mouse drag on desktop.

export class Input {
  constructor(root) {
    this.steer = 0; this.gas = 0; this.brake = 0;
    this.look = { yaw: 0, pitch: 0 };
    this.keys = new Set();
    this.onPause = null; this.onReset = null;

    // ---- steering pad: the knob sits under your thumb, centre = straight -------------
    const pad = root.querySelector('#steerPad'), knob = root.querySelector('#steerKnob');
    this.padId = null; this.padSteer = 0;
    const padSet = (e) => {
      const r = pad.getBoundingClientRect();
      const half = r.width / 2 - 26;
      let v = (e.clientX - (r.left + r.width / 2)) / half;
      v = Math.max(-1, Math.min(1, v));
      if (Math.abs(v) < 0.06) v = 0;
      this.padSteer = v;
      knob.style.transform = `translateX(${v * half}px)`;
    };
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (this.padId !== null) return;
      this.padId = e.pointerId; pad.setPointerCapture(e.pointerId); pad.classList.add('on');
      padSet(e);
    });
    pad.addEventListener('pointermove', (e) => { if (e.pointerId === this.padId) padSet(e); });
    const padEnd = (e) => {
      if (e.pointerId !== this.padId) return;
      this.padId = null; this.padSteer = 0; pad.classList.remove('on');
      knob.style.transform = 'translateX(0)';
    };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(ev, padEnd);

    // ---- free look: drag anywhere else ----------------------------------------------------
    const zone = root.querySelector('#lookZone');
    this.lookId = null; this.lookX = 0; this.lookY = 0; this.lookIdle = 0;
    zone.addEventListener('pointerdown', (e) => {
      if (this.lookId !== null) return;
      this.lookId = e.pointerId; this.lookX = e.clientX; this.lookY = e.clientY;
      zone.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      const k = 3.2 / Math.max(innerWidth, 1); // a full-width swipe turns you ~180 degrees
      this.look.yaw = Math.max(-2.6, Math.min(2.6, this.look.yaw - (e.clientX - this.lookX) * k));
      this.look.pitch = Math.max(-0.9, Math.min(0.7, this.look.pitch - (e.clientY - this.lookY) * k));
      this.lookX = e.clientX; this.lookY = e.clientY;
      this.lookIdle = 0;
      document.body.classList.add('looked');
    });
    const lookEnd = (e) => { if (e.pointerId === this.lookId) this.lookId = null; };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) zone.addEventListener(ev, lookEnd);

    // ---- pedals ----------------------------------------------------------------------------
    const hold = (id, key) => {
      const el = root.querySelector(id);
      const ids = new Set();
      const set = () => { this[key] = ids.size ? 1 : 0; el.classList.toggle('down', ids.size > 0); };
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); ids.add(e.pointerId); el.setPointerCapture(e.pointerId); set(); });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, (e) => { ids.delete(e.pointerId); set(); });
    };
    this.touchGas = 0; this.touchBrake = 0;
    hold('#gas', 'touchGas');
    hold('#brake', 'touchBrake');

    const tap = (id, fn) => root.querySelector(id).addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this[fn] && this[fn](); });
    tap('#btnPause', 'onPause');
    tap('#btnReset', 'onReset');

    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyR') this.onReset && this.onReset();
      if (e.code === 'Escape' || e.code === 'KeyP') this.onPause && this.onPause();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.touchGas = this.touchBrake = 0; this.padSteer = 0; });
    this.kbSteer = 0;
    // test hook: force a steer value (null = off)
    this.forceSteer = null;
  }

  update(dt) {
    const k = this.keys;
    const left = k.has('ArrowLeft') || k.has('KeyA'), right = k.has('ArrowRight') || k.has('KeyD');
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    this.kbSteer += Math.max(-dt * 3, Math.min(dt * 3, target - this.kbSteer));
    if (!left && !right && Math.abs(this.kbSteer) < 0.05) this.kbSteer = 0;
    this.steer = this.forceSteer !== null ? this.forceSteer : this.padId !== null ? this.padSteer : this.kbSteer;
    this.gas = Math.max(this.touchGas, k.has('ArrowUp') || k.has('KeyW') ? 1 : 0);
    this.brake = Math.max(this.touchBrake, k.has('ArrowDown') || k.has('KeyS') || k.has('Space') ? 1 : 0);
    // let go of the look and the head eases back to the front
    if (this.lookId === null) {
      this.lookIdle += dt;
      if (this.lookIdle > 0.5) {
        const e = 1 - Math.exp(-dt * 3);
        this.look.yaw -= this.look.yaw * e; this.look.pitch -= this.look.pitch * e;
      }
    }
  }
}
