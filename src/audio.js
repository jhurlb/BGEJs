'use strict';
/* ================================================================
   SOUND: Web Audio with synthesized effects (no files needed) and optional sampled ones.
   Browsers only allow sound after a click or key press: call Sound.init() from one (or Sound.unlockOnGesture()).
     Sound.define('hit', (S, t) => { S.noise(0.06, 'bandpass', 3000, 0.16, 2); S.tone('square', 1100, 300, 0.04, 0.03); }, 0.035);
     Sound.play('hit');                    // the last argument of define() is the minimum gap between two plays (rate limit)
     Sound.muted = true;  Sound.setVolume(0.5);
     const buf = await Sound.load('sfx/boom.ogg');  Sound.playBuffer(buf, { vol: 0.8, rate: 1.1 });
     const hum = Sound.drone('sawtooth', 40, 700);  hum.set(freq, vol);   // a continuous tone (engine hum, wind)
   Inside a recipe: S.noise(dur, filterType, freq, vol, q = 1, delay = 0) and S.tone(wave, f0, f1, dur, vol, delay = 0),
   both scheduled from the current time. S.ac is the AudioContext and S.out the master gain.
   ================================================================ */
const Sound = {
  ac: null, out: null, muted: false, vol: 0.5, noiseBuf: null, recipes: new Map(), last: new Map(), drones: [],
  init(){
    if (this.ac) { this.ac.resume?.(); return true; }
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      this.ac = ac; this.out = ac.createGain(); this.out.gain.value = this.vol; this.out.connect(ac.destination);
      const len = ac.sampleRate * 0.5, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      for (const dr of this.drones) dr._build();
      return true;
    } catch (e) { this.ac = null; return false; }
  },
  unlockOnGesture(){ for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchend']) addEventListener(ev, () => this.init(), { capture: true, passive: true }); },
  setVolume(v){ this.vol = v; if (this.out) this.out.gain.value = v; },
  define(name, fn, gap = 0){ this.recipes.set(name, { fn, gap }); },
  play(name){
    const ac = this.ac, r = this.recipes.get(name); if (!ac || this.muted || !r) return;
    const now = ac.currentTime, l = this.last.get(name);
    if (r.gap && l !== undefined && now - l < r.gap) return;
    this.last.set(name, now); this._t = now;
    try { r.fn(this, now); } finally { this._t = undefined; }
  },
  noise(dur, type, freq, vol, q = 1, delay = 0){
    const ac = this.ac, t = (this._t ?? ac.currentTime) + delay;
    const s = ac.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.out); s.start(t, Math.random() * 0.3); s.stop(t + dur);
  },
  tone(type, f0, f1, dur, vol, delay = 0){
    const ac = this.ac, t = (this._t ?? ac.currentTime) + delay;
    const o = ac.createOscillator(), g = ac.createGain(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + dur + 0.02);
  },
  async load(url){ const r = await fetch(url); const b = await r.arrayBuffer(); if (!this.ac) this.init(); return this.ac.decodeAudioData(b); },
  playBuffer(buf, o = {}){
    if (!this.ac || this.muted || !buf) return null;
    const s = this.ac.createBufferSource(), g = this.ac.createGain(); s.buffer = buf; s.playbackRate.value = o.rate || 1; s.loop = !!o.loop; g.gain.value = o.vol ?? 1;
    s.connect(g); g.connect(this.out); s.start(); return s;
  },
  // A continuous tone through a low-pass filter. It is silent until set(); safe to make before init().
  drone(wave = 'sawtooth', freq = 40, cutoff = 700){
    const S = this, d = { o: null, g: null,
      _build(){ if (!S.ac || d.o) return; const o = S.ac.createOscillator(), f = S.ac.createBiquadFilter(), g = S.ac.createGain(); o.type = wave; o.frequency.value = freq; f.type = 'lowpass'; f.frequency.value = cutoff; g.gain.value = 0; o.connect(f); f.connect(g); g.connect(S.out); o.start(); d.o = o; d.g = g; },
      set(fr, vol){ if (!d.o) d._build(); if (!d.o) return; const t = S.ac.currentTime; d.o.frequency.setTargetAtTime(fr, t, 0.05); d.g.gain.setTargetAtTime(S.muted ? 0 : vol, t, 0.08); } };
    this.drones.push(d); d._build();
    return d;
  },
};
