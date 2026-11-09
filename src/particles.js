'use strict';
/* ================================================================
   PARTICLES: a pooled particle system stored as flat typed arrays (no object or entity per particle,
   no garbage), with particle kinds you define or describe, bursts, continuous emitters and named effects.

     const fx = new Particles(2048);                      // capacity

   A KIND says how its particles move and look. Describe the look and let the engine draw it:
     fx.kind('fire', {
       shape: 'circle',                           // 'circle', 'square', 'rect' (turns with rot), 'spark' (a streak along its velocity), 'ring',
                                                  // or image: a canvas / image to stamp (rotate: true to turn it with rot)
       size:   [1, 1.4, 0],                       // x the particle's own size, from birth to death
       alpha:  [0, 1, 1, 0],                      // opacity from birth to death (default: a straight fade out)
       colors: ['#fff', '#fd0', '#f40', '#400'],  // colour from birth to death (default: the colour it was spawned with)
       drag: 0.9,          // share of velocity kept per 1/60 s (1 = none lost)
       gravity: -40,       // added to vy per second (negative rises)
       wind: 0,            // added to vx per second
       blend: 'lighter',   // optional canvas composite mode
       layer: 0,           // fx.draw(ctx, view, layer) draws only this layer's kinds: smoke under the actors, sparks over them
       onDeath(s, x, y, vx, vy){ s.burst('spark', x, y, 6); },   // optional: runs after the update in which a particle ran out
     });
   A curve (size, alpha) is a number, evenly spaced stops [1, 0.5, 0], timed stops [[0, 1], [0.8, 1], [1, 0]], or a function of
   age t = 0 -> 1 such as t => 1 - Ease.inQuad(t). colors takes evenly spaced or timed stops. Curves and colours are worked out
   once, when the kind is made, into small lookup tables: nothing is computed or allocated per particle.

   ...or draw it yourself:
     fx.kind('ember', {
       draw(c, s, i, a){   // a = life left, 1 -> 0; read s.x[i], s.y[i], s.vx[i], s.vy[i], s.size[i], s.rot[i], s.color[i]
         c.globalAlpha = a; c.fillStyle = s.color[i]; c.fillRect(s.x[i] - 1, s.y[i] - 1, 2, 2);
       },
     });
   A draw() of your own can use the same tables: const grow = Particles.curve([1, 3]), heat = Particles.ramp(['#fff', '#f40']);
   then Particles.at(grow, 1 - a) and Particles.at(heat, 1 - a). Particles.rgba('#f80') parses a colour to [r, g, b, a].

     fx.spawn('ember', x, y, vx, vy, life, maxLife, color, size, rot, spin);
     fx.burst('ember', x, y, 12, { speed: [80, 200], life: 0.5, size: 2, color: ['#fd0', '#f80'], angle: 0, spread: Math.PI / 3 });
     const trail = fx.emitter('ember', { rate: 40, speed: 30, life: 0.4 }); trail.x = ...; trail.on = false; trail.stop();
     fx.update(dt);  fx.draw(ctx, view);                 // view: { x0, y0, x1, y1 } to skip off-screen particles

   burst() options (a number, [min, max], or for color an array to pick from):
     speed, angle (centre direction), spread (arc width, default a full circle), life, size, color, spin, rot,
     jitter (life and size vary by this fraction, default 0.3), vx / vy (added to every particle),
     radius (spawn in a disc), inner (with radius: spawn between the two, inner = radius is a circle's edge), box: [w, h] (spawn in a box),
     outward: true (with radius or box: fly away from its centre; spread then widens each one's direction, default 0).
   A kind with a shape or curves runs each particle through the whole curve, however jitter changed its life.

   emitter() takes burst() options plus:
     rate (particles per second, default 20), or interval + count (`count` particles at once every `interval` seconds),
     delay (seconds before it starts), duration (seconds of emitting, then it stops itself and calls onDone(emitter));
     both are exact at any frame rate, and time spent with on = false doesn't count towards them,
     inherit (share of the emitter's own velocity given to its particles, 0 by default), maxGap, x, y.
   Move it by setting x / y, or follow(obj, dx, dy) to track an object with x / y. emitter.opts is the live options object.
   An emitter that moves lays its particles along the path it travelled since the last update, so a fast trail
   stays an even line instead of a clump per frame. A jump of more than emitter.maxGap (200) in one update is taken
   as a teleport and leaves no line.

   EFFECTS: several bursts under one name.
     fx.effect('boom', [{ kind: 'flash', n: 1, speed: 0, size: 30 }, { kind: 'spark', n: 20, speed: [200, 500], life: 0.3 }]);
     fx.play('boom', x, y);                                  // or with { scale, count, angle, spread, color, vx, vy }
   scale multiplies sizes, speeds and spawn areas; count multiplies how many (never below one a layer, unless count is 0);
   angle, spread and color replace each layer's own; vx / vy are added to every particle.

   A full system drops new particles (overflow: 'drop', the default) or recycles the oldest (overflow: 'replace'; finding the
   oldest takes the same time however many particles there are).
   fx.warm(seconds) runs the system ahead, so a scene can open with its smoke already risen.
   Particles.basic(fx) adds ready-made kinds: 'dot', 'spark', 'smoke', 'chip', 'glow', 'ring', 'flash' and 'ember',
   and effects: 'explosion', 'hit', 'puff' and 'sparkle'.
   ================================================================ */
