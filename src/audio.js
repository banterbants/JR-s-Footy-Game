// All sound is synthesised with the Web Audio API - crowd, whistles, siren, thumps and a menu tune.
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

// An original little march for the menus: [midi note or 0 for a rest, beats]
const MELODY = [
  [67, 1], [72, 1], [76, 1], [79, 1],
  [81, 1.5], [79, 0.5], [76, 1], [72, 1],
  [74, 1], [77, 1], [81, 1], [79, 0.5], [77, 0.5],
  [76, 2], [0, 0.5], [67, 0.5], [69, 0.5], [71, 0.5],
  [72, 1], [76, 1], [79, 1], [84, 1],
  [83, 1.5], [81, 0.5], [79, 1], [76, 1],
  [77, 1], [74, 1], [79, 1], [71, 1],
  [72, 3], [0, 1],
];
// one chord per half bar: [root midi, minor?]
const CHORDS = [
  [48, 0], [48, 0], [45, 1], [45, 1], [50, 1], [43, 0], [48, 0], [48, 0],
  [48, 0], [48, 0], [43, 0], [43, 0], [41, 0], [43, 0], [48, 0], [48, 0],
];
const BPM = 116;

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.vol = { sfx: 0.8, crowd: 0.7, music: 0.5 };
    this.excite = 0.3;
    this.roarT = 0;
    this.musicOn = false;
    this.musicTimer = null;
    this.ready = false;
  }

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createDynamicsCompressor();
    this.master.threshold.value = -14;
    this.master.ratio.value = 5;
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.crowdBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    for (const b of [this.sfxBus, this.crowdBus, this.musicBus]) b.connect(this.master);

    // noise buffers
    const len = ctx.sampleRate * 3;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.045 * w) / 1.045; // brown-ish
      d[i] = last * 5 + w * 0.25;
    }
    this.buildCrowd();
    this.ready = true;
    this.applyVolumes();
    if (this.musicOn) this.startMusic();
  }

  setVolumes(v) {
    Object.assign(this.vol, v);
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.crowdBus.gain.setTargetAtTime(this.vol.crowd, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.5, t, 0.05);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // ------------------------------------------------------------------ crowd

  buildCrowd() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    // a murmur band and a brighter "voices" band that opens up when they roar
    this.crowdLow = ctx.createBiquadFilter();
    this.crowdLow.type = 'bandpass';
    this.crowdLow.frequency.value = 420;
    this.crowdLow.Q.value = 0.5;
    this.crowdHigh = ctx.createBiquadFilter();
    this.crowdHigh.type = 'bandpass';
    this.crowdHigh.frequency.value = 1500;
    this.crowdHigh.Q.value = 0.7;
    this.crowdLowGain = ctx.createGain();
    this.crowdHighGain = ctx.createGain();
    this.crowdLowGain.gain.value = 0.0;
    this.crowdHighGain.gain.value = 0.0;
    src.connect(this.crowdLow).connect(this.crowdLowGain).connect(this.crowdBus);
    src.connect(this.crowdHigh).connect(this.crowdHighGain).connect(this.crowdBus);
    src.start();
    this.crowdOn = false;
  }

  /** Turn the crowd bed on or off (off in menus). */
  setCrowd(on) {
    this.crowdOn = on;
  }

  /** Called every frame: `level` 0..1 is how tense the play is. */
  update(dt, level) {
    if (!this.ready) return;
    this.excite += (level - this.excite) * Math.min(1, dt * 1.5);
    if (this.roarT > 0) this.roarT -= dt;
    const t = this.ctx.currentTime;
    const roar = Math.max(0, Math.min(1, this.roarT / 1.2)) * this.roarAmt || 0;
    const wob = 1 + Math.sin(t * 0.9) * 0.08 + Math.sin(t * 2.3) * 0.05;
    const on = this.crowdOn ? 1 : 0;
    this.crowdLowGain.gain.setTargetAtTime(on * (0.35 + this.excite * 0.45 + roar * 0.9) * wob, t, 0.12);
    this.crowdHighGain.gain.setTargetAtTime(on * (0.03 + this.excite * 0.16 + roar * 0.75) * wob, t, 0.1);
    this.crowdHigh.frequency.setTargetAtTime(1300 + this.excite * 500 + roar * 900, t, 0.15);
  }

  /** A swell from the crowd: amount 0..1, lasting `secs`. */
  roar(amount = 1, secs = 3) {
    this.roarAmt = amount;
    this.roarT = secs;
  }

  // -------------------------------------------------------------- building blocks

  env(gainNode, t, attack, peak, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  tone({ type = 'sine', f0, f1, dur, vol = 0.5, attack = 0.004, bus, delay = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    this.env(g, t, attack, vol, dur);
    o.connect(g).connect(bus || this.sfxBus);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  burst({ freq = 1000, q = 1, type = 'bandpass', dur = 0.1, vol = 0.5, attack = 0.003, delay = 0, f1 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, attack, vol, dur);
    s.connect(f).connect(g).connect(this.sfxBus);
    s.start(t, Math.random() * 2);
    s.stop(t + attack + dur + 0.05);
  }

  // ------------------------------------------------------------------- effects

  kick(power = 0.6) {
    const v = 0.5 + power * 0.5;
    this.tone({ f0: 170, f1: 42, dur: 0.16, vol: 0.95 * v });
    this.burst({ freq: 2600, q: 0.8, dur: 0.035, vol: 0.5 * v });
    this.burst({ freq: 300, type: 'lowpass', dur: 0.08, vol: 0.5 * v });
  }

  handball() {
    this.tone({ f0: 260, f1: 95, dur: 0.07, vol: 0.6 });
    this.burst({ freq: 1900, q: 1, dur: 0.03, vol: 0.4 });
  }

  bounce(v = 5) {
    const k = Math.min(1, v / 12);
    this.tone({ f0: 120, f1: 55, dur: 0.09, vol: 0.25 + 0.4 * k });
  }

  catch() {
    this.burst({ freq: 1500, q: 0.9, dur: 0.045, vol: 0.5 });
    this.tone({ f0: 140, f1: 70, dur: 0.06, vol: 0.35 });
  }

  tackle() {
    this.burst({ freq: 380, type: 'lowpass', dur: 0.18, vol: 0.9 });
    this.tone({ f0: 95, f1: 38, dur: 0.2, vol: 0.8 });
    this.burst({ freq: 2200, q: 0.6, dur: 0.05, vol: 0.25, delay: 0.02 });
  }

  whoosh() {
    this.burst({ freq: 500, f1: 2400, q: 1.2, dur: 0.18, vol: 0.22, attack: 0.05 });
  }

  post() {
    for (const [f, v] of [[540, 0.5], [1310, 0.3], [2150, 0.2], [3320, 0.1]]) this.tone({ f0: f, dur: 0.7, vol: v, attack: 0.002 });
    this.tone({ f0: 150, f1: 60, dur: 0.12, vol: 0.6 });
  }

  click() {
    this.tone({ type: 'triangle', f0: 620, f1: 900, dur: 0.05, vol: 0.25 });
  }

  blip(up = true) {
    this.tone({ type: 'triangle', f0: up ? 520 : 700, f1: up ? 780 : 420, dur: 0.07, vol: 0.2 });
  }

  /** Umpire's pea whistle. */
  whistle(long = false) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = long ? 0.75 : 0.32;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.02);
    g.gain.setValueAtTime(0.32, t + dur - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // the rattle of the pea
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 38;
    const lg = ctx.createGain();
    lg.gain.value = 0.16;
    lfo.connect(lg).connect(g.gain);
    for (const f of [2850, 2990]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * 0.96, t);
      o.frequency.linearRampToValueAtTime(f, t + 0.05);
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    g.connect(this.sfxBus);
    lfo.start(t);
    lfo.stop(t + dur + 0.02);
  }

  /** The end-of-quarter siren. */
  siren() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 2.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.25);
    g.gain.setValueAtTime(0.4, t + dur - 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1700;
    for (const [base, type] of [[455, 'sawtooth'], [461, 'sawtooth'], [228, 'square']]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(base * 0.55, t);
      o.frequency.exponentialRampToValueAtTime(base, t + 0.4);
      o.frequency.setValueAtTime(base, t + dur - 0.5);
      o.frequency.exponentialRampToValueAtTime(base * 0.7, t + dur);
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    f.connect(g).connect(this.sfxBus);
  }

  /** Brassy fanfare for a goal (bigger when it's ours). */
  fanfare(big = true) {
    const notes = big ? [72, 76, 79, 84] : [67, 72];
    notes.forEach((n, i) => {
      this.brass(NOTE(n), i * 0.11, i === notes.length - 1 ? 0.5 : 0.14, 0.2);
      this.brass(NOTE(n - 12), i * 0.11, i === notes.length - 1 ? 0.5 : 0.14, 0.12);
    });
  }

  brass(freq, delay, dur, vol, bus) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 1.5, t);
    f.frequency.linearRampToValueAtTime(freq * 4.5, t + 0.04);
    f.frequency.linearRampToValueAtTime(freq * 2.2, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.setValueAtTime(vol * 0.8, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.06);
    o.connect(f).connect(g).connect(bus || this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  // --------------------------------------------------------------------- music

  startMusic() {
    this.musicOn = true;
    if (!this.ready || this.musicTimer) return;
    const beat = 60 / BPM;
    this.loopLen = 32 * beat;
    this.nextLoop = this.ctx.currentTime + 0.1;
    const tick = () => {
      if (!this.musicOn) return;
      while (this.nextLoop < this.ctx.currentTime + 0.6) {
        this.scheduleLoop(this.nextLoop);
        this.nextLoop += this.loopLen;
      }
    };
    tick();
    this.musicTimer = setInterval(tick, 250);
  }

  stopMusic() {
    this.musicOn = false;
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    if (this.ready) {
      // Notes are scheduled well ahead, so retire the whole bus and start a fresh one.
      const ctx = this.ctx;
      const old = this.musicBus;
      old.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      setTimeout(() => old.disconnect(), 600);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = this.vol.music * 0.5;
      this.musicBus.connect(this.master);
    }
  }

  scheduleLoop(t0) {
    const ctx = this.ctx;
    const beat = 60 / BPM;
    const bus = this.musicBus;
    const d0 = t0 - ctx.currentTime;
    // melody
    let b = 0;
    for (const [n, len] of MELODY) {
      if (n) this.brass(NOTE(n), d0 + b * beat, len * beat * 0.85, 0.2, bus);
      b += len;
    }
    // oom-pah bass and off-beat chords
    CHORDS.forEach(([root, minor], i) => {
      const t = d0 + i * 2 * beat;
      this.tone({ type: 'triangle', f0: NOTE(root - 12), dur: beat * 0.7, vol: 0.4, bus, delay: t });
      this.tone({ type: 'triangle', f0: NOTE(root - 5), dur: beat * 0.7, vol: 0.28, bus, delay: t + beat });
      for (const k of [0, minor ? 3 : 4, 7]) {
        this.tone({ type: 'square', f0: NOTE(root + 12 + k), dur: beat * 0.22, vol: 0.035, bus, delay: t + beat * 0.5 });
        this.tone({ type: 'square', f0: NOTE(root + 12 + k), dur: beat * 0.22, vol: 0.035, bus, delay: t + beat * 1.5 });
      }
    });
    // snare on the off-beats
    for (let i = 0; i < 32; i++) {
      const t = ctx.currentTime + d0 + (i + 0.5) * beat;
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 1800;
      const g = ctx.createGain();
      this.env(g, t, 0.002, i % 4 === 3 ? 0.16 : 0.09, 0.07);
      s.connect(f).connect(g).connect(bus);
      s.start(t, Math.random() * 2);
      s.stop(t + 0.12);
    }
  }
}
