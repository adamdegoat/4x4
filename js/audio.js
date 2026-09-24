// All sound is synthesised live (nothing to download): the engine, the night
// jungle (cicadas, crickets, frogs), and knocks, scrapes, splashes and brush.

export class Sound {
  constructor() { this.ctx = null; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = this.ctx = new AC();
    const master = this.master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);

    // shared noise buffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.buildEngine();
    this.buildJungle();
  }

  noise(loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = loop;
    s.loopStart = Math.random(); // decorrelate
    return s;
  }

  buildEngine() {
    const c = this.ctx;
    const out = this.engOut = c.createGain(); out.gain.value = 0.0;
    const lp = this.engLP = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 3;
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.5); }
    shaper.curve = curve;
    this.o1 = c.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = c.createOscillator(); this.o2.type = 'square';
    this.o3 = c.createOscillator(); this.o3.type = 'sine'; // firing thump
    const g1 = c.createGain(); g1.gain.value = 0.35;
    const g2 = c.createGain(); g2.gain.value = 0.2;
    const g3 = c.createGain(); g3.gain.value = 0.6;
    // lumpy idle: amplitude wobble at firing rate
    this.lfo = c.createOscillator(); this.lfo.type = 'sine';
    const lfoG = c.createGain(); lfoG.gain.value = 0.25;
    const am = c.createGain(); am.gain.value = 0.75;
    this.lfo.connect(lfoG); lfoG.connect(am.gain);
    this.o1.connect(g1); this.o2.connect(g2); this.o3.connect(g3);
    g1.connect(shaper); g2.connect(shaper); g3.connect(shaper);
    shaper.connect(am); am.connect(lp); lp.connect(out); out.connect(this.master);
    // intake hiss under load
    this.hiss = this.noise(); const hbp = c.createBiquadFilter(); hbp.type = 'bandpass'; hbp.frequency.value = 900; hbp.Q.value = 0.8;
    this.hissG = c.createGain(); this.hissG.gain.value = 0;
    this.hiss.connect(hbp); hbp.connect(this.hissG); this.hissG.connect(this.master);
    // tyres on dirt / scrub
    this.roll = this.noise(); const rlp = c.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 350;
    this.rollG = c.createGain(); this.rollG.gain.value = 0;
    this.roll.connect(rlp); rlp.connect(this.rollG); this.rollG.connect(this.master);
    for (const n of [this.o1, this.o2, this.o3, this.lfo, this.hiss, this.roll]) n.start();
  }

  buildJungle() {
    const c = this.ctx;
    const amb = this.amb = c.createGain(); amb.gain.value = 0.55; amb.connect(this.master);
    // cicada choir: bandpassed noise chopped by a fast LFO, slow swells
    const mkCicada = (freq, rate, level, pan) => {
      const n = this.noise(); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 9;
      const chop = c.createGain(); chop.gain.value = 0;
      const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = rate;
      const lg = c.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(chop.gain);
      const swell = c.createGain(); swell.gain.value = level;
      const sl = c.createOscillator(); sl.frequency.value = 0.05 + Math.random() * 0.08;
      const sg = c.createGain(); sg.gain.value = level * 0.8; sl.connect(sg); sg.connect(swell.gain);
      const p = c.createStereoPanner(); p.pan.value = pan;
      n.connect(bp); bp.connect(chop); chop.connect(swell); swell.connect(p); p.connect(amb);
      n.start(); lfo.start(); sl.start();
    };
    mkCicada(4300, 38, 0.5, -0.6);
    mkCicada(5100, 44, 0.35, 0.7);
    mkCicada(3600, 27, 0.25, 0.1);
    // low forest bed
    const bed = this.noise(); const blp = c.createBiquadFilter(); blp.type = 'lowpass'; blp.frequency.value = 220;
    const bg = c.createGain(); bg.gain.value = 0.12; bed.connect(blp); blp.connect(bg); bg.connect(amb); bed.start();
    this.nextCritter = 0;
    // a low drone under everything, barely there: two detuned tones, slowly beating
    const drone = c.createGain(); drone.gain.value = 0.05; drone.connect(this.master);
    const dlp = c.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 180; dlp.connect(drone);
    for (const f of [55, 55.7, 82.4]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const g = c.createGain(); g.gain.value = 0.3; o.connect(g); g.connect(dlp); o.start(); }
    // radio static near the mast
    this.staticN = this.noise(); const sbp = c.createBiquadFilter(); sbp.type = 'bandpass'; sbp.frequency.value = 2200; sbp.Q.value = 0.6;
    this.staticG = c.createGain(); this.staticG.gain.value = 0;
    const chop = c.createGain(); const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 7; const lg = c.createGain(); lg.gain.value = 0.4; lfo.connect(lg); lg.connect(chop.gain);
    this.staticN.connect(sbp); sbp.connect(chop); chop.connect(this.staticG); this.staticG.connect(this.master);
    this.staticN.start(); lfo.start();
    this.quietUntil = 0;
  }

  // the insects stop, all at once. Then come back slowly.
  silence(sec) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.amb.gain.cancelScheduledValues(t);
    this.amb.gain.setTargetAtTime(0.02, t, 0.25);
    this.amb.gain.setTargetAtTime(0.55, t + sec, 2.5);
    this.quietUntil = t + sec;
  }

  static(level) {
    if (!this.ctx) return;
    this.staticG.gain.setTargetAtTime(level * level * 0.12, this.ctx.currentTime, 0.2);
  }

  // distant gong: inharmonic partials, long decay, far off to one side
  gong() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, p = c.createStereoPanner(); p.pan.value = Math.random() * 2 - 1; p.connect(this.master);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.connect(p);
    const base = 90 + Math.random() * 40;
    for (const [m, a] of [[1, 0.06], [2.4, 0.035], [3.9, 0.02], [5.4, 0.012]]) {
      const o = c.createOscillator(); o.frequency.value = base * m;
      const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0005, t + 5);
      o.connect(g); g.connect(lp); o.start(t); o.stop(t + 5.2);
    }
  }

  // wood creaking somewhere close
  creak() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, n = this.noise(false);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 18;
    bp.frequency.setValueAtTime(300 + Math.random() * 200, t); bp.frequency.linearRampToValueAtTime(180 + Math.random() * 120, t + 1.2);
    const am = c.createGain(); const lfo = c.createOscillator(); lfo.frequency.value = 22 + Math.random() * 18; const lg = c.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35, t + 0.2); g.gain.linearRampToValueAtTime(0, t + 1.3);
    const p = c.createStereoPanner(); p.pan.value = Math.random() * 2 - 1;
    n.connect(bp); bp.connect(am); am.connect(g); g.connect(p); p.connect(this.master);
    n.start(t); lfo.start(t); n.stop(t + 1.4); lfo.stop(t + 1.4);
  }

  // three slow knocks on wood
  knock() {
    if (!this.ctx) return;
    const c = this.ctx, t0 = c.currentTime, p = c.createStereoPanner(); p.pan.value = Math.random() * 2 - 1; p.connect(this.master);
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * (0.55 + Math.random() * 0.1);
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.08);
      const g = c.createGain(); g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g); g.connect(p); o.start(t); o.stop(t + 0.15);
    }
  }

  // a woman humming, far away. Four notes, never resolved.
  hum() {
    if (!this.ctx) return;
    const c = this.ctx, t0 = c.currentTime;
    const p = c.createStereoPanner(); p.pan.value = Math.random() < 0.5 ? -0.8 : 0.8; p.connect(this.master);
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 600; f1.Q.value = 3; f1.connect(p);
    const o = c.createOscillator(); o.type = 'triangle';
    const vib = c.createOscillator(); vib.frequency.value = 5.2; const vg = c.createGain(); vg.gain.value = 4; vib.connect(vg); vg.connect(o.frequency);
    const g = c.createGain(); g.gain.value = 0;
    o.connect(g); g.connect(f1);
    const notes = [293.7, 329.6, 311.1, 261.6];
    notes.forEach((f, i) => { o.frequency.setTargetAtTime(f, t0 + i * 0.9, 0.08); });
    g.gain.setTargetAtTime(0.045, t0, 0.3); g.gain.setTargetAtTime(0, t0 + 3.4, 0.4);
    o.start(t0); vib.start(t0); o.stop(t0 + 5); vib.stop(t0 + 5);
  }

  // air pushed past your ear
  whoosh() {
    if (!this.ctx) return;
    this.burst(0.25, { freq: 500, q: 0.4, dur: 0.9, type: 'bandpass' });
  }

  critter(t) {
    // occasional frog croaks and a distant night bird
    const c = this.ctx;
    const r = Math.random();
    const p = c.createStereoPanner(); p.pan.value = Math.random() * 2 - 1; p.connect(this.amb);
    if (r < 0.45) {
      // frog: a few quick nasal pulses
      const n = 2 + (Math.random() * 4) | 0, f = 280 + Math.random() * 500;
      for (let i = 0; i < n; i++) {
        const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f;
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 4;
        const g = c.createGain(); const t0 = t + i * 0.13;
        g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.08, t0 + 0.015); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
        o.connect(bp); bp.connect(g); g.connect(p); o.start(t0); o.stop(t0 + 0.12);
      }
    } else {
      // night bird: a falling whistle, far off
      const o = c.createOscillator(); o.type = 'sine';
      const g = c.createGain();
      o.frequency.setValueAtTime(1900, t); o.frequency.exponentialRampToValueAtTime(1100, t + 0.5);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.04, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      o.connect(g); g.connect(p); o.start(t); o.stop(t + 0.6);
    }
  }

  burst(level, { freq = 200, q = 0.7, dur = 0.25, type = 'lowpass' } = {}) {
    const c = this.ctx, t = c.currentTime;
    const n = this.noise(false); const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f); f.connect(g); g.connect(this.master); n.start(t); n.stop(t + dur + 0.05);
  }

  thud(level) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const g = c.createGain(); g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.4);
  }

  update(v, dt) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const spd = Math.abs(v.speed);
    const load = Math.max(v.input.gas, v.input.brake && v.gear === -1 ? v.input.brake : 0);
    // fake gearbox: rpm rises within each gear then drops
    const gearSpan = 4.5;
    const inGear = (spd % gearSpan) / gearSpan;
    const gearN = Math.floor(spd / gearSpan);
    const rpm = 800 + load * 900 + inGear * 2600 * Math.min(1, spd / 1.5) + gearN * 150;
    const f = rpm / 60 * 0.5; // firing frequency for a small 4-cylinder, halved for grunt
    this.o1.frequency.setTargetAtTime(f, t, 0.05);
    this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.o3.frequency.setTargetAtTime(f * 0.25, t, 0.05);
    this.lfo.frequency.setTargetAtTime(f * 0.25, t, 0.05);
    this.engLP.frequency.setTargetAtTime(350 + load * 1400 + rpm * 0.12, t, 0.08);
    this.engOut.gain.setTargetAtTime(0.22 + load * 0.2, t, 0.1);
    this.hissG.gain.setTargetAtTime(load * 0.05, t, 0.1);
    let ground = 0;
    for (const w of v.wheels) if (w.contact) ground += 0.25;
    this.rollG.gain.setTargetAtTime(Math.min(0.35, spd * 0.03) * ground, t, 0.1);

    const e = v.events;
    if (e.impact > 0.05) { this.thud(0.5 + e.impact); this.burst(0.3 * e.impact + 0.1, { freq: 1200, q: 1, dur: 0.3, type: 'bandpass' }); }
    if (e.bump > 0.1) this.thud(0.25 * e.bump);
    if (e.splash > 0.05 && Math.random() < 0.3) this.burst(0.25 * e.splash, { freq: 1800, q: 0.5, dur: 0.35, type: 'bandpass' });
    if (e.brush > 0.1 && Math.random() < 0.25) this.burst(0.12 * e.brush, { freq: 3000, q: 0.6, dur: 0.18, type: 'highpass' });
    e.impact = e.bump = e.splash = e.brush = 0;

    if (t > this.nextCritter) { this.critter(t + 0.05); this.nextCritter = t + 1.5 + Math.random() * 5; }
  }
}
