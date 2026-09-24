// Touch first: left thumb drags to steer, right thumb works GAS and BRAKE.
// Keyboard (arrows / WASD, L for lights) is the desk fallback.

export class Input {
  constructor(root) {
    this.steer = 0; this.gas = 0; this.brake = 0;
    this.touchSteer = 0; this.steerId = null; this.steerX0 = 0;
    this.keys = new Set();
    this.onLights = null; this.onRoof = null; this.onPause = null; this.onReset = null;

    const zone = root.querySelector('#steerZone');
    const knob = this.knob = root.querySelector('#steerKnob');
    const ring = root.querySelector('#steerRing');
    const FULL = 70; // px of drag for full lock

    zone.addEventListener('pointerdown', (e) => {
      if (this.steerId !== null) return;
      this.steerId = e.pointerId; this.steerX0 = e.clientX;
      zone.setPointerCapture(e.pointerId);
      ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px';
      ring.classList.add('on');
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.steerId) return;
      let dx = e.clientX - this.steerX0;
      // let the anchor follow if you drag past full lock, so reversing direction is instant
      if (dx > FULL) { this.steerX0 = e.clientX - FULL; dx = FULL; }
      if (dx < -FULL) { this.steerX0 = e.clientX + FULL; dx = -FULL; }
      this.touchSteer = dx / FULL;
      document.body.classList.add('steered');
      knob.style.transform = `translate(${this.touchSteer * 34}px, 0)`;
    });
    const end = (e) => {
      if (e.pointerId !== this.steerId) return;
      this.steerId = null; this.touchSteer = 0;
      knob.style.transform = 'translate(0,0)';
      ring.classList.remove('on');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    const hold = (id, key) => {
      const el = root.querySelector(id);
      const ids = new Set();
      const set = () => { this[key] = ids.size ? 1 : 0; el.classList.toggle('down', ids.size > 0); };
      el.addEventListener('pointerdown', (e) => { ids.add(e.pointerId); el.setPointerCapture(e.pointerId); set(); e.preventDefault(); });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, (e) => { ids.delete(e.pointerId); set(); });
    };
    this.touchGas = 0; this.touchBrake = 0;
    hold('#gas', 'touchGas');
    hold('#brake', 'touchBrake');

    const tap = (id, fn) => root.querySelector(id).addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this[fn] && this[fn](); });
    tap('#btnLights', 'onLights');
    tap('#btnRoof', 'onRoof');
    tap('#btnPause', 'onPause');
    tap('#btnReset', 'onReset');

    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyL') this.onLights && this.onLights();
      if (e.code === 'KeyK') this.onRoof && this.onRoof();
      if (e.code === 'KeyR') this.onReset && this.onReset();
      if (e.code === 'Escape' || e.code === 'KeyP') this.onPause && this.onPause();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.touchGas = this.touchBrake = 0; this.touchSteer = 0; });
    this.kbSteer = 0;
  }

  update(dt) {
    const k = this.keys;
    const left = k.has('ArrowLeft') || k.has('KeyA'), right = k.has('ArrowRight') || k.has('KeyD');
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    // keyboard steering eases in, like a thumb would
    this.kbSteer += Math.max(-dt * 3, Math.min(dt * 3, target - this.kbSteer));
    if (!left && !right && Math.abs(this.kbSteer) < 0.05) this.kbSteer = 0;
    this.steer = this.steerId !== null ? this.touchSteer : this.kbSteer;
    this.gas = Math.max(this.touchGas, k.has('ArrowUp') || k.has('KeyW') ? 1 : 0);
    this.brake = Math.max(this.touchBrake, k.has('ArrowDown') || k.has('KeyS') || k.has('Space') ? 1 : 0);
  }
}