class Particles {
  constructor(cap = 2048, opts = {}){
    this.cap = cap; this.n = 0; this.overflow = opts.overflow || 'drop';
    const F = () => new Float32Array(cap);
    this.x = F(); this.y = F(); this.vx = F(); this.vy = F(); this.life = F(); this.max = F(); this.size = F(); this.rot = F(); this.spin = F();
    this.k = new Uint8Array(cap); this.born = new Uint32Array(cap); this.color = new Array(cap).fill('#fff');
    this.kinds = []; this.ids = new Map(); this.emitters = []; this.serial = 0; this.effects = new Map();
    // Age order as a linked list through the slots (oldest at _head), so 'replace' finds the oldest without a search.
    this._prev = new Int32Array(cap); this._next = new Int32Array(cap); this._head = -1; this._tail = -1;
    this._dead = null; this._deaths = 0;   // particles of kinds with onDeath that ran out this update: kind, x, y, vx, vy
  }
  kind(name, def){
    const k = { name, drag: 1, gravity: 0, wind: 0, cull: 24, blend: null, layer: 0, draw: null, ...def, id: this.kinds.length };
    k._own = typeof k.draw !== 'function' || k.size !== undefined || k.alpha !== undefined || !!k.colors;   // drawn from curves: each particle's life runs the whole curve
    if (typeof k.draw !== 'function') {
      const shape = k.image ? 'image' : k.shape;
      k.draw = Object.hasOwn(Particles.shapes, shape) ? Particles.shapes[shape] : null;
      if (typeof k.draw !== 'function') throw new Error(`Particles: kind "${name}" needs a draw(c, s, i, a) function or a shape (${Object.keys(Particles.shapes).join(', ')})`);
    }
    k._size = k.size === undefined ? null : Particles.curve(k.size); k._alpha = k.alpha === undefined ? null : Particles.curve(k.alpha);
    k._ramp = k.colors ? Particles.ramp(k.colors) : null;
    if (this.ids.has(name)) { k.id = this.ids.get(name); this.kinds[k.id] = k; return k.id; }
    if (k.id > 255) throw new Error('Particles: at most 256 kinds');
    this.kinds.push(k); this.ids.set(name, k.id); return k.id;
  }
  kindId(kind){ if (typeof kind === 'number') return kind; const id = this.ids.get(kind); if (id === undefined) throw new Error(`Particles: unknown kind "${kind}"`); return id; }
  get count(){ return this.n; }
  get full(){ return this.n >= this.cap; }
  clear(){ this.n = 0; this._head = this._tail = -1; this._deaths = 0; for (const e of this.emitters) e.dead = true; this.emitters.length = 0; }
  _link(i){ const t = this._tail; this._prev[i] = t; this._next[i] = -1; if (t >= 0) this._next[t] = i; else this._head = i; this._tail = i; }
  _unlink(i){ const p = this._prev[i], q = this._next[i]; if (p >= 0) this._next[p] = q; else this._head = q; if (q >= 0) this._prev[q] = p; else this._tail = p; }
  _slot(){
    if (this.n < this.cap) { const i = this.n++; this._link(i); return i; }
    if (this.overflow !== 'replace' || this._head < 0) return -1;
    const o = this._head; this._unlink(o); this._link(o);   // recycle the oldest: it becomes the newest
    return o;
  }
  spawn(kind, x, y, vx, vy, life, max = life, color = '#fff', size = 2, rot = 0, spin = 0){
    const id = this.kindId(kind);   // before taking a slot, so an unknown kind throws without leaving a half-made particle
    const i = this._slot(); if (i < 0) return -1;
    this.k[i] = id; this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = life; this.max[i] = max > 0 ? max : life || 1; this.color[i] = color; this.size[i] = size; this.rot[i] = rot; this.spin[i] = spin;
    this.born[i] = this.serial++;
    return i;
  }
  // n particles from (x, y). The options are listed at the top of this file.
  burst(kind, x, y, n, o = {}){ this._emit(this.kindId(kind), x, y, n, o, 0, 0, 1, null); }
  // The work of burst(): (ivx, ivy) is added to every velocity, sc scales sizes, speeds and spawn areas, p (play() options) may replace angle, spread and color.
  _emit(id, x, y, n, o, ivx, ivy, sc, p){
    const R = Rng.fx;   // looks only: never shifts gameplay randomness
    const v = (q, d) => q === undefined ? d : typeof q === 'number' ? q : R.range(q[0], q[1]);
    const ang0 = (p && p.angle !== undefined ? p.angle : o.angle) ?? 0, color = (p && p.color) || o.color || '#fff';
    const out = !!o.outward && !!(o.box || o.radius), own = this.kinds[id]._own, spread = (p && p.spread) ?? o.spread ?? (out ? 0 : TAU), jit = o.jitter ?? 0.3, life = o.life ?? 0.5;
    const rad = (o.radius || 0) * sc, inn = Math.min(o.inner || 0, o.radius || 0) * sc, bw = o.box ? o.box[0] * sc : 0, bh = o.box ? o.box[1] * sc : 0;
    const bvx = (o.vx || 0) + ivx, bvy = (o.vy || 0) + ivy;
    for (let j = 0; j < n; j++) {
      let ox = 0, oy = 0;
      if (o.box) { ox = (R.float() - 0.5) * bw; oy = (R.float() - 0.5) * bh; }
      else if (rad) { const ra = R.angle(), rr = Math.sqrt(inn * inn + R.float() * (rad * rad - inn * inn)); ox = Math.cos(ra) * rr; oy = Math.sin(ra) * rr; }   // even over the area
      const a = out && (ox || oy) ? Math.atan2(oy, ox) + (R.float() - 0.5) * spread : spread >= TAU ? R.angle() : ang0 + (R.float() - 0.5) * spread;
      const sp = v(o.speed, 100) * sc;
      const lf = v(o.life, life) * (1 + (R.float() * 2 - 1) * jit);
      const col = Array.isArray(color) ? R.pick(color) : color;
      if (this.spawn(id, x + ox, y + oy, Math.cos(a) * sp + bvx, Math.sin(a) * sp + bvy,
        lf, typeof o.life === 'number' && !own ? o.life : lf, col, v(o.size, 2) * sc * (1 + (R.float() * 2 - 1) * jit), o.rot === undefined ? R.angle() : v(o.rot, 0), v(o.spin, 0)) < 0) break;
    }
  }
  // A named effect: layers = [{ kind, n, ...burst options }, ...]. play() fires every layer at (x, y).
  effect(name, layers){
    this.effects.set(name, layers.map(l => ({ id: this.kindId(l.kind), n: l.n ?? 10, opts: l })));   // an unknown kind fails here, not at the first play()
    return this;
  }
  play(name, x, y, p = null){
    const fxs = this.effects.get(name); if (!fxs) throw new Error(`Particles: unknown effect "${name}"`);
    const sc = (p && p.scale) ?? 1, cn = (p && p.count) ?? 1, ivx = (p && p.vx) || 0, ivy = (p && p.vy) || 0;
    for (const l of fxs) this._emit(l.id, x, y, l.n > 0 && cn > 0 ? Math.max(1, Math.round(l.n * cn)) : 0, l.opts, ivx, ivy, sc, p);
  }
  // A continuous source of particles at (x, y). The options are listed at the top of this file.
  // Move it by setting x / y, or follow(obj, dx, dy) to track an object with x / y. on = false pauses it; stop() removes it.
  emitter(kind, o = {}){
    const e = { kind, x: o.x || 0, y: o.y || 0, rate: o.rate ?? 20, on: true, opts: o, acc: 0, target: null, dx: 0, dy: 0, dead: false, px: NaN, py: NaN, maxGap: o.maxGap ?? 200,
      interval: o.interval ?? 0, count: o.count ?? 10, delay: o.delay ?? 0, duration: o.duration ?? Infinity, inherit: o.inherit ?? 0, onDone: o.onDone || null, age: 0, pulse: 0,
      follow(obj, dx = 0, dy = 0){ e.target = obj; e.dx = dx; e.dy = dy; e.px = NaN; return e; },   // no trail from where it was before
      stop(){ e.dead = true; } };
    this.emitters.push(e);
    return e;
  }
  // One emitter's share of an update. Only the part of dt after its delay and before the end of its duration emits,
  // so the amount is the same at any frame rate. Returns true when its duration is over.
  _runEmitter(e, dt){
    if (e.delay > 0) { e.delay -= dt; if (e.delay > 0) return false; dt = -e.delay; e.delay = 0; }
    const left = e.duration - e.age, ending = dt >= left; if (ending) dt = Math.max(0, left);
    const mx = e.x - e.px, my = e.y - e.py, m2 = mx * mx + my * my, moved = m2 <= e.maxGap * e.maxGap;   // NaN, the first time, fails the test
    const ivx = e.inherit && moved && dt > 0 ? mx / dt * e.inherit : 0, ivy = e.inherit && moved && dt > 0 ? my / dt * e.inherit : 0;
    if (e.interval > 0) {   // pulses at 0, interval, 2 x interval... of its emitting time: those in [age, age + dt)
      const until = e.age + dt - 1e-9;
      while (e.pulse < until) { e.pulse += e.interval; this._emit(this.kindId(e.kind), e.x, e.y, e.count, e.opts, ivx, ivy, 1, null); }
    } else {
      e.acc += e.rate * dt; const n = (e.acc + 1e-6) | 0;   // rounding must not hold back the last particle of a duration
      if (n) {
        e.acc -= n; const id = this.kindId(e.kind);
        if (n > 1 && m2 > 1 && moved) for (let j = 1; j <= n; j++) this._emit(id, e.px + mx * j / n, e.py + my * j / n, 1, e.opts, ivx, ivy, 1, null);   // spread along the move
        else this._emit(id, e.x, e.y, n, e.opts, ivx, ivy, 1, null);
      }
    }
    e.age += dt;
    return ending;
  }
  update(dt){
    // emitters
    let w = 0, done = null;
    for (const e of this.emitters) {
      if (e.dead || (e.target && e.target.dead)) continue;
      if (e.target) { e.x = e.target.x + e.dx; e.y = e.target.y + e.dy; }
      if (e.on && this._runEmitter(e, dt)) { e.dead = true; if (e.onDone) (done || (done = [])).push(e); continue; }
      e.px = e.x; e.py = e.y;
      this.emitters[w++] = e;
    }
    this.emitters.length = w;
    if (done) for (const e of done) e.onDone(e);   // after the list is settled, so onDone may clear() or start new emitters
    // per-kind constants once per frame
    const K = this.kinds, kd = this._kd || (this._kd = new Float32Array(256)), kg = this._kg || (this._kg = new Float32Array(256)), kw = this._kw || (this._kw = new Float32Array(256));
    let hooks = false;
    for (let j = 0; j < K.length; j++) { kd[j] = K[j].drag === 1 ? 1 : Math.pow(K[j].drag, dt * 60); kg[j] = K[j].gravity * dt; kw[j] = K[j].wind * dt; if (K[j].onDeath) hooks = true; }
    const { x, y, vx, vy, life, rot, spin, k } = this;
    const dead = hooks ? this._dead || (this._dead = new Float32Array(this.cap * 5)) : null;
    let i = 0, nd = 0;
    while (i < this.n) {
      life[i] -= dt;
      if (life[i] <= 0) {
        if (hooks && K[k[i]].onDeath) { dead[nd] = k[i]; dead[nd + 1] = x[i]; dead[nd + 2] = y[i]; dead[nd + 3] = vx[i]; dead[nd + 4] = vy[i]; nd += 5; }
        this._kill(i); continue;   // the last particle moves into slot i, which is checked again
      }
      const kk = k[i], d = kd[kk];
      vx[i] += kw[kk]; vy[i] += kg[kk];
      if (d !== 1) { vx[i] *= d; vy[i] *= d; }
      x[i] += vx[i] * dt; y[i] += vy[i] * dt;
      if (spin[i]) rot[i] += spin[i] * dt;
      i++;
    }
    // onDeath runs once the loop is over, so what it spawns starts moving next update and can't disturb the loop
    this._deaths = nd;   // clear() inside a hook sets this to 0, which drops the rest
    for (let j = 0; j < this._deaths; j += 5) { const kn = K[dead[j]]; if (kn.onDeath) kn.onDeath(this, dead[j + 1], dead[j + 2], dead[j + 3], dead[j + 4]); }
    this._deaths = 0;
  }
  // Run the system ahead by `seconds` in steps of `step`.
  warm(seconds, step = 1 / 30){ if (!(step > 0)) return this; for (let t = 0; t < seconds - 1e-9; t += step) this.update(Math.min(step, seconds - t)); return this; }
  // Remove particle i: the last particle moves into its slot and takes over its place in the age order.
  _kill(i){
    this._unlink(i);
    const j = --this.n; if (i === j) return;
    this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.life[i] = this.life[j]; this.max[i] = this.max[j];
    this.size[i] = this.size[j]; this.rot[i] = this.rot[j]; this.spin[i] = this.spin[j]; this.k[i] = this.k[j]; this.born[i] = this.born[j]; this.color[i] = this.color[j];
    const p = this._prev[j], q = this._next[j]; this._prev[i] = p; this._next[i] = q;
    if (p >= 0) this._next[p] = i; else this._head = i;
    if (q >= 0) this._prev[q] = i; else this._tail = i;
  }
  // layer: draw only the kinds on that layer (leave it out to draw them all).
  draw(c, view = null, layer = undefined){
    const K = this.kinds, { x, y, life, max, k } = this;
    let blend = null;
    for (let i = 0; i < this.n; i++) {
      const kd = K[k[i]];
      if (layer !== undefined && kd.layer !== layer) continue;
      if (view) { const m = kd.cull; if (x[i] < view.x0 - m || x[i] > view.x1 + m || y[i] < view.y0 - m || y[i] > view.y1 + m) continue; }
      if (kd.blend !== blend) { c.globalCompositeOperation = kd.blend || 'source-over'; blend = kd.blend; }
      const a = life[i] / max[i];
      kd.draw(c, this, i, a < 0 ? 0 : a > 1 ? 1 : a);
    }
    if (blend) c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  }
}
// ---- curves and colour ramps: lookup tables read by age t = 0 -> 1 ----
// Stops (evenly spaced values, or [t, value] pairs in rising t) -> n + 1 samples, mixing neighbours with mix(a, b, f).
Particles._lut = (stops, n, mix) => {
  const st = stops.map((v, j) => Array.isArray(v) ? v : [stops.length > 1 ? j / (stops.length - 1) : 0, v]), out = new Array(n + 1);
  for (let q = 0, j = 0; q <= n; q++) {
    const t = q / n; while (j < st.length - 2 && t > st[j + 1][0]) j++;
    const A = st[j], B = st[Math.min(j + 1, st.length - 1)], span = B[0] - A[0];
    out[q] = mix(A[1], B[1], span > 0 ? clamp((t - A[0]) / span, 0, 1) : t < A[0] ? 0 : 1);
  }
  return out;
};
// A number, stops or a function of t -> a Float32Array of n + 1 samples.
Particles.curve = (spec, n = 64) => {
  if (spec instanceof Float32Array) return spec;
  if (typeof spec === 'number') return new Float32Array(n + 1).fill(spec);
  if (typeof spec === 'function') { const f = new Float32Array(n + 1); for (let q = 0; q <= n; q++) f[q] = spec(q / n); return f; }
  if (!Array.isArray(spec) || !spec.length) throw new Error('Particles.curve: give a number, an array of stops or a function of t');
  return Float32Array.from(Particles._lut(spec, n, lerp));
};
// Colour stops -> an array of n + 1 CSS colours. Mixed with alpha taken into account, so fading to a clear colour doesn't pass through grey.
Particles.ramp = (colors, n = 64) => {
  if (!Array.isArray(colors) || !colors.length) throw new Error('Particles.ramp: give an array of colours');
  const isTimed = s => Array.isArray(s) && s.length === 2 && typeof s[0] === 'number' && typeof s[1] !== 'number', timed = isTimed(colors[0]);
  if (colors.some(s => isTimed(s) !== timed)) throw new Error('Particles.ramp: give every colour a time, or none');
  const stops = colors.map((s, j) => timed ? [s[0], Particles.rgba(s[1])] : [colors.length > 1 ? j / (colors.length - 1) : 0, Particles.rgba(s)]);
  return Particles._lut(stops, n, (A, B, f) => {
    const a = lerp(A[3], B[3], f); if (a <= 0) return 'rgba(0,0,0,0)';
    const ch = j => Math.round(lerp(A[j] * A[3], B[j] * B[3], f) / a);
    return `rgba(${ch(0)},${ch(1)},${ch(2)},${+a.toFixed(3)})`;
  });
};
// Read a table made by curve() or ramp() at t = 0 -> 1.
Particles.at = (lut, t) => lut[t <= 0 ? 0 : t >= 1 ? lut.length - 1 : (t * (lut.length - 1) + 0.5) | 0];
// A CSS colour -> [r, g, b, a] (0-255, alpha 0-1). Hex and rgb() / rgba() are read here; other forms (names, hsl()) need a browser.
Particles.rgba = col => {
  if (Array.isArray(col)) { if (col.length === 4 && col.every(v => typeof v === 'number' && v === v)) return col; throw new Error(`Particles: can't read the colour [${col}]`); }
  const s = String(col).trim(); let m;
  if ((m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s))) {
    const h = m[1].length < 5 ? m[1].replace(/./g, '$&$&') : m[1], b = j => parseInt(h.slice(j, j + 2), 16);
    return [b(0), b(2), b(4), h.length === 8 ? b(6) / 255 : 1];
  }
  if ((m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+)(%?))?\s*\)$/i.exec(s))) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[5] ? m[4] / 100 : +m[4]];
  if (typeof document !== 'undefined') {   // a canvas reports any colour it understands as #rrggbb or rgba()
    const c = Particles._cx || (Particles._cx = document.createElement('canvas').getContext('2d'));
    c.fillStyle = '#000'; c.fillStyle = s; const r1 = c.fillStyle; c.fillStyle = '#fff'; c.fillStyle = s; const r2 = c.fillStyle;
    if (typeof r1 === 'string' && r1 === r2 && r1 !== s) return Particles.rgba(r1);   // a colour it doesn't know leaves the one set before
  }
  throw new Error(`Particles: can't read the colour "${col}"`);
};
// ---- built-in shapes: the draw() of a kind made with `shape` or `image` (`this` is the kind) ----
// Sets opacity and colour for particle i and returns its size now.
Particles._style = (k, c, s, i, a, stroke) => {
  const t = 1 - a, at = Particles.at;   // each table by its own length: one made with Particles.curve(spec, n) may be any size
  c.globalAlpha = k._alpha ? at(k._alpha, t) : a;
  const col = k._ramp ? at(k._ramp, t) : s.color[i];
  if (stroke) c.strokeStyle = col; else c.fillStyle = col;
  return k._size ? s.size[i] * at(k._size, t) : s.size[i];
};
Particles.shapes = {
  circle(c, s, i, a){ const r = Particles._style(this, c, s, i, a, false); if (r <= 0) return; c.beginPath(); c.arc(s.x[i], s.y[i], r, 0, TAU); c.fill(); },
  square(c, s, i, a){ const r = Particles._style(this, c, s, i, a, false); if (r <= 0) return; c.fillRect(s.x[i] - r, s.y[i] - r, r * 2, r * 2); },
  rect(c, s, i, a){ const r = Particles._style(this, c, s, i, a, false); if (r <= 0) return; Particles.rect(c, s.x[i], s.y[i], r * 2, r, s.rot[i]); c.fill(); },
  // a streak from the particle back along its velocity: `stretch` seconds of travel long (default 0.03), `size` wide
  spark(c, s, i, a){
    const r = Particles._style(this, c, s, i, a, true); if (r <= 0) return; const st = this.stretch ?? 0.03;
    c.lineWidth = r; c.beginPath(); c.moveTo(s.x[i], s.y[i]); c.lineTo(s.x[i] - s.vx[i] * st, s.y[i] - s.vy[i] * st); c.stroke();
  },
  // an outline circle of radius `size`, `width` thick (default 2)
  ring(c, s, i, a){ const r = Particles._style(this, c, s, i, a, true); if (r <= 0) return; c.lineWidth = this.width ?? 2; c.beginPath(); c.arc(s.x[i], s.y[i], r, 0, TAU); c.stroke(); },
  // kind.image stamped `size` * 2 wide, keeping its proportions
  image(c, s, i, a){
    const r = Particles._style(this, c, s, i, a, false), im = this.image; if (r <= 0 || !im.width) return; const h = r * im.height / im.width;
    if (this.rotate && s.rot[i]) { c.save(); c.translate(s.x[i], s.y[i]); c.rotate(s.rot[i]); c.drawImage(im, -r, -h, r * 2, h * 2); c.restore(); }
    else c.drawImage(im, s.x[i] - r, s.y[i] - h, r * 2, h * 2);
  },
};
// A rotated w x h rectangle centred on (x, y) as the current path (no save/restore or transform changes).
Particles.rect = (c, x, y, w, h, r) => {
  const co = Math.cos(r), si = Math.sin(r), ax = co * w / 2, ay = si * w / 2, bx = -si * h / 2, by = co * h / 2;
  c.beginPath(); c.moveTo(x - ax - bx, y - ay - by); c.lineTo(x + ax - bx, y + ay - by); c.lineTo(x + ax + bx, y + ay + by); c.lineTo(x - ax + bx, y - ay + by); c.closePath();
};
// Ready-made kinds and effects for quick prototypes.
Particles.basic = sys => {
  sys.kind('dot', { drag: 0.94, draw(c, s, i, a){ c.globalAlpha = a; c.fillStyle = s.color[i]; c.beginPath(); c.arc(s.x[i], s.y[i], s.size[i], 0, TAU); c.fill(); } });
  sys.kind('spark', { drag: 0.86, draw(c, s, i, a){ c.globalAlpha = Math.min(1, a * 1.5); c.strokeStyle = s.color[i]; c.lineWidth = s.size[i]; c.beginPath(); c.moveTo(s.x[i], s.y[i]); c.lineTo(s.x[i] - s.vx[i] * 0.03, s.y[i] - s.vy[i] * 0.03); c.stroke(); } });
  sys.kind('smoke', { drag: 0.92, gravity: -20, draw(c, s, i, a){ c.globalAlpha = a * 0.45; c.fillStyle = s.color[i]; c.beginPath(); c.arc(s.x[i], s.y[i], s.size[i] * (2 - a), 0, TAU); c.fill(); } });
  sys.kind('chip', { drag: 0.86, gravity: 300, draw(c, s, i, a){ c.globalAlpha = Math.min(1, a * 2); c.fillStyle = s.color[i]; Particles.rect(c, s.x[i], s.y[i], s.size[i] * 2, s.size[i], s.rot[i]); c.fill(); } });
  sys.kind('glow', { drag: 0.9, blend: 'lighter', draw(c, s, i, a){ c.globalAlpha = a * 0.6; c.fillStyle = s.color[i]; c.beginPath(); c.arc(s.x[i], s.y[i], s.size[i] * (1.5 - a * 0.5), 0, TAU); c.fill(); } });
  sys.kind('ring', { shape: 'ring', width: 3, size: t => 0.15 + 0.85 * (1 - (1 - t) * (1 - t)), alpha: [1, 0.6, 0] });   // a shock wave: grows fast to `size`, then fades
  sys.kind('flash', { shape: 'circle', blend: 'lighter', size: [0.6, 1], alpha: [[0, 0.9], [0.3, 0.5], [1, 0]] });
  sys.kind('ember', { shape: 'circle', blend: 'lighter', drag: 0.9, gravity: -30, size: [1, 0.8, 0.2], alpha: [[0, 1], [0.6, 0.8], [1, 0]], colors: ['#ffffff', '#ffdd55', '#ff7722', '#aa2200'] });
  sys.effect('explosion', [
    { kind: 'smoke', n: 10, speed: [15, 70], life: [0.7, 1.3], size: [7, 12], radius: 14, color: ['#444', '#5a5a5a'] },   // first, so it is drawn under the rest
    { kind: 'flash', n: 1, speed: 0, life: 0.18, size: 46, jitter: 0, color: '#fff3c4' },
    { kind: 'ring', n: 1, speed: 0, life: 0.4, size: 70, jitter: 0, color: '#ffd9a0' },
    { kind: 'ember', n: 26, speed: [40, 260], life: [0.35, 0.8], size: [3, 7], radius: 6 },
    { kind: 'spark', n: 16, speed: [240, 560], life: [0.2, 0.45], size: 2, color: ['#fff', '#fd8'] },
  ]);
  sys.effect('hit', [
    { kind: 'flash', n: 1, speed: 0, life: 0.1, size: 12, jitter: 0, color: '#fff' },
    { kind: 'spark', n: 8, speed: [140, 380], life: [0.12, 0.28], size: 1.5, color: '#fff' },   // play('hit', x, y, { angle, spread: 1.5 }) aims the spray
  ]);
  sys.effect('puff', [{ kind: 'smoke', n: 8, speed: [10, 60], life: [0.4, 0.8], size: [4, 8], radius: 5, color: '#999' }]);
  sys.effect('sparkle', [{ kind: 'glow', n: 10, speed: [20, 90], life: [0.3, 0.7], size: [1.5, 3.5], radius: 10, color: ['#fff', '#ffe98a', '#9fe6ff'] }]);
  return sys;
};
