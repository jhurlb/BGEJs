'use strict';
/* ================================================================
   PARTICLES: a pooled particle system stored as flat typed arrays (no object or entity per particle,
   no garbage), with particle kinds you define, bursts and continuous emitters.

     const fx = new Particles(2048);                      // capacity
     fx.kind('ember', {
       drag: 0.9,          // share of velocity kept per 1/60 s (1 = none lost)
       gravity: -40,       // added to vy per second (negative rises)
       blend: 'lighter',   // optional canvas composite mode
       draw(c, s, i, a){   // a = life left, 1 -> 0; read s.x[i], s.y[i], s.vx[i], s.vy[i], s.size[i], s.rot[i], s.color[i]
         c.globalAlpha = a; c.fillStyle = s.color[i]; c.fillRect(s.x[i] - 1, s.y[i] - 1, 2, 2);
       },
     });
     fx.spawn('ember', x, y, vx, vy, life, maxLife, color, size, rot, spin);
     fx.burst('ember', x, y, 12, { speed: [80, 200], life: 0.5, size: 2, color: ['#fd0', '#f80'], angle: 0, spread: Math.PI / 3 });
     const trail = fx.emitter('ember', { rate: 40, speed: 30, life: 0.4 }); trail.x = ...; trail.on = false; trail.stop();
     fx.update(dt);  fx.draw(ctx, view);                 // view: { x0, y0, x1, y1 } to skip off-screen particles

   A full system drops new particles (overflow: 'drop', the default) or recycles the oldest (overflow: 'replace').
   Particles.basic(fx) adds ready-made kinds: 'dot', 'spark', 'smoke', 'chip' and 'glow'.
   ================================================================ */
class Particles {
  constructor(cap = 2048, opts = {}){
    this.cap = cap; this.n = 0; this.overflow = opts.overflow || 'drop';
    const F = () => new Float32Array(cap);
    this.x = F(); this.y = F(); this.vx = F(); this.vy = F(); this.life = F(); this.max = F(); this.size = F(); this.rot = F(); this.spin = F();
    this.k = new Uint8Array(cap); this.born = new Uint32Array(cap); this.color = new Array(cap).fill('#fff');
    this.kinds = []; this.ids = new Map(); this.emitters = []; this.serial = 0;
  }
  kind(name, def){
    const k = { name, drag: 1, gravity: 0, cull: 24, blend: null, draw: null, ...def, id: this.kinds.length };
    if (this.ids.has(name)) { k.id = this.ids.get(name); this.kinds[k.id] = k; return k.id; }
    if (k.id > 255) throw new Error('Particles: at most 256 kinds');
    this.kinds.push(k); this.ids.set(name, k.id); return k.id;
  }
  kindId(kind){ if (typeof kind === 'number') return kind; const id = this.ids.get(kind); if (id === undefined) throw new Error(`Particles: unknown kind "${kind}"`); return id; }
  get count(){ return this.n; }
  get full(){ return this.n >= this.cap; }
  clear(){ this.n = 0; this.emitters.length = 0; }
  _slot(){
    if (this.n < this.cap) return this.n++;
    if (this.overflow !== 'replace') return -1;
    let o = 0, ob = this.born[0];   // recycle the oldest
    for (let i = 1; i < this.n; i++) if (this.born[i] < ob) { ob = this.born[i]; o = i; }
    return o;
  }
  spawn(kind, x, y, vx, vy, life, max = life, color = '#fff', size = 2, rot = 0, spin = 0){
    const i = this._slot(); if (i < 0) return -1;
    this.k[i] = this.kindId(kind); this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = life; this.max[i] = max > 0 ? max : life || 1; this.color[i] = color; this.size[i] = size; this.rot[i] = rot; this.spin[i] = spin;
    this.born[i] = this.serial++;
    return i;
  }
  // n particles from (x, y). Options (a number, [min, max], or for color an array to pick from):
  // speed, angle (centre direction), spread (arc width, default a full circle), life, size, color, spin, rot,
  // jitter (life and size vary by this fraction, default 0.3), vx / vy (added to every particle), radius (spawn disc).
  burst(kind, x, y, n, o = {}){
    const id = this.kindId(kind), R = Rng.fx;   // looks only: never shifts gameplay randomness
    const v = (q, d) => q === undefined ? d : typeof q === 'number' ? q : R.range(q[0], q[1]);
    const ang0 = o.angle ?? 0, spread = o.spread ?? TAU, jit = o.jitter ?? 0.3, life = o.life ?? 0.5;
    for (let j = 0; j < n; j++) {
      const a = spread >= TAU ? R.angle() : ang0 + (R.float() - 0.5) * spread, sp = v(o.speed, 100);
      const rr = o.radius ? Math.sqrt(R.float()) * o.radius : 0, ra = R.angle();
      const lf = v(o.life, life) * (1 + (R.float() * 2 - 1) * jit);
      const col = Array.isArray(o.color) ? R.pick(o.color) : o.color || '#fff';
      if (this.spawn(id, x + Math.cos(ra) * rr, y + Math.sin(ra) * rr, Math.cos(a) * sp + (o.vx || 0), Math.sin(a) * sp + (o.vy || 0),
        lf, typeof o.life === 'number' ? o.life : lf, col, v(o.size, 2) * (1 + (R.float() * 2 - 1) * jit), o.rot === undefined ? R.angle() : v(o.rot, 0), v(o.spin, 0)) < 0) break;
    }
  }
  // A continuous source: `rate` particles per second at (x, y), using burst() options. Move it by setting x / y,
  // or follow(obj, dx, dy) to track an object with x / y. on = false pauses it; stop() removes it.
  emitter(kind, o = {}){
    const e = { kind, x: o.x || 0, y: o.y || 0, rate: o.rate ?? 20, on: true, opts: o, acc: 0, target: null, dx: 0, dy: 0, dead: false,
      follow(obj, dx = 0, dy = 0){ e.target = obj; e.dx = dx; e.dy = dy; return e; },
      stop(){ e.dead = true; } };
    this.emitters.push(e);
    return e;
  }
  update(dt){
    // emitters
    let w = 0;
    for (const e of this.emitters) {
      if (e.dead || (e.target && e.target.dead)) continue;
      if (e.target) { e.x = e.target.x + e.dx; e.y = e.target.y + e.dy; }
      if (e.on) { e.acc += e.rate * dt; const n = e.acc | 0; if (n) { e.acc -= n; this.burst(e.kind, e.x, e.y, n, e.opts); } }
      this.emitters[w++] = e;
    }
    this.emitters.length = w;
    // per-kind constants once per frame
    const K = this.kinds, kd = this._kd || (this._kd = new Float32Array(256)), kg = this._kg || (this._kg = new Float32Array(256));
    for (let j = 0; j < K.length; j++) { kd[j] = K[j].drag === 1 ? 1 : Math.pow(K[j].drag, dt * 60); kg[j] = K[j].gravity * dt; }
    const { x, y, vx, vy, life, rot, spin, k } = this;
    let i = 0;
    while (i < this.n) {
      life[i] -= dt;
      if (life[i] <= 0) { this._swap(i, --this.n); continue; }   // the last particle moves into slot i, which is checked again
      const kk = k[i], d = kd[kk];
      vy[i] += kg[kk];
      if (d !== 1) { vx[i] *= d; vy[i] *= d; }
      x[i] += vx[i] * dt; y[i] += vy[i] * dt;
      if (spin[i]) rot[i] += spin[i] * dt;
      i++;
    }
  }
  _swap(i, j){
    if (i === j) return;
    this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.life[i] = this.life[j]; this.max[i] = this.max[j];
    this.size[i] = this.size[j]; this.rot[i] = this.rot[j]; this.spin[i] = this.spin[j]; this.k[i] = this.k[j]; this.born[i] = this.born[j]; this.color[i] = this.color[j];
  }
  draw(c, view = null){
    const K = this.kinds, { x, y, life, max, k } = this;
    let blend = null;
    for (let i = 0; i < this.n; i++) {
      const kd = K[k[i]];
      if (view) { const m = kd.cull; if (x[i] < view.x0 - m || x[i] > view.x1 + m || y[i] < view.y0 - m || y[i] > view.y1 + m) continue; }
      if (kd.blend !== blend) { c.globalCompositeOperation = kd.blend || 'source-over'; blend = kd.blend; }
      const a = life[i] / max[i];
      kd.draw(c, this, i, a < 0 ? 0 : a > 1 ? 1 : a);
    }
    if (blend) c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  }
}
// A rotated w x h rectangle centred on (x, y) as the current path (no save/restore or transform changes).
Particles.rect = (c, x, y, w, h, r) => {
  const co = Math.cos(r), si = Math.sin(r), ax = co * w / 2, ay = si * w / 2, bx = -si * h / 2, by = co * h / 2;
  c.beginPath(); c.moveTo(x - ax - bx, y - ay - by); c.lineTo(x + ax - bx, y + ay - by); c.lineTo(x + ax + bx, y + ay + by); c.lineTo(x - ax + bx, y - ay + by); c.closePath();
};
// Ready-made kinds for quick prototypes.
Particles.basic = sys => {
  sys.kind('dot', { drag: 0.94, draw(c, s, i, a){ c.globalAlpha = a; c.fillStyle = s.color[i]; c.beginPath(); c.arc(s.x[i], s.y[i], s.size[i], 0, TAU); c.fill(); } });
  sys.kind('spark', { drag: 0.86, draw(c, s, i, a){ c.globalAlpha = Math.min(1, a * 1.5); c.strokeStyle = s.color[i]; c.lineWidth = s.size[i]; c.beginPath(); c.moveTo(s.x[i], s.y[i]); c.lineTo(s.x[i] - s.vx[i] * 0.03, s.y[i] - s.vy[i] * 0.03); c.stroke(); } });
  sys.kind('smoke', { drag: 0.92, gravity: -20, draw(c, s, i, a){ c.globalAlpha = a * 0.45; c.fillStyle = s.color[i]; c.beginPath(); c.arc(s.x[i], s.y[i], s.size[i] * (2 - a), 0, TAU); c.fill(); } });
  sys.kind('chip', { drag: 0.86, gravity: 300, draw(c, s, i, a){ c.globalAlpha = Math.min(1, a * 2); c.fillStyle = s.color[i]; Particles.rect(c, s.x[i], s.y[i], s.size[i] * 2, s.size[i], s.rot[i]); c.fill(); } });
  sys.kind('glow', { drag: 0.9, blend: 'lighter', draw(c, s, i, a){ c.globalAlpha = a * 0.6; c.fillStyle = s.color[i]; c.beginPath(); c.arc(s.x[i], s.y[i], s.size[i] * (1.5 - a * 0.5), 0, TAU); c.fill(); } });
  return sys;
};
