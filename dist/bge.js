'use strict';
/* BGEjs 0.5.0: a small browser game engine. Built from src/ by scripts/bundle.js; edit src/, not this file. */

/* ---- src/core.js ---- */
/* ================================================================
   ENGINE CORE: the canvas, the view size and small math helpers.
   The engine is a set of plain <script> files that share one global scope (no build step, works from file://).
   Load every engine/ file before any game file; engine files never read a game's state.

   It draws on <canvas id="game"> (made and added to the page if there isn't one). Globals set here:
     cv, ctx        the canvas and its 2D context
     dpr            device pixels per CSS pixel (capped at VIEW.maxDpr)
     vw, vh         the window size in CSS pixels
     scale          world units -> CSS pixels for the default camera: min(vw, vh) / VIEW.ref, clamped
   Change VIEW and call resize() to tune the default zoom for another game.
   ================================================================ */
const cv = document.getElementById('game') || document.body.appendChild(Object.assign(document.createElement('canvas'), { id: 'game' }));
const ctx = cv.getContext('2d');
const VIEW = { ref: 760, minScale: 0.55, maxScale: 1.1, maxDpr: 2 };
let dpr = 1, vw = 0, vh = 0, scale = 1;
function resize(){
  dpr = Math.min(VIEW.maxDpr, window.devicePixelRatio || 1);
  vw = innerWidth; vh = innerHeight;
  cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
  scale = Math.min(VIEW.maxScale, Math.max(VIEW.minScale, Math.min(vw, vh) / VIEW.ref));
}
addEventListener('resize', resize);

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const invLerp = (a, b, v) => a === b ? 0 : (v - a) / (b - a);
const remap = (v, a0, a1, b0, b1) => lerp(b0, b1, invLerp(a0, a1, v));
// Frame-rate independent smoothing: move a fraction of the way to b, where `rate` is the fraction left after 1 s.
const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.pow(rate, dt));
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
const fmtTime = s => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const $ = id => document.getElementById(id);
const escapeHtml = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
resize();


/* ---- src/rng.js ---- */
/* ================================================================
   RANDOM NUMBERS. Rng(seed) is a small, fast, seedable generator (sfc32), so a run can be replayed
   or a test made repeatable. Rng.main backs the global helpers below; Rng.seed(n) reseeds it.
     const r = new Rng(42); r.float(); r.range(2, 5); r.int(0, 9); r.pick(list); r.chance(0.3);
     r.shuffle(list); r.weighted([['a', 3], ['b', 1]]); r.angle(); r.gauss();
   Code that calls Math.random directly is not affected by the seed.
   Rng.fx is a second, never-seeded stream for looks and sounds (shake, sparkle, pitch wobble). Keep those off Rng.main:
   anything that runs a different number of times per play-through (rendering, rate-limited sounds) would otherwise
   shift the gameplay numbers and break replays.
   ================================================================ */
class Rng {
  constructor(seed = (Math.random() * 2 ** 32) >>> 0){ this.seed(seed); }
  seed(s){
    // splitmix32 spreads one number over the four words of state
    let x = s >>> 0;
    const next = () => { x = (x + 0x9e3779b9) >>> 0; let z = x; z = Math.imul(z ^ (z >>> 16), 0x85ebca6b); z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35); return (z ^ (z >>> 16)) >>> 0; };
    this.a = next(); this.b = next(); this.c = next(); this.d = next();
    for (let i = 0; i < 12; i++) this.next();
    return this;
  }
  next(){   // uint32
    let { a, b, c, d } = this;
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0; a = b ^ (b >>> 9); b = (c + (c << 3)) >>> 0; c = ((c << 21) | (c >>> 11)) >>> 0; c = (c + t) >>> 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return t;
  }
  float(){ return this.next() / 4294967296; }                       // [0, 1)
  range(a, b){ return a + this.float() * (b - a); }                   // [a, b)
  int(a, b){ return a + Math.floor(this.float() * (b - a + 1)); }     // [a, b], both ends included
  chance(p){ return this.float() < p; }
  sign(){ return this.float() < 0.5 ? -1 : 1; }
  angle(){ return this.float() * Math.PI * 2; }
  pick(list){ return list[Math.floor(this.float() * list.length)]; }
  gauss(mean = 0, sd = 1){ let u = 0; while (!u) u = this.float(); return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * this.float()); }
  shuffle(a){ for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.float() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }   // Fisher-Yates, in place
  weighted(items){   // items: [[value, weight], ...]
    let s = 0; for (const it of items) s += it[1];
    let r = this.float() * s; for (const it of items) { r -= it[1]; if (r <= 0) return it[0]; }
    return items[items.length - 1][0];
  }
  state(){ return [this.a, this.b, this.c, this.d]; }
  restore(s){ [this.a, this.b, this.c, this.d] = s; return this; }
}
Rng.main = new Rng();
Rng.seed = n => Rng.main.seed(n);
Rng.fx = new Rng();

// Global shorthands on Rng.main
const rand = (a, b) => Rng.main.range(a, b);
const pickW = items => Rng.main.weighted(items);
const shuffle = a => Rng.main.shuffle(a);


/* ---- src/events.js ---- */
/* ================================================================
   EVENTS: a tiny publish / subscribe bus so systems can react to each other without calling each other.
     const off = Events.on('kill', e => score += e.points);   // returns an unsubscribe function
     Events.once('bossDown', fn);  Events.emit('kill', { points: 10 });  off();
     Events.off('bossDown', fn);   // works for on() and once() handlers alike
   new Bus() makes a separate bus (one per match, say). Handlers run in the order they were added, and get up to
   three arguments: emit('hit', target, damage). A handler added or removed during an emit takes effect from the
   next emit. emit() allocates nothing.
   ================================================================ */
class Bus {
  constructor(){ this.map = new Map(); }
  // Subscribing and unsubscribing replace the handler array instead of changing it, so an emit that is running
  // keeps walking the array it started with and emit() never has to copy.
  on(name, fn){
    const l = this.map.get(name);
    this.map.set(name, l ? l.concat(fn) : [fn]);
    return () => this.off(name, fn);
  }
  once(name, fn){ const w = (a, b, c) => { this.off(name, w); fn(a, b, c); }; w.fn = fn; return this.on(name, w); }
  off(name, fn){
    const l = this.map.get(name); if (!l || !fn) return;
    const i = l.findIndex(h => h === fn || h.fn === fn); if (i < 0) return;
    if (l.length === 1) this.map.delete(name); else { const n = l.slice(); n.splice(i, 1); this.map.set(name, n); }
  }
  emit(name, a, b, c){
    const l = this.map.get(name); if (!l) return;
    for (let i = 0; i < l.length; i++) l[i](a, b, c);
  }
  count(name){ const l = this.map.get(name); return l ? l.length : 0; }
  clear(name){ if (name) this.map.delete(name); else this.map.clear(); }
}
const Events = new Bus();
addEventListener('resize', () => Events.emit('resize', { vw, vh, dpr }));   // after core.js has updated the view size


/* ---- src/ecs.js ---- */
/* ================================================================
   ECS — entities, components, systems.
   An entity is just a number. A component is a plain object stored under a name ('Pos', 'Vel', 'Life'...),
   one Map per component name, keyed by entity id. A system is a function registered once at load time for a
   phase ('update', 'drawFx', ...) and run every frame against the match's world (G.world).

     const id = G.world.spawn({ Pos: { x, y }, Vel: { x: 0, y: -40 }, Life: { t: 1, max: 1 } });
     G.world.each(['Pos', 'Vel'], (id, pos, vel) => { ... });
     system('update', 'motion', (w, dt) => { ... }, 10);   // lower order runs first
     runSystems('update', G.world, dt);

   Destroying is deferred until the phase finishes (safe mid-loop); kill() removes at once. exists(id) tells whether
   an entity is still there; add() on one that is gone does nothing (and returns undefined), so a late effect can't
   leave a component behind with no entity. clear() empties the world.
   Iteration follows spawn order, so things drawn by a system keep the order they were made in. list(name) gives
   one component kind as a cached array.
   Common components, with systems in the 'update' phase from ecsBasics(): Pos {x, y} · Vel {x, y} (moves Pos) ·
   Drag {k} (share of velocity kept per 1/60 s) · Rise {a} (upward pull) · Life {t, max} (destroyed when t reaches 0).
   For thousands of tiny short-lived things (sparks, smoke) use engine/particles.js instead: entities cost more each.
   ================================================================ */
class World {
  constructor(){ this.nextId = 1; this.stores = new Map(); this.alive = new Set(); this.dead = []; this.lists = new Map(); this.stale = new Set(); }
  store(name){ let s = this.stores.get(name); if (!s) this.stores.set(name, s = new Map()); return s; }
  spawn(comps){ const id = this.nextId++; this.alive.add(id); for (const k in comps) { this.store(k).set(id, comps[k]); this.stale.add(k); } return id; }
  add(id, name, data){ if (!this.alive.has(id)) return undefined; this.store(name).set(id, data); this.stale.add(name); return data; }
  exists(id){ return this.alive.has(id); }
  get size(){ return this.alive.size; }   // live entities
  get(id, name){ const s = this.stores.get(name); return s && s.get(id); }
  has(id, name){ const s = this.stores.get(name); return !!s && s.has(id); }
  remove(id, name){ const s = this.stores.get(name); if (s && s.delete(id)) this.stale.add(name); }
  count(name){ const s = this.stores.get(name); return s ? s.size : 0; }
  first(name){ const s = this.stores.get(name); if (s) for (const id of s.keys()) return id; return 0; }   // oldest entity with it
  destroy(id){ this.dead.push(id); }
  kill(id){ if (!this.alive.delete(id)) return; for (const [k, s] of this.stores) if (s.delete(id)) this.stale.add(k); }
  // Every component of one kind as an array, in spawn order. Cached until that store changes, so reading it every frame is cheap.
  list(name){
    let l = this.lists.get(name);
    if (!l || this.stale.has(name)) { const s = this.stores.get(name); l = s ? [...s.values()] : []; this.lists.set(name, l); this.stale.delete(name); }
    return l;
  }
  flush(){ for (const id of this.dead) this.kill(id); this.dead.length = 0; }
  clear(){ for (const [k, s] of this.stores) if (s.size) { s.clear(); this.stale.add(k); } this.alive.clear(); this.dead.length = 0; }
  // Calls fn(id, ...components) for every entity that has all the named components (walks the smallest store).
  // One- and two-component queries (nearly all of them) skip the argument array and the spread.
  each(names, fn){
    const n = names.length, ss = new Array(n); let base = 0;
    for (let i = 0; i < n; i++) { const s = this.stores.get(names[i]); if (!s || !s.size) return; ss[i] = s; if (s.size < ss[base].size) base = i; }
    if (n === 1) { for (const [id, c] of ss[0]) fn(id, c); return; }
    if (n === 2) {
      const o = ss[1 - base];
      for (const [id, c] of ss[base]) { const v = o.get(id); if (v !== undefined) base ? fn(id, v, c) : fn(id, c, v); }
      return;
    }
    const args = new Array(n + 1);
    outer: for (const [id, c] of ss[base]) {
      args[0] = id;
      for (let i = 0; i < n; i++) { const v = i === base ? c : ss[i].get(id); if (v === undefined) continue outer; args[i + 1] = v; }
      fn(...args);
    }
  }
}
const SYSTEMS = {};
function system(phase, name, fn, order = 0){
  const list = SYSTEMS[phase] || (SYSTEMS[phase] = []);
  list.push({ name, fn, order }); list.sort((a, b) => a.order - b.order);
}
function runSystems(phase, world, dt){
  if (!world) return;
  const list = SYSTEMS[phase];
  if (list) {
    if (typeof Profiler !== 'undefined' && Profiler.on) {   // engine/profiler.js: time each system
      for (const s of list) { const key = s.key || (s.key = `${phase}:${s.name}`); Profiler.begin(key); const r = s.fn(world, dt); Profiler.end(key); if (r === false) break; }
    } else for (const s of list) if (s.fn(world, dt) === false) break;   // a system returning false ends the phase
  }
  world.flush();
}

// Register the systems for the common components (call once at load if you use them).
function ecsBasics(phase = 'update'){
  system(phase, 'motion', (w, dt) => w.each(['Pos', 'Vel'], (id, p, v) => { p.x += v.x * dt; p.y += v.y * dt; }), 10);
  system(phase, 'drag', (w, dt) => w.each(['Vel', 'Drag'], (id, v, d) => { const f = Math.pow(d.k, dt * 60); v.x *= f; v.y *= f; }), 20);
  system(phase, 'rise', (w, dt) => w.each(['Vel', 'Rise'], (id, v, r) => { v.y -= r.a * dt; }), 30);
  system(phase, 'life', (w, dt) => w.each(['Life'], (id, l) => { l.t -= dt; if (l.t <= 0) w.destroy(id); }), 90);
}


/* ---- src/loop.js ---- */
/* ================================================================
   GAME LOOP. One requestAnimationFrame loop with a clock you can scale, pause and freeze.
     Loop.start({ update(dt), render(dt, alpha), step: 1/60 });   // step: null = variable dt (capped at maxDt)
     Loop.timeScale = 0.3;      // slow motion
     Loop.hitstop(0.08);        // freeze the simulation (not rendering) for a moment
     Loop.paused = true;        // render keeps running, update stops
   With a fixed step, update(dt) runs zero or more times per frame at exactly `step`, and render gets
   alpha (0..1) for interpolating between the last two updates. Loop.time is simulated seconds,
   Loop.realTime is wall seconds since start. Loop.fps is a smoothed frame rate. Loop.updates is how many times
   update ran in the current frame.
   While the tab is hidden the browser stops animation frames; set keepAliveHidden to keep updating on a timer
   (a network host needs this).

   autoInput: true lets the loop look after engine/input.js, so you never call Input.pollPad() or Input.endFrame():
   the gamepad is read once per frame and "pressed this frame" (Input.hit, pressed, padHit, wheel) is cleared after
   each update. A press is then seen by exactly one update, even with a fixed step on a fast display (where some
   frames run no update, and clearing in render would lose the press) or during a hitstop (the press waits for the
   next update). While nothing can update (Loop.paused, or timeScale 0) the presses are cleared after render instead,
   so a pause menu driven from render still sees each press once.
   ================================================================ */
const Loop = {
  update: null, render: null, step: null, maxDt: 1 / 30, maxSteps: 8,
  timeScale: 1, paused: false, keepAliveHidden: false, autoInput: false,
  time: 0, realTime: 0, frame: 0, fps: 60, running: false, updates: 0,
  _acc: 0, _last: 0, _stop: 0, _raf: 0, _timer: 0,
  start(opts = {}){
    Object.assign(this, opts);
    if (this.running) return;
    this.running = true; this._last = performance.now();
    const tick = ts => { if (!this.running) return; this._raf = requestAnimationFrame(tick); this._tick(ts); };
    this._raf = requestAnimationFrame(tick);
    this._timer = setInterval(() => {   // hidden tab: no animation frames
      if (!document.hidden || !this.keepAliveHidden || !this.running) return;
      this._tick(performance.now(), true);
    }, 200);
  },
  stop(){ this.running = false; cancelAnimationFrame(this._raf); clearInterval(this._timer); },
  hitstop(sec){ this._stop = Math.max(this._stop, sec); },
  get frozen(){ return this._stop > 0; },
  _tick(ts, hidden = false){
    const raw = Math.max(0, (ts - this._last) / 1000); this._last = ts;
    this.realTime += raw; this.frame++; this.updates = 0;
    if (raw > 0) this.fps += (1 / raw - this.fps) * 0.05;
    const auto = this.autoInput && typeof Input !== 'undefined';
    if (auto) Input.pollPad(true);
    let dt = hidden ? Math.min(raw, 1.5) : Math.min(raw, this.maxDt);
    if (!this.paused && this.update) {
      if (this._stop > 0) { const s = Math.min(this._stop, dt); this._stop -= s; dt -= s; }   // only the frozen part of the frame is lost
      dt *= this.timeScale;
      if (dt > 0) {
        if (this.step) {
          this._acc += dt; const max = hidden ? 1e4 : this.maxSteps;
          while (this._acc >= this.step && this.updates < max) { this._acc -= this.step; this._step(this.step, auto); }
          if (this._acc >= this.step) this._acc = 0;   // spiral of death guard: drop time the machine can't keep up with
        } else {
          // variable step, split so no single update is longer than maxDt (keeps physics stable in slow tabs and fast-forward)
          const n = Math.ceil(dt / this.maxDt - 1e-9);
          for (let i = 0; i < n; i++) this._step(dt / n, auto);
        }
      }
    }
    // Decided before render, which may itself unpause: the press that did so must not reach the next update too.
    const idle = this.paused || !this.update || !(this.timeScale > 0);
    if (!hidden && this.render) this.render(raw, this.step ? this._acc / this.step : 1);
    if (auto && idle && !this.updates) Input.endFrame(true);
  },
  _step(dt, auto){ this.update(dt); this.time += dt; this.updates++; if (auto) Input.endFrame(true); },
};


/* ---- src/time.js ---- */
/* ================================================================
   TIMERS AND TWEENS, driven by a Clock you tick from your update (so they pause and slow down with the game).
     const clock = new Clock();             // or use Clock.main
     clock.after(2, () => spawnBoss());     // once, in 2 s
     const h = clock.every(0.5, () => ...); h.cancel();
     clock.tween(sprite, { x: 300, alpha: 0 }, 0.4, Ease.outCubic).then(() => ...);
     clock.update(dt);                      // call once per update
   tween() animates numeric properties from their current values. It returns a handle with cancel() and then(fn).
   Tweening the same property of the same object again replaces the old tween on that property.
   Handles can be awaited: `await clock.after(1); await clock.tween(o, { x: 9 }, 0.3);` (a cancelled one never resolves).
   every() keeps its rate when the interval is shorter than a frame: it fires as many times as fit in the update.
   Ease has linear and in / out / inOut versions of Quad, Cubic, Sine, Expo and Back, plus outElastic and outBounce.
   ================================================================ */
const Ease = {
  linear: t => t,
  inQuad: t => t * t, outQuad: t => t * (2 - t), inOutQuad: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  inCubic: t => t * t * t, outCubic: t => 1 - (1 - t) ** 3, inOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2,
  inSine: t => 1 - Math.cos(t * Math.PI / 2), outSine: t => Math.sin(t * Math.PI / 2), inOutSine: t => (1 - Math.cos(t * Math.PI)) / 2,
  inBack: t => { const c = 1.70158; return (c + 1) * t * t * t - c * t * t; },
  outBack: t => { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
  inOutBack: t => { const c = 1.70158 * 1.525; return t < 0.5 ? (2 * t) ** 2 * ((c + 1) * 2 * t - c) / 2 : ((2 * t - 2) ** 2 * ((c + 1) * (2 * t - 2) + c) + 2) / 2; },
  outElastic: t => t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1,
  outBounce: t => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; },
  inExpo: t => t === 0 ? 0 : 2 ** (10 * t - 10), outExpo: t => t === 1 ? 1 : 1 - 2 ** (-10 * t),
  inOutExpo: t => t === 0 || t === 1 ? t : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2,
};
class Clock {
  constructor(){ this.t = 0; this.items = []; this.tweens = new Map(); }
  _add(it){ it.cancel = () => { it.dead = true; }; it.then = fn => { const prev = it.done; if (it.ended) fn(); else it.done = prev ? () => { prev(); fn(); } : fn; return it; }; this.items.push(it); return it; }   // then() after the end still runs fn
  _end(it){ it.dead = it.ended = true; it.done && it.done(); }
  after(sec, fn){ return this._add({ at: this.t + sec, fn }); }
  every(sec, fn, times = Infinity){ return this._add({ at: this.t + sec, fn, every: sec, left: times }); }
  tween(obj, props, dur, ease = Ease.outQuad, delay = 0){
    const to = {}; for (const k in props) to[k] = props[k];
    const it = this._add({ obj, from: {}, to, started: false, dur: Math.max(1e-6, dur), start: this.t + delay, ease, tween: true });
    let m = this.tweens.get(obj); if (!m) this.tweens.set(obj, m = {});
    for (const k in props) { if (m[k] && m[k] !== it) delete m[k].to[k]; m[k] = it; }   // newest tween owns each property
    return it;
  }
  cancelAll(obj){ for (const it of this.items) if (!obj || it.obj === obj) it.dead = true; if (obj) this.tweens.delete(obj); else this.tweens.clear(); }
  // Forget a finished tween. The per-object entry goes too once it is empty, so tweened objects can be collected.
  _drop(it){
    const m = this.tweens.get(it.obj); if (!m) return;
    let left = false; for (const p in m) { if (m[p] === it) delete m[p]; else left = true; }
    if (!left) this.tweens.delete(it.obj);
  }
  get count(){ return this.items.length; }
  update(dt){
    this.t += dt;
    const list = this.items; let w = 0;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (!it.dead) {
        if (it.tween) {
          if (this.t >= it.start) {
            const k = Math.min(1, (this.t - it.start) / it.dur), e = it.ease(k);
            if (!it.started) { for (const p in it.to) it.from[p] = it.obj[p]; it.started = true; }   // start values are read when the tween starts, not when it is made
            for (const p in it.to) it.obj[p] = it.from[p] + (it.to[p] - it.from[p]) * e;
            if (k >= 1) this._end(it);
          }
        } else if (it.every === undefined) {
          if (this.t >= it.at) { it.fn && it.fn(); this._end(it); }
        } else {
          // catch up when the interval is shorter than the update; a zero interval fires once per update
          while (!it.dead && this.t >= it.at) {
            it.fn();
            if (it.dead) break;   // cancelled from inside its own callback
            if (--it.left > 0) { it.at += it.every; if (!(it.every > 0)) break; } else this._end(it);
          }
        }
      }
      if (!it.dead) list[w++] = it;
      else if (it.tween) this._drop(it);
    }
    list.length = w;
  }
}
Clock.main = new Clock();


/* ---- src/scenes.js ---- */
/* ================================================================
   SCENES: a stack of game states (title, play, pause...). The top scene gets update(); every scene in the stack
   is drawn bottom to top unless one above it is `opaque`.
     Scenes.add('title', { enter(args){}, exit(){}, update(dt){}, render(c){}, opaque: true });
     Scenes.go('play', { level: 1 });    // replace the whole stack
     Scenes.push('pause');  Scenes.pop();  // overlays
     Scenes.update(dt);  Scenes.render(ctx);   // from your Loop
   Scenes.current is the top scene's name. Hooks are optional. pause(), resume() run on the scene under a push / pop.
   ================================================================ */
const Scenes = {
  defs: new Map(), stack: [],
  add(name, def){ this.defs.set(name, { name, ...def }); return this; },
  get current(){ const s = this.stack[this.stack.length - 1]; return s ? s.name : null; },
  _get(name){ const d = this.defs.get(name); if (!d) throw new Error(`Scenes: unknown scene "${name}"`); return d; },
  // The name is checked first, so a typo throws before any scene has been exited or paused.
  go(name, args){ const d = this._get(name); while (this.stack.length) this.stack.pop().exit?.(); this.stack.push(d); d.enter?.(args); },
  push(name, args){ const d = this._get(name); this.stack[this.stack.length - 1]?.pause?.(); this.stack.push(d); d.enter?.(args); },
  pop(){ const d = this.stack.pop(); d?.exit?.(); this.stack[this.stack.length - 1]?.resume?.(); return d; },
  update(dt){ const top = this.stack[this.stack.length - 1]; top?.update?.(dt); },
  render(c){
    let from = 0;
    for (let i = this.stack.length - 1; i >= 0; i--) if (this.stack[i].opaque) { from = i; break; }
    for (let i = from; i < this.stack.length; i++) this.stack[i].render?.(c);
  },
};


/* ---- src/pool.js ---- */
/* ================================================================
   OBJECT POOL: reuse short-lived objects instead of allocating them every frame (less garbage, fewer GC stutters).
     const shots = new Pool(() => ({ x: 0, y: 0, vx: 0, vy: 0 }), o => { o.hit = null; }, 256);
     const s = shots.get();  ...  shots.release(s);
   make() builds a fresh object, reset(o) clears one as it goes back, `prefill` builds that many up front.
   ================================================================ */
class Pool {
  constructor(make, reset = null, prefill = 0){ this.make = make; this.reset = reset; this.free = []; for (let i = 0; i < prefill; i++) this.free.push(make()); }
  get(){ return this.free.length ? this.free.pop() : this.make(); }
  release(o){ if (this.reset) this.reset(o); this.free.push(o); }
  get size(){ return this.free.length; }
}


/* ---- src/store.js ---- */
/* ================================================================
   SAVED DATA in localStorage, namespaced per game, with versions and migrations. Never throws:
   in a private window or with storage blocked or full, values are kept in memory for the session instead
   (so a settings screen still works), and store.persistent turns false.
     const save = new Store('mygame');
     save.get('settings', { vol: 0.8 });    // the default comes back when nothing is saved or it can't be read
     save.set('settings', { vol: 0.5 });  save.remove('settings');
     save.update('stats', s => { s.runs++; return s; }, { runs: 0 });   // read, change, write
     save.keys();  save.clear();            // only this namespace (and not the migration version); a store with no namespace refuses to clear
     save.migrate(2, { 2: data => { ... } });   // runs each step above the saved version once, in order
   Values are JSON. Keys are stored as `${ns}.${key}`, so don't give one game the namespaces 'a' and 'a.b': the first would
   count the second's keys as its own. set() returns false when the value could not be written to disk; setting undefined removes the key.
   ================================================================ */
class Store {
  constructor(ns){ this.ns = ns; this.mem = new Map(); this.persistent = true; }
  _k(key){ return this.ns ? `${this.ns}.${key}` : key; }
  get(key, def = null){
    const k = this._k(key);
    if (this.mem.has(k)) { try { return JSON.parse(this.mem.get(k)); } catch (e) { return def; } }
    try { const s = localStorage.getItem(k); return s === null ? def : JSON.parse(s); } catch (e) { return def; }
  }
  set(key, v){
    const k = this._k(key); let s;
    try { s = JSON.stringify(v); } catch (e) { return false; }   // a cycle or a BigInt
    if (s === undefined) { this.remove(key); return true; }
    try { localStorage.setItem(k, s); this.mem.delete(k); return true; } catch (e) { this.mem.set(k, s); this.persistent = false; return false; }
  }
  update(key, fn, def = null){ const cur = this.get(key, def), r = fn(cur), v = r === undefined ? cur : r; this.set(key, v); return v; }   // fn may change the value in place and return nothing
  remove(key){ const k = this._k(key); this.mem.delete(k); try { localStorage.removeItem(k); } catch (e) {} }
  // The keys saved under this namespace (without the prefix).
  keys(){
    const pre = this.ns ? `${this.ns}.` : '', out = new Set();
    for (const k of this.mem.keys()) out.add(k.slice(pre.length));
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k !== null && k.startsWith(pre)) out.add(k.slice(pre.length)); } } catch (e) {}
    out.delete('__version');
    return [...out];
  }
  clear(){ if (this.ns) for (const k of this.keys()) this.remove(k); }
  // steps: { [version]: fn(store) }. Each runs once, lowest first, for versions above the saved one.
  migrate(version, steps = {}){
    const at = this.get('__version', 0);
    for (const v of Object.keys(steps).map(Number).sort((a, b) => a - b)) if (v > at && v <= version) { try { steps[v](this); } catch (e) {} }
    if (at !== version) this.set('__version', version);
  }
}


/* ---- src/collide.js ---- */
/* ================================================================
   COLLISION HELPERS for circles, axis-aligned boxes, segments, rays and polygons. Plain functions, no allocation.
   Boxes are { x, y, w, h } with x, y the top-left corner. Rays take a unit direction and return the distance to
   the first hit, or -1. Functions that find a surface (rayBox, pushOutOfBox) leave its normal in Collide.nx / ny,
   which you can hand to Collide.bounce(vel, restitution) to reflect a velocity { vx, vy } off it:
     if (Collide.pushOutOfBox(ball, wall)) Collide.bounce(ball, 0.8);   // ball: { x, y, r, vx, vy }
   ================================================================ */
const Collide = {
  circles(ax, ay, ar, bx, by, br){ const r = ar + br; return dist2(ax, ay, bx, by) < r * r; },
  pointInBox(px, py, b){ return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h; },
  boxes(a, b){ return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; },
  circleBox(cx, cy, r, b){ const nx = clamp(cx, b.x, b.x + b.w), ny = clamp(cy, b.y, b.y + b.h); return dist2(cx, cy, nx, ny) < r * r; },
  // Closest point on segment a-b to p, as t in [0, 1].
  segT(px, py, ax, ay, bx, by){ const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; return l ? clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1) : 0; },
  segDist2(px, py, ax, ay, bx, by){ const t = Collide.segT(px, py, ax, ay, bx, by); return dist2(px, py, ax + (bx - ax) * t, ay + (by - ay) * t); },
  segCircle(ax, ay, bx, by, cx, cy, r){ return Collide.segDist2(cx, cy, ax, ay, bx, by) < r * r; },
  // Ray from (ox, oy) along unit (dx, dy) against a circle: distance to the first hit, or -1.
  rayCircle(ox, oy, dx, dy, cx, cy, r){
    const fx = ox - cx, fy = oy - cy, b = fx * dx + fy * dy, c = fx * fx + fy * fy - r * r;
    if (c > 0 && b > 0) return -1;
    const disc = b * b - c; if (disc < 0) return -1;
    const t = -b - Math.sqrt(disc); return t < 0 ? 0 : t;
  },
  // Ray against a box (slab test). Starting inside gives 0. Collide.nx / ny get the normal of the face it entered by.
  rayBox(ox, oy, dx, dy, b){
    let t0 = 0, t1 = Infinity, nx = 0, ny = 0;
    if (dx) { const i = 1 / dx; let a = (b.x - ox) * i, c = (b.x + b.w - ox) * i, s = -1; if (a > c) { const t = a; a = c; c = t; s = 1; } if (a > t0) { t0 = a; nx = s; ny = 0; } if (c < t1) t1 = c; }
    else if (ox < b.x || ox > b.x + b.w) return -1;
    if (dy) { const i = 1 / dy; let a = (b.y - oy) * i, c = (b.y + b.h - oy) * i, s = -1; if (a > c) { const t = a; a = c; c = t; s = 1; } if (a > t0) { t0 = a; nx = 0; ny = s; } if (c < t1) t1 = c; }
    else if (oy < b.y || oy > b.y + b.h) return -1;
    if (t0 > t1) return -1;
    Collide.nx = nx; Collide.ny = ny;
    return t0;
  },
  // Where segment a-b crosses segment c-d: t along a-b in [0, 1] (the point is a + (b - a) * t), or -1. Parallel segments never cross.
  segments(ax, ay, bx, by, cx, cy, dx, dy){
    const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy, den = rx * sy - ry * sx;
    if (!den) return -1;
    const t = ((cx - ax) * sy - (cy - ay) * sx) / den, u = ((cx - ax) * ry - (cy - ay) * rx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
  },
  pointInPoly(px, py, pts){   // pts: [x0, y0, x1, y1, ...]
    let inside = false;
    for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
      const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  },
  // Push two overlapping circles apart, split by mass (objects with x, y, r and optional mass). Returns the overlap.
  separate(a, b){
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), o = (a.r + b.r) - d;
    if (o <= 0) return 0;
    const nx = d ? dx / d : 1, ny = d ? dy / d : 0, ma = a.mass || 1, mb = b.mass || 1, ka = mb / (ma + mb), kb = ma / (ma + mb);
    a.x -= nx * o * ka; a.y -= ny * o * ka; b.x += nx * o * kb; b.y += ny * o * kb;
    return o;
  },
  // Move a circle { x, y, r } out of a solid box it overlaps (walls, platforms). Returns true when it was moved,
  // with the direction it was pushed in Collide.nx / ny.
  pushOutOfBox(o, b){
    const qx = clamp(o.x, b.x, b.x + b.w), qy = clamp(o.y, b.y, b.y + b.h);
    let dx = o.x - qx, dy = o.y - qy; const d2 = dx * dx + dy * dy;
    if (d2 >= o.r * o.r) return false;
    if (d2 > 0) { const d = Math.sqrt(d2); dx /= d; dy /= d; o.x = qx + dx * o.r; o.y = qy + dy * o.r; }
    else {   // the centre is inside the box: leave by the nearest side
      const l = o.x - b.x, r = b.x + b.w - o.x, t = o.y - b.y, u = b.y + b.h - o.y, m = Math.min(l, r, t, u);
      dx = dy = 0;
      if (m === l) { dx = -1; o.x = b.x - o.r; } else if (m === r) { dx = 1; o.x = b.x + b.w + o.r; } else if (m === t) { dy = -1; o.y = b.y - o.r; } else { dy = 1; o.y = b.y + b.h + o.r; }
    }
    Collide.nx = dx; Collide.ny = dy;
    return true;
  },
  // Reflect a velocity { vx, vy } off the surface whose normal is in Collide.nx / ny (or pass your own). `restitution` is
  // the share of speed kept along the normal (1 = perfect bounce, 0 = slide). Does nothing when already moving away.
  bounce(v, restitution = 1, nx = Collide.nx, ny = Collide.ny){
    const d = v.vx * nx + v.vy * ny; if (d >= 0) return v;
    v.vx -= (1 + restitution) * d * nx; v.vy -= (1 + restitution) * d * ny;
    return v;
  },
  nx: 0, ny: 0,
  // Keep a circle inside a box; returns which walls it touched as a bit mask (1 left, 2 right, 4 top, 8 bottom).
  clampToBox(o, b){
    let hit = 0;
    if (o.x - o.r < b.x) { o.x = b.x + o.r; hit |= 1; } else if (o.x + o.r > b.x + b.w) { o.x = b.x + b.w - o.r; hit |= 2; }
    if (o.y - o.r < b.y) { o.y = b.y + o.r; hit |= 4; } else if (o.y + o.r > b.y + b.h) { o.y = b.y + b.h - o.r; hit |= 8; }
    return hit;
  },
};


/* ---- src/spatial.js ---- */
/* ================================================================
   SPATIAL HASH: find things near a point fast. Rebuild it once per frame from whatever moves:
     const hash = new SpatialHash(64);                  // cell size in world units (about the size of a typical body)
     hash.clear(); for (const e of enemies) hash.insert(e);   // anything with x and y (and r, if it has a size)
     for (const e of hash.within(x, y, r)) ...          // exactly the things whose circle (their own r, or a point) touches this circle
     for (const e of hash.query(x, y, r)) ...           // rough and faster: everything in the cells that touch the circle (check the distance yourself)
     hash.nearest(x, y, maxR, e => !e.dead);            // the closest match within maxR (default: any distance), or null
   query() and within() fill and return one shared array unless you pass your own `out`, so copy it if you keep it
   across another call. Objects with dead === true are skipped. The world has no bounds.
   Things are filed by their centre. within() allows for their size by itself; with query() widen the radius by the
   biggest r you inserted (hash.maxR) or big things near the edge are missed.
   ================================================================ */
class SpatialHash {
  constructor(cell = 64){ this.cell = cell; this.inv = 1 / cell; this.cells = new Map(); this.buf = []; this.used = []; this._reset(); }
  _reset(){ this.maxR = 0; this.x0 = this.y0 = Infinity; this.x1 = this.y1 = -Infinity; }   // biggest r and the range of cells in use
  _key(cx, cy){ return (cx + 32768) * 65536 + (cy + 32768); }
  clear(){ for (const a of this.used) a.length = 0; this.used.length = 0; if (this.cells.size > 8192) this.cells.clear(); this._reset(); }
  insert(o){
    const cx = Math.floor(o.x * this.inv), cy = Math.floor(o.y * this.inv), k = this._key(cx, cy);
    let a = this.cells.get(k); if (!a) this.cells.set(k, a = []);
    if (!a.length) {
      this.used.push(a);
      if (cx < this.x0) this.x0 = cx; if (cx > this.x1) this.x1 = cx; if (cy < this.y0) this.y0 = cy; if (cy > this.y1) this.y1 = cy;
    }
    if (o.r > this.maxR) this.maxR = o.r;
    a.push(o);
  }
  query(x, y, r, out = this.buf){
    out.length = 0;
    const i = this.inv;   // only the cells in use are walked, so a huge radius costs no more than the whole hash
    const x0 = Math.max(this.x0, Math.floor((x - r) * i)), x1 = Math.min(this.x1, Math.floor((x + r) * i)), y0 = Math.max(this.y0, Math.floor((y - r) * i)), y1 = Math.min(this.y1, Math.floor((y + r) * i));
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const a = this.cells.get(this._key(cx, cy)); if (a) for (let j = 0; j < a.length; j++) if (!a[j].dead) out.push(a[j]);
    }
    return out;
  }
  within(x, y, r, out = this.buf){
    this.query(x, y, r + this.maxR, out);
    let w = 0;
    for (let j = 0; j < out.length; j++) { const o = out[j], rr = r + (o.r || 0); if (dist2(x, y, o.x, o.y) < rr * rr) out[w++] = o; }
    out.length = w;
    return out;
  }
  // Searches outwards ring by ring and stops as soon as no farther cell can beat the best so far, so it costs the same
  // however large maxR is. Allocates nothing.
  nearest(x, y, maxR = Infinity, filter = null){
    if (!this.used.length) return null;
    const cell = this.cell, cx = Math.floor(x * this.inv), cy = Math.floor(y * this.inv);
    const kmax = Math.max(cx - this.x0, this.x1 - cx, cy - this.y0, this.y1 - cy);
    this._best = null; this._bd = maxR * maxR;
    for (let k = 0; k <= kmax; k++) {
      if (k > 1) { const reach = (k - 1) * cell; if (reach * reach >= this._bd) break; }
      const ax = Math.max(cx - k, this.x0), bx = Math.min(cx + k, this.x1);
      for (let i = ax; i <= bx; i++) { this._scan(i, cy - k, x, y, filter); if (k) this._scan(i, cy + k, x, y, filter); }
      const ay = Math.max(cy - k + 1, this.y0), by = Math.min(cy + k - 1, this.y1);
      for (let j = ay; j <= by; j++) { this._scan(cx - k, j, x, y, filter); this._scan(cx + k, j, x, y, filter); }
    }
    const best = this._best; this._best = null;
    return best;
  }
  _scan(cx, cy, x, y, filter){
    const a = this.cells.get(this._key(cx, cy)); if (!a) return;
    for (let j = 0; j < a.length; j++) { const o = a[j]; if (o.dead) continue; const d = dist2(x, y, o.x, o.y); if (d < this._bd && (!filter || filter(o))) { this._bd = d; this._best = o; } }
  }
}


/* ---- src/particles.js ---- */
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


/* ---- src/camera.js ---- */
/* ================================================================
   CAMERA: a 2D view onto the world with follow, framing, zoom, rotation, scripted moves and screen shake.
     const cam = new Camera();             // uses the core globals vw, vh, dpr, scale
     cam.update(dt);  cam.apply(ctx);      // sets the canvas transform; draw the world after this
     cam.applyScreen(ctx);                 // back to CSS-pixel space for the HUD
     cam.view                              // { x0, y0, x1, y1 } visible world rect (for culling and Particles.draw), widened while shaking
     cam.inView(x, y, margin);  cam.toWorld(sx, sy);  cam.toScreen(wx, wy);   // screen = CSS pixels; pass an object as a last argument to reuse it
   zoom multiplies the core `scale`; angle (radians) turns the view. bounds = { x0, y0, x1, y1 } keeps the view inside the world.

   Following
     cam.follow(player, 0.001);            // track a target; the number is the share of the gap left after 1 s (0 = snap)
     cam.deadzone = { w: 120, h: 80 };     // world units: the target moves freely inside this box and the camera only moves when it leaves
     cam.lead = 0.35;                      // look ahead: aim this many seconds in front of the target (its vx, vy if it has them, else measured)
     cam.leadMax = 240; cam.leadLag = 0.02;   // the furthest it leads, in world units, and how fast the lead swings round (as lag)
     cam.offset = { x: 0, y: -40 };        // aim this far from the target, in world units
     cam.frame([p1, p2, boss], { padding: 80, minZoom: 0.25, maxZoom: 1, lag: 0.01 });   // keep several things in shot: centres on them and
                                           // zooms to fit (their r counts). The list is read every update, so add and remove freely. zoom: false only centres
     cam.snap();                           // jump straight to where the camera is heading (after a teleport or a respawn). During a moveTo it finishes the move
   A measured lead reads any jump of the aim point as speed, so call snap() after a teleport or after changing who is in a framed group.

   Zoom and scripted moves
     cam.zoomTo(2, 0.4, Ease.outCubic);    // zoom over 0.4 s (0 = now); following carries on meanwhile
     cam.zoomAt(cam.zoom * 1.1, mx, my);   // zoom now, keeping the world point under a screen point where it is (mouse wheel, pinch)
     cam.moveTo(x, y, 1.2, { ease, zoom: 1.5, hold: true, onDone });   // glide to a point; following waits until it arrives,
     cam.moving;  cam.held;  cam.release();                            // or with hold: true, until release(). follow() and frame() also cancel a move
   Cancelling a move cancels its zoom too. A zoomTo or zoomAt replaces a zoom that is running, and the replaced one's onDone is not called.

   Shake
     cam.addTrauma(0.5);                   // trauma squared x shakeMax pixels, trauma falls by shakeDecay per second
     cam.kick(6);                          // a direct jolt in pixels that dies away exponentially (kickDecay per second)
     cam.kick(10, angle);                  // a push in one direction that settles back: recoil, a landing, a hit from the left
     cam.shakeRoll = 0.05;                 // trauma also rolls the view, up to this many radians
     cam.shakeFreq = 30;                   // smooth shake at about this many wobbles a second, the same at any frame rate (0 = a new offset every update)
     cam.shakeScale = 0.5;                 // scales every shake; set it from a "screen shake" or reduced-motion setting (0 = none)
   Shake takes its random numbers from Rng.fx, so it never shifts gameplay randomness.

   Drawing
     cam.apply(ctx, 0.5);                  // parallax: a layer that scrolls at half speed (cam.view is for the main layer only)
     cam.pixelSnap = true;                 // land the view on whole device pixels, for crisp pixel art
   ================================================================ */
class Camera {
  constructor(){
    this.x = 0; this.y = 0; this.zoom = 1; this.angle = 0; this.target = null; this.lag = 0; this.bounds = null;
    this.group = null; this.deadzone = null; this.offset = null; this.lead = 0; this.leadMax = 240; this.leadLag = 0.02; this.held = false; this.pixelSnap = false;
    this.trauma = 0; this.shakeMax = 16; this.shakeDecay = 1.6; this.shakeRoll = 0; this.shakeFreq = 0; this.shakeScale = 1;
    this.amp = 0; this.kickDecay = 8; this.kickMax = 16; this.ox = 0; this.oy = 0; this.roll = 0;
    this.view = { x0: 0, y0: 0, x1: 0, y1: 0 };
    this._fit = null; this._mv = null; this._zt = null; this._gx = 0; this._gy = 0; this._gz = 1;
    this._lx = 0; this._ly = 0; this._px = 0; this._py = 0; this._seen = false; this._kx = 0; this._ky = 0; this._n = [0, 0, 0, 0, 0, 0]; this._np = 1;
  }
  follow(t, lag = 0){
    this._stop(); this.target = t; this.lag = lag; this.group = this._fit = null; this._lead0();
    if (t && !lag) { this.x = t.x; this.y = t.y; }
    return this;
  }
  frame(list, o = {}){
    this._stop(); this.group = list; this.target = null; this.lag = o.lag ?? 0.01; this._lead0();
    this._fit = o.zoom === false ? null : { pad: o.padding ?? 80, min: o.minZoom ?? 0.25, max: o.maxZoom ?? 1, lag: o.zoomLag ?? this.lag };
    return this;
  }
  snap(){
    const m = this._mv;
    if (m) {   // heading for the end of a move: finish it
      const zt = m.zt && this._zt === m.zt ? m.zt : null;
      this.x = m.x1; this.y = m.y1; this._mv = null; this.held = m.hold; if (zt) { this.zoom = zt.z1; this._zt = null; }
      if (m.onDone) m.onDone(this);
      return this;
    }
    this._lead0();
    if (!this.held && this._aim()) { const o = this.offset; this.x = this._gx + (o ? o.x : 0); this.y = this._gy + (o ? o.y : 0); if (this._fit) { this.zoom = this._gz; this._zt = null; } }
    return this;
  }
  zoomTo(z, secs = 0, ease = Camera.smooth, onDone = null){
    if (secs > 0) this._zt = { z0: this.zoom, z1: z, t: 0, d: secs, ease, onDone }; else { this.zoom = z; this._zt = null; if (onDone) onDone(this); }
    return this;
  }
  zoomAt(z, sx, sy){
    const a = this.toWorld(sx, sy, Camera._p); const wx = a.x, wy = a.y; this.zoom = z; this._zt = null;
    const b = this.toWorld(sx, sy, Camera._p); this.x += wx - b.x; this.y += wy - b.y;
    return this;
  }
  moveTo(x, y, secs = 0.5, o = {}){
    this._mv = { x0: this.x, y0: this.y, x1: x, y1: y, t: 0, d: secs, ease: o.ease || Camera.smooth, hold: !!o.hold, onDone: o.onDone || null };
    if (o.zoom != null) { this.zoomTo(o.zoom, secs, this._mv.ease); this._mv.zt = this._zt; }
    return this;
  }
  release(){ this._stop(); this._lead0(); return this; }
  _stop(){ const m = this._mv; if (m && m.zt && this._zt === m.zt) this._zt = null; this._mv = null; this.held = false; }   // a move takes its zoom with it
  get moving(){ return !!this._mv; }
  addTrauma(a){ this.trauma = Math.min(1, this.trauma + a); }
  kick(a, angle){
    if (angle == null) { this.amp = Math.min(this.kickMax, Math.max(this.amp, a)); return; }
    let x = this._kx + Math.cos(angle) * a, y = this._ky + Math.sin(angle) * a; const l = Math.hypot(x, y);
    if (l > this.kickMax) { x *= this.kickMax / l; y *= this.kickMax / l; }
    this._kx = x; this._ky = y;
  }
  get k(){ return scale * this.zoom; }   // CSS pixels per world unit
  _lead0(){ this._lx = this._ly = 0; this._seen = false; }
  // Where the camera wants to be: the target, or the middle of the group (and the zoom that fits it). False when there is nothing to follow.
  _aim(){
    const g = this.group, t = this.target;
    if (!g) { if (!t) return false; this._gx = t.x; this._gy = t.y; return true; }
    if (!g.length) return false;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < g.length; i++) { const o = g[i], r = o.r || 0; if (o.x - r < x0) x0 = o.x - r; if (o.x + r > x1) x1 = o.x + r; if (o.y - r < y0) y0 = o.y - r; if (o.y + r > y1) y1 = o.y + r; }
    this._gx = (x0 + x1) / 2; this._gy = (y0 + y1) / 2;
    const f = this._fit;
    if (f) {   // the room the group needs on screen: its box as a turned view sees it, plus the offset that pushes it off centre
      const o = this.offset, w = x1 - x0, h = y1 - y0, co = Math.abs(Math.cos(this.angle)), si = Math.abs(Math.sin(this.angle));
      const ox = o ? Math.abs(o.x) : 0, oy = o ? Math.abs(o.y) : 0;
      const fw = w * co + h * si + (ox * co + oy * si + f.pad) * 2, fh = w * si + h * co + (ox * si + oy * co + f.pad) * 2;
      const z = clamp(Math.min(fw > 0 ? vw / fw : Infinity, fh > 0 ? vh / fh : Infinity) / scale, f.min, f.max);
      this._gz = z < Infinity ? z : this.zoom;   // a single point with no padding and no top limit: nothing to fit, so stay as it is
    }
    return true;
  }
  update(dt){
    const m = this._mv, zt = this._zt;
    if (m) {
      m.t = m.d > 0 ? Math.min(1, m.t + dt / m.d) : 1; const e = m.ease(m.t);
      this.x = lerp(m.x0, m.x1, e); this.y = lerp(m.y0, m.y1, e);
      if (m.t >= 1) { this._mv = null; this.held = m.hold; this._lead0(); }
    } else if (!this.held && this._aim()) {
      let gx = this._gx, gy = this._gy;
      if (this.lead) {
        const t = this.target, own = t && typeof t.vx === 'number' && typeof t.vy === 'number';
        if (own || (dt > 0 && this._seen)) {
          let lx = (own ? t.vx : (gx - this._px) / dt) * this.lead, ly = (own ? t.vy : (gy - this._py) / dt) * this.lead; const l = Math.hypot(lx, ly);
          if (l > this.leadMax) { lx *= this.leadMax / l; ly *= this.leadMax / l; }
          this._lx = damp(this._lx, lx, this.leadLag, dt); this._ly = damp(this._ly, ly, this.leadLag, dt);
        }
        if (dt > 0) { this._px = gx; this._py = gy; this._seen = true; }
        gx += this._lx; gy += this._ly;
      } else if (this._seen || this._lx || this._ly) this._lead0();
      const o = this.offset, z = this.deadzone;
      if (o) { gx += o.x; gy += o.y; }
      if (z) {   // only the part of the gap that sticks out of the box counts
        const dx = gx - this.x, dy = gy - this.y, hx = z.w / 2, hy = z.h / 2;
        gx = this.x + (dx > hx ? dx - hx : dx < -hx ? dx + hx : 0); gy = this.y + (dy > hy ? dy - hy : dy < -hy ? dy + hy : 0);
      }
      if (this.lag) { this.x = damp(this.x, gx, this.lag, dt); this.y = damp(this.y, gy, this.lag, dt); } else { this.x = gx; this.y = gy; }
      const f = this._fit; if (f && !zt) this.zoom = f.lag ? damp(this.zoom, this._gz, f.lag, dt) : this._gz;
    }
    if (zt) {   // zoom moves by ratio, so each moment of the zoom looks as fast as the last
      zt.t = Math.min(1, zt.t + dt / zt.d); const e = zt.ease(zt.t); this.zoom = zt.z0 > 0 && zt.z1 > 0 ? zt.z0 * Math.pow(zt.z1 / zt.z0, e) : lerp(zt.z0, zt.z1, e);
      if (zt.t >= 1 && this._zt === zt) this._zt = null;
    }
    // Half the view in world units; a turned view covers a wider upright box.
    const k = this.k, co = Math.abs(Math.cos(this.angle)), si = Math.abs(Math.sin(this.angle)), w2 = vw / 2 / k, h2 = vh / 2 / k;
    const hw = w2 * co + h2 * si, hh = w2 * si + h2 * co, b = this.bounds;
    if (b) {
      this.x = b.x1 - b.x0 < hw * 2 ? (b.x0 + b.x1) / 2 : clamp(this.x, b.x0 + hw, b.x1 - hw);
      this.y = b.y1 - b.y0 < hh * 2 ? (b.y0 + b.y1) / 2 : clamp(this.y, b.y0 + hh, b.y1 - hh);
    }
    this.trauma = Math.max(0, this.trauma - this.shakeDecay * dt);
    const kd = Math.exp(-this.kickDecay * dt);
    this.amp *= kd; if (this.amp < 0.01) this.amp = 0;
    this._kx *= kd; this._ky *= kd; if (Math.abs(this._kx) < 0.01 && Math.abs(this._ky) < 0.01) this._kx = this._ky = 0;
    const q = this.shakeScale, tt = this.trauma * this.trauma, s = (tt * this.shakeMax + this.amp) * q, rmax = tt * this.shakeRoll * q;
    let nx = 0, ny = 0, nr = 0;
    if (s || rmax) {
      const R = Rng.fx, n = this._n;
      if (this.shakeFreq > 0) {   // smooth noise: glide between random points, a new one every 1 / shakeFreq seconds
        this._np += dt * this.shakeFreq; if (this._np > 2) this._np = 1 + this._np % 1;
        if (this._np >= 1) { this._np -= 1; for (let i = 0; i < 6; i += 2) { n[i] = n[i + 1]; n[i + 1] = R.range(-1, 1); } }
        const e = Camera.smooth(this._np); nx = lerp(n[0], n[1], e); ny = lerp(n[2], n[3], e); nr = lerp(n[4], n[5], e);
      } else { nx = R.range(-1, 1); ny = R.range(-1, 1); nr = R.range(-1, 1); }
    }
    this.ox = nx * s + this._kx * q; this.oy = ny * s + this._ky * q; this.roll = nr * rmax;
    // The shake can show this much more world on any side: the offset, plus how far a roll swings the corners.
    const v = this.view, pad = (s + Math.hypot(this._kx, this._ky) * q) / k + rmax * Math.hypot(w2, h2);
    v.x0 = this.x - hw - pad; v.x1 = this.x + hw + pad; v.y0 = this.y - hh - pad; v.y1 = this.y + hh + pad;
    if (m && !this._mv && m.onDone) m.onDone(this);
    if (zt && zt.t >= 1 && zt.onDone) zt.onDone(this);
  }
  apply(c, parallax = 1){
    const k = this.k * dpr, a = -(this.angle + this.roll), co = Math.cos(a) * k, si = Math.sin(a) * k, x = this.x * parallax, y = this.y * parallax;
    let e = dpr * (vw / 2 + this.ox) - (co * x - si * y), f = dpr * (vh / 2 + this.oy) - (si * x + co * y);
    if (this.pixelSnap) { e = Math.round(e); f = Math.round(f); }
    c.setTransform(co, si, -si, co, e, f);
  }
  applyScreen(c){ c.setTransform(dpr, 0, 0, dpr, 0, 0); }
  inView(x, y, m = 0){ const v = this.view; return x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m; }
  toWorld(sx, sy, out = {}){
    const u = (sx - vw / 2) / this.k, v = (sy - vh / 2) / this.k, co = Math.cos(this.angle), si = Math.sin(this.angle);
    out.x = this.x + u * co - v * si; out.y = this.y + u * si + v * co; return out;
  }
  toScreen(wx, wy, out = {}){
    const dx = wx - this.x, dy = wy - this.y, co = Math.cos(this.angle), si = Math.sin(this.angle);
    out.x = vw / 2 + (dx * co + dy * si) * this.k; out.y = vh / 2 + (dy * co - dx * si) * this.k; return out;
  }
}
Camera.smooth = t => t * t * (3 - 2 * t);   // the default ease for zoomTo and moveTo
Camera._p = { x: 0, y: 0 };


/* ---- src/input.js ---- */
/* ================================================================
   INPUT: keyboard, mouse / touch pointer, an on-screen touch stick, gamepads, and named actions over all of them.
     keys.has('a')                       // raw key state (lower-case KeyboardEvent.key); `keys` is Input.keys
     Input.pressed('a')                  // went down since the last Input.endFrame()
     Input.pointer                       // { x, y, down, button, hasMouse, type } in CSS pixels; Input.mouseDown(button)
     Input.wheel                         // wheel movement since the last Input.endFrame() (positive = down / away)
     Input.stick                         // touch drag stick { on, ox, oy, x, y }; Input.stickVec(radius) -> { x, y }
     Input.pollPad()                     // call once per frame; Input.pad is { on, lx, ly, rx, ry, dx, dy, id }, Input.padDown(i) / padHit(i)
     Input.bind('jump', ['key: ', 'pad:0', 'mouse:0']);   Input.down('jump');  Input.hit('jump');
     Input.move({ up: 'up', down: 'down', left: 'left', right: 'right' })   // -> { x, y }, length <= 1, includes the left stick and the touch stick
     Input.endFrame()                    // at the end of every frame (clears the "pressed this frame" sets)
   Loop.start({ autoInput: true }) calls pollPad() and endFrame() for you at the right moments; prefer it, and
   always use it with a fixed step (see engine/loop.js).
   Pad button numbers follow the standard mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 8 Back, 9 Start, 12-15 d-pad up/down/left/right.
   Both sticks have a round dead zone of Input.padDead, so a diagonal is as easy to hold as a straight line.
   Input.stickOn(canvas, allow) starts the touch stick on pointerdown when allow(event) is true.
   Typing in a text field is ignored by keys; Input.ignore(e) can widen that rule.
   Input.block(['key: ', 'key:arrowup']) stops those keys doing their browser job (scrolling the page) while the game has them.
   ================================================================ */
const Input = {
  keys: new Set(), _hitKeys: new Set(), _codes: new Map(), _blocked: new Set(),
  pointer: { x: 0, y: 0, down: false, button: 0, hasMouse: false, type: '' }, _hitMouse: new Set(), _ptrs: new Map(), wheel: 0,
  stick: { on: false, id: null, ox: 0, oy: 0, x: 0, y: 0 },
  pad: { on: false, id: '', lx: 0, ly: 0, rx: 0, ry: 0, dx: 0, dy: 0 }, padDead: 0.22, _pb: [], _pp: [], _hitPad: new Set(),
  actions: new Map(),
  ignore(e){ const t = e.target; return !!t && (t.isContentEditable === true || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox' && t.type !== 'radio' && t.type !== 'button')); },
  pressed(k){ return this._hitKeys.has(k); },
  // pad: also forget gamepad presses (the loop passes true; a pollPad() of your own already does this).
  endFrame(pad = false){ this._hitKeys.clear(); this._hitMouse.clear(); this.wheel = 0; if (pad) this._hitPad.clear(); },
  block(sources){ for (const s of sources) this._blocked.add(s.startsWith('key:') ? s.slice(4) : s); },
  mouseDown(button = 0){ for (const b of this._ptrs.values()) if (b === button) return true; return false; },   // any pointer: a touch counts as button 0
  releaseAll(){ this.keys.clear(); this._codes.clear(); this._ptrs.clear(); this.stick.on = false; this.pointer.down = false; },
  // ---- gamepad
  deadzone(v){ const d = this.padDead; return Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d); },
  // keep: add this poll's new presses to the ones not yet cleared by endFrame(true), instead of replacing them.
  pollPad(keep = false){
    const gp = [...(navigator.getGamepads?.() || [])].find(g => g && g.connected), P = this.pad;
    this._pp = this._pb;
    if (!keep) this._hitPad.clear();
    if (!gp) { P.on = false; this._pb = []; P.lx = P.ly = P.rx = P.ry = P.dx = P.dy = 0; return P; }
    P.on = true; P.id = gp.id;
    const pb = this._pb = gp.buttons.map(b => !!(b && (b.pressed || b.value > 0.5)));
    for (let i = 0; i < pb.length; i++) if (pb[i] && !this._pp[i]) this._hitPad.add(i);
    for (let s = 0; s < 2; s++) {   // round dead zone, rescaled so the stick still reaches 1
      let x = gp.axes[s * 2] || 0, y = gp.axes[s * 2 + 1] || 0; const l = Math.hypot(x, y), d = this.padDead;
      if (l <= d) x = y = 0; else { const m = Math.min(1, (l - d) / (1 - d)) / l; x *= m; y *= m; }
      if (s) { P.rx = x; P.ry = y; } else { P.lx = x; P.ly = y; }
    }
    P.dx = (pb[15] ? 1 : 0) - (pb[14] ? 1 : 0); P.dy = (pb[13] ? 1 : 0) - (pb[12] ? 1 : 0);
    return P;
  },
  padDown(i){ return !!this._pb[i]; },
  padHit(i){ return this._hitPad.has(i); },
  padAnyHit(){ return this._hitPad.size > 0; },
  // ---- touch stick
  stickOn(canvas, allow = () => true){
    const s = this.stick;
    canvas.addEventListener('pointerdown', e => { if (s.on || !allow(e)) return; s.on = true; s.id = e.pointerId; s.ox = s.x = e.clientX; s.oy = s.y = e.clientY; canvas.setPointerCapture?.(e.pointerId); });   // a second finger doesn't steal the stick
    canvas.addEventListener('pointermove', e => { if (s.on && e.pointerId === s.id) { s.x = e.clientX; s.y = e.clientY; } });
    const end = e => { if (e.pointerId === s.id) s.on = false; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  },
  stickVec(radius = 55, dead = 6){
    const s = this.stick; if (!s.on) return { x: 0, y: 0 };
    const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy); if (d <= dead) return { x: 0, y: 0 };
    const m = Math.min(1, d / radius); return { x: dx / d * m, y: dy / d * m };
  },
  // ---- actions
  bind(name, sources){ this.actions.set(name, sources.map(s => { const i = s.indexOf(':'); return [s.slice(0, i), s.slice(i + 1)]; })); },
  unbind(name){ this.actions.delete(name); },
  down(name){
    const l = this.actions.get(name); if (!l) return false;
    for (const [t, v] of l) if (t === 'key' ? this.keys.has(v) : t === 'pad' ? this.padDown(+v) : t === 'mouse' ? this.mouseDown(+v) : false) return true;
    return false;
  },
  hit(name){
    const l = this.actions.get(name); if (!l) return false;
    for (const [t, v] of l) if (t === 'key' ? this._hitKeys.has(v) : t === 'pad' ? this.padHit(+v) : t === 'mouse' ? this._hitMouse.has(+v) : false) return true;
    return false;
  },
  move(a = {}){
    let x = 0, y = 0;
    if (a.left && this.down(a.left)) x -= 1; if (a.right && this.down(a.right)) x += 1;
    if (a.up && this.down(a.up)) y -= 1; if (a.down && this.down(a.down)) y += 1;
    const P = this.pad; if (P.on) { if (P.lx || P.ly) { x = P.lx; y = P.ly; } else { x += P.dx; y += P.dy; } }
    if (this.stick.on) { const s = this.stickVec(); if (s.x || s.y) { x = s.x; y = s.y; } }
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    return { x, y };
  },
  // ---- event handlers
  _keyDown(e){
    if (this.ignore(e)) return;
    const k = e.key.toLowerCase();
    if (this._blocked.has(k) && !e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault();
    if (!e.repeat) this._hitKeys.add(k);
    if (e.code) { const was = this._codes.get(e.code); if (was !== undefined && was !== k) this.keys.delete(was); this._codes.set(e.code, k); }   // a held key that repeats under a new name (Shift went down) has one name at a time
    this.keys.add(k);
  },
  // The key that comes up can have another name than the one that went down (hold 1, press Shift, release: "!"), so
  // the physical key is matched too. macOS sends no key-up for keys released while Cmd is held: Cmd up releases them all.
  _keyUp(e){
    const k = e.key.toLowerCase(), was = e.code ? this._codes.get(e.code) : undefined;
    this.keys.delete(k);
    if (was !== undefined) { this.keys.delete(was); this._codes.delete(e.code); }
    if (k === 'meta') { this.keys.clear(); this._codes.clear(); }
  },
  // Every held button of every pointer is tracked (key: pointer and button), so two fingers, or two mouse buttons, don't
  // release each other. A mouse is one pointer for all its buttons: only the first press and the last release come as
  // pointerdown / pointerup, the ones in between as a pointermove that names the button.
  _ptrDown(e){ const p = this.pointer; p.x = e.clientX; p.y = e.clientY; p.down = true; p.button = e.button; p.type = e.pointerType; this._ptrs.set(e.pointerId * 8 + e.button, e.button); this._hitMouse.add(e.button); },
  _ptrMove(e){
    const p = this.pointer; p.x = e.clientX; p.y = e.clientY; p.type = e.pointerType; if (e.pointerType === 'mouse') p.hasMouse = true;
    if (e.button >= 0 && e.button < 5 && e.pointerType === 'mouse') {
      if (e.buttons & [1, 4, 2, 8, 16][e.button]) { if (!this._ptrs.has(e.pointerId * 8 + e.button)) this._ptrDown(e); } else { this._ptrs.delete(e.pointerId * 8 + e.button); p.down = this._ptrs.size > 0; }
    }
  },
  _ptrUp(e){
    for (const k of this._ptrs.keys()) if (Math.floor(k / 8) === e.pointerId) this._ptrs.delete(k);
    this.pointer.down = this._ptrs.size > 0;
  },
};
const keys = Input.keys;
addEventListener('keydown', e => Input._keyDown(e), true);
addEventListener('keyup', e => Input._keyUp(e), true);
addEventListener('blur', () => Input.releaseAll());
addEventListener('pointermove', e => Input._ptrMove(e), true);
addEventListener('pointerdown', e => Input._ptrDown(e), true);
addEventListener('pointerup', e => Input._ptrUp(e), true);
addEventListener('pointercancel', e => Input._ptrUp(e), true);
addEventListener('wheel', e => { Input.wheel += Math.sign(e.deltaY); }, { capture: true, passive: true });


/* ---- src/ui-nav.js ---- */
/* ================================================================
   UI NAVIGATION for DOM menus with a gamepad or arrow keys: moves focus to the nearest focusable element in a direction.
     UINav.roots = () => [...document.querySelectorAll('.overlay')].filter(o => !o.hidden);   // where to look (default: the whole page)
     UINav.move('u' | 'd' | 'l' | 'r');      // left / right on a focused range input changes its value
     UINav.onMove = () => playSound('tick');
   ================================================================ */
const UINav = {
  roots: () => [document.body],
  onMove: null,
  focusables(){
    return this.roots().flatMap(o => [...o.querySelectorAll('button:not([disabled]), input:not([disabled]), select, [tabindex="0"]')])
      .filter(el => { if (el.closest('[hidden]')) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  },
  move(dir){
    const list = this.focusables(); if (!list.length) return;
    const cur = document.activeElement;
    if (cur && cur.type === 'range' && (dir === 'l' || dir === 'r')) {
      const st = +(cur.step || 1) * 5 || 5; cur.value = +cur.value + (dir === 'r' ? st : -st);
      cur.dispatchEvent(new Event('input', { bubbles: true })); cur.dispatchEvent(new Event('change', { bubbles: true })); return;
    }
    if (!list.includes(cur)) { list[0].focus(); list[0].scrollIntoView?.({ block: 'nearest' }); return; }
    const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    const v = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] }[dir];
    let best = null, bs = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect(), dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
      const along = dx * v[0] + dy * v[1], across = Math.abs(dx * v[1] - dy * v[0]);
      if (along <= 4) continue;
      const sc = along + across * 2.2; if (sc < bs) { bs = sc; best = el; }
    }
    if (best) { best.focus(); best.scrollIntoView?.({ block: 'nearest' }); this.onMove && this.onMove(); }
  },
};


/* ---- src/audio.js ---- */
/* ================================================================
   SOUND: Web Audio with synthesized effects (no files needed) and optional sampled ones.
   Browsers only allow sound after a click or key press: call Sound.init() from one (or Sound.unlockOnGesture()).
     Sound.define('hit', (S, t) => { S.noise(0.06, 'bandpass', 3000, 0.16, 2); S.tone('square', 1100, 300, 0.04, 0.03); }, 0.035);
     Sound.play('hit');                    // the last argument of define() is the minimum gap between two plays (rate limit)
     Sound.muted = true;  Sound.setVolume(0.5);   // muting also silences what is already playing, drones included
     const buf = await Sound.load('sfx/boom.ogg');  Sound.playBuffer(buf, { vol: 0.8, rate: 1.1 });
     const hum = Sound.drone('sawtooth', 40, 700);  hum.set(freq, vol);  hum.stop();   // a continuous tone (engine hum, wind)
   Inside a recipe: S.noise(dur, filterType, freq, vol, q = 1, delay = 0) and S.tone(wave, f0, f1, dur, vol, delay = 0),
   both scheduled from the current time. S.ac is the AudioContext and S.out the master gain.
   ================================================================ */
const Sound = {
  ac: null, out: null, _muted: false, vol: 0.5, noiseBuf: null, recipes: new Map(), last: new Map(), drones: [],
  init(){
    if (this.ac) { this.ac.resume?.(); return true; }
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      this.ac = ac; this.out = ac.createGain(); this.out.gain.value = this._muted ? 0 : this.vol; this.out.connect(ac.destination);
      const len = ac.sampleRate * 0.5, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      for (const dr of this.drones) dr._build();
      return true;
    } catch (e) { this.ac = null; return false; }
  },
  unlockOnGesture(){ for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchend']) addEventListener(ev, () => this.init(), { capture: true, passive: true }); },
  get muted(){ return this._muted; },
  set muted(m){ this._muted = !!m; this._gain(); },
  setVolume(v){ this.vol = v; this._gain(); },
  _gain(){ if (this.out) this.out.gain.setTargetAtTime(this._muted ? 0 : this.vol, this.ac.currentTime, 0.015); },   // a short ramp, so no click
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
  async load(url){
    const r = await fetch(url); if (!r.ok) throw new Error(`Sound: ${url} (${r.status})`);
    const b = await r.arrayBuffer();
    if (!this.ac && !this.init()) throw new Error('Sound: no Web Audio here');
    return this.ac.decodeAudioData(b);
  },
  playBuffer(buf, o = {}){
    if (!this.ac || this.muted || !buf) return null;
    const s = this.ac.createBufferSource(), g = this.ac.createGain(); s.buffer = buf; s.playbackRate.value = o.rate || 1; s.loop = !!o.loop; g.gain.value = o.vol ?? 1;
    s.connect(g); g.connect(this.out); s.start(); return s;
  },
  // A continuous tone through a low-pass filter. It is silent until set(); safe to make before init().
  drone(wave = 'sawtooth', freq = 40, cutoff = 700){
    const S = this, d = { o: null, g: null,
      _build(){ if (!S.ac || d.o) return; const o = S.ac.createOscillator(), f = S.ac.createBiquadFilter(), g = S.ac.createGain(); o.type = wave; o.frequency.value = freq; f.type = 'lowpass'; f.frequency.value = cutoff; g.gain.value = 0; o.connect(f); f.connect(g); g.connect(S.out); o.start(); d.o = o; d.g = g; },
      set(fr, vol){ if (!d.o) d._build(); if (!d.o) return; const t = S.ac.currentTime; d.o.frequency.setTargetAtTime(fr, t, 0.05); d.g.gain.setTargetAtTime(vol, t, 0.08); },
      stop(){ const i = S.drones.indexOf(d); if (i >= 0) S.drones.splice(i, 1); if (d.o) { try { d.o.stop(); d.o.disconnect(); d.g.disconnect(); } catch (e) {} } d.o = d.g = null; d._build = () => {}; } };
    this.drones.push(d); d._build();
    return d;
  },
};


/* ---- src/music.js ---- */
/* ================================================================
   MUSIC PLAYER: streamed <audio> tracks with a playlist, volume, mute and looping, and the browser's
   "no sound before a gesture" rule handled for you.
     const bgm = new MusicPlayer([{ src: 'music/a.mp3', name: 'A' }, { src: 'music/b.mp3', name: 'B' }], { loop: false, vol: 0.7 });
     bgm.play();  bgm.next();  bgm.stop();  bgm.volume = 0.5;  bgm.muted = true;  bgm.playing   // track name or ''
     bgm.pause(); bgm.resume()   // hold it (a pause menu) without losing its place; gestures won't restart it
     bgm.stop(true)   // stop and unload, so the next play() starts the current track from the top
     bgm.loopFrom = 6.5   // a single looping track goes back here instead of 0 (skip an intro)
   With one track and loop: true it repeats; with several it moves to the next when one ends. play() before the
   first click or key press is retried on the next gesture.
   ================================================================ */
class MusicPlayer {
  constructor(tracks, o = {}){
    this.tracks = tracks; this.idx = o.start ?? 0; this.loopFrom = o.loopFrom || 0; this.loop = o.loop ?? tracks.length === 1; this._vol = o.vol ?? 0.75; this._muted = false; this.want = false; this.held = false;
    this.el = new Audio(); this.el.preload = 'none';
    this.el.addEventListener('ended', () => { if (this.loop && this.tracks.length === 1) { this.el.currentTime = this.loopFrom; if (this.want && !this.held) this._play(); } else this.next(); });
    for (const ev of ['pointerup', 'keydown', 'touchend', 'click']) addEventListener(ev, () => { if (this.want && !this.held && this.el.paused) this._play(); }, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.el.pause(); else if (this.want && !this.held) this._play(); });
  }
  _play(){ this.el.volume = this._vol; this.el.muted = this._muted || !this._vol; this.el.play().catch(() => {}); }
  play(i){
    if (i !== undefined || !this.el.src) { if (i !== undefined) this.idx = i; this.el.src = this.tracks[this.idx].src; }
    this.want = true; this.held = false; this._play();
  }
  pause(){ this.held = true; this.el.pause(); }
  resume(){ this.held = false; if (this.want) this._play(); }
  next(){ this.idx = (this.idx + 1) % this.tracks.length; this.el.src = this.tracks[this.idx].src; if (this.want && !this.held) this._play(); }
  stop(unload = false){ this.want = false; this.held = false; this.el.pause(); if (unload) { this.el.removeAttribute('src'); this.el.load(); } }
  get playing(){ return this.want && !this.el.paused ? this.tracks[this.idx].name || this.tracks[this.idx].src : ''; }
  get volume(){ return this._vol; } set volume(v){ this._vol = v; this.el.volume = v; this.el.muted = this._muted || !v; }
  get muted(){ return this._muted; } set muted(m){ this._muted = m; this.el.muted = m || !this._vol; }
}


/* ---- src/assets.js ---- */
/* ================================================================
   ASSETS: load images, sounds, JSON and text up front, with progress, then fetch them by name.
     await Assets.load({ hero: 'img/hero.png', hit: 'sfx/hit.ogg', level1: 'data/level1.json' }, (done, total) => bar(done / total));
     Assets.get('hero')          // HTMLImageElement, AudioBuffer (decoded with engine/audio.js), object or string
   Types come from the extension: png jpg jpeg gif webp svg -> image; mp3 ogg wav m4a -> sound; json; anything else -> text.
   A failed file rejects load() with its name; the others still finish.
   ================================================================ */
const Assets = {
  cache: new Map(),
  get(name){ return this.cache.get(name); },
  has(name){ return this.cache.has(name); },
  _one(url){
    const ext = url.split('?')[0].split('.').pop().toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error(url)); im.src = url; });
    if (['mp3', 'ogg', 'wav', 'm4a'].includes(ext)) return Sound.load(url);
    return fetch(url).then(r => { if (!r.ok) throw new Error(url); return ext === 'json' ? r.json() : r.text(); });
  },
  async load(map, onProgress){
    const names = Object.keys(map); let done = 0; const errors = [];
    await Promise.all(names.map(n => this._one(map[n]).then(v => { this.cache.set(n, v); }, () => errors.push(n)).finally(() => onProgress && onProgress(++done, names.length))));
    if (errors.length) throw new Error(`Assets failed: ${errors.join(', ')}`);
    return this;
  },
};


/* ---- src/sprites.js ---- */
/* ================================================================
   SPRITE CACHE: draw something complex once into an offscreen canvas, then stamp it every frame with drawImage
   (much cheaper than redrawing paths). Entries are kept in least-recently-used order up to `max`.
     const sp = Sprites.get('wedge:red', 24, devicePxPerUnit, c => drawWedge(c));   // draw() gets a context centred on (0, 0)
     Sprites.stamp(ctx, sp, x, y, angle);       // or stamp(ctx, sp) at the current origin
     Sprites.scaleOf(ctx)                       // device pixels per world unit right now, rounded so a few sizes cover every zoom
   R is the drawing's radius in world units; pass the scale you will draw at so it stays sharp: each scale gets its
   own copy, so a sprite is redrawn rather than stretched after a zoom or a resize. Include anything else that
   changes the art in the key, and draw moving parts live on top.

   SPRITE SHEETS: frames cut from one image in a grid, and animations over them.
     const sheet = Sprites.sheet(Assets.get('hero'), 32, 32, { margin: 0, spacing: 0 });   // frame size in image pixels
     sheet.draw(ctx, frame, x, y, { w: 48, angle: 0, flipX: true, alpha: 1, ox: 0.5, oy: 0.5 });   // w / h in world units (default: the frame size)
     const run = sheet.anim([0, 1, 2, 3], 12);          // frames and frames per second; { loop: false, onEnd } to play once
     run.update(dt);  run.draw(ctx, x, y, opts);  run.frame;  run.done;  run.reset();
   Frames are numbered left to right, top to bottom, from 0. ox / oy set the point of the frame placed on (x, y),
   as a share of its size (0.5, 1 = bottom centre, for something standing on the ground).
   ================================================================ */
const Sprites = {
  map: new Map(), max: 800, made: 0,
  get(key, R, ds, draw){
    let sp = this.map.get(key);
    if (sp && sp.raw === ds) { this.map.delete(key); this.map.set(key, sp); return sp; }   // the usual case: same scale as last time
    // Scales are rounded up to one of 16 sizes per doubling, so a scale that changes every frame (a zoom tween, a window
    // being dragged) makes a handful of copies, not one per frame.
    const raw = ds; ds = 2 ** (Math.ceil(Math.log2(ds) * 16 - 1e-9) / 16);
    if (sp && sp.ds !== ds) {
      // Drawn for another scale. The plain key always holds the scale asked for last, so the usual case (one scale at a
      // time) builds no string; the other copies wait under key@scale.
      this.map.delete(key); this.map.set(key + '@' + sp.ds, sp);
      const k2 = key + '@' + ds; sp = this.map.get(k2);
      if (sp) { this.map.delete(k2); this.map.set(key, sp); sp.raw = raw; return sp; }
    } else if (sp) { this.map.delete(key); this.map.set(key, sp); sp.raw = raw; return sp; }   // mark as recently used
    const px = Math.ceil(2 * R * ds) + 2, cnv = document.createElement('canvas'); cnv.width = cnv.height = px;
    const c = cnv.getContext('2d'); c.setTransform(ds, 0, 0, ds, px / 2, px / 2); c.lineCap = 'round';
    draw(c);
    sp = { cv: cnv, h: px / 2 / ds, w: px / ds, ds, raw }; this.map.set(key, sp); this.made++;
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);   // drop the least recently used
    return sp;
  },
  stamp(c, sp, x, y, ang){
    if (x === undefined) { c.drawImage(sp.cv, -sp.h, -sp.h, sp.w, sp.w); return; }
    if (!ang) { c.drawImage(sp.cv, x - sp.h, y - sp.h, sp.w, sp.w); return; }
    c.save(); c.translate(x, y); c.rotate(ang); c.drawImage(sp.cv, -sp.h, -sp.h, sp.w, sp.w); c.restore();
  },
  scaleOf(c){ const m = c.getTransform(), d = Math.hypot(m.a, m.b) * 1.04; return 2 ** (Math.round(Math.log2(d) * 16) / 16); },
  clear(){ this.map.clear(); },
  sheet(img, fw, fh, o = {}){
    const m = o.margin || 0, sp = o.spacing || 0, iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const cols = Math.max(1, Math.floor((iw - 2 * m + sp) / (fw + sp))), rows = Math.max(1, Math.floor((ih - 2 * m + sp) / (fh + sp)));
    const sheet = { img, fw, fh, cols, rows, count: cols * rows,
      draw(c, f, x, y, d){
        const sx = m + (f % cols) * (fw + sp), sy = m + Math.floor(f / cols) * (fh + sp);
        if (!d) { c.drawImage(img, sx, sy, fw, fh, x - fw / 2, y - fh / 2, fw, fh); return; }
        const w = d.w ?? (d.h !== undefined ? d.h * fw / fh : fw), h = d.h ?? w * fh / fw, ox = d.ox ?? 0.5, oy = d.oy ?? 0.5;
        const a = d.alpha, pa = c.globalAlpha; if (a !== undefined) c.globalAlpha = pa * a;
        if (d.angle || d.flipX || d.flipY) {
          c.save(); c.translate(x, y); if (d.angle) c.rotate(d.angle); c.scale(d.flipX ? -1 : 1, d.flipY ? -1 : 1);
          c.drawImage(img, sx, sy, fw, fh, -w * ox, -h * oy, w, h); c.restore();
        } else c.drawImage(img, sx, sy, fw, fh, x - w * ox, y - h * oy, w, h);
        if (a !== undefined) c.globalAlpha = pa;
      },
      anim(frames, fps = 10, ao = {}){
        const an = { frames, fps, loop: ao.loop ?? true, onEnd: ao.onEnd || null, t: 0, i: 0, done: false,
          get frame(){ return an.frames[an.i]; },
          reset(){ an.t = 0; an.i = 0; an.done = false; return an; },
          update(dt){
            if (an.done || !(an.fps > 0)) return an;
            an.t += dt; const n = an.frames.length; let i = Math.floor(an.t * an.fps);
            if (i >= n) { if (an.loop) { an.t -= Math.floor(i / n) * n / an.fps; i %= n; } else { i = n - 1; an.done = true; an.i = i; an.onEnd && an.onEnd(an); return an; } }
            an.i = i; return an;
          },
          draw(c, x, y, d){ sheet.draw(c, an.frames[an.i], x, y, d); } };
        return an;
      } };
    return sheet;
  },
};


/* ---- src/look.js ---- */
/* ================================================================
   CARTOON LOOK: two optional post effects for a hand-inked, old-film style.
   Ink: while inkOn is set, every solid fill on any canvas also gets an ink outline (INK colour, inkW wide).
   See-through fills (alpha under 0.85), gradients and patterns are skipped. Set inkOn = 1 around what should
   be inked and back to 0 after (HUD, glows). This patches CanvasRenderingContext2D.fill / fillRect once at load.
   Film: filmFx() draws grain, flicker, dust, scratches and a vignette over the whole canvas in screen space;
   tune it through FILM (vignette colour and strength, grain, scratch and dust odds).
   ================================================================ */
const INK = '#1c120a';
let inkOn = 0, inkW = 2.2;
(function(){
  const P = CanvasRenderingContext2D.prototype, f0 = P.fill, fr0 = P.fillRect;
  const solid = c => {
    if (c.globalAlpha < 0.85) return false;
    const s = c.fillStyle; if (typeof s !== 'string') return false;
    if (s.charCodeAt(0) === 114) { const a = parseFloat(s.slice(s.lastIndexOf(',') + 1)); return !(a < 0.85); }   // 'rgba(...)'
    return s !== INK;
  };
  const ink = (c, fn) => {   // swap only the stroke settings in and out (cheaper than save/restore, which runs thousands of times a frame)
    const ss = c.strokeStyle, lw = c.lineWidth, lj = c.lineJoin, sb = c.shadowBlur, ld = c.getLineDash();
    c.strokeStyle = INK; c.lineWidth = inkW; c.lineJoin = 'round'; if (ld.length) c.setLineDash([]); if (sb) c.shadowBlur = 0;
    fn();
    c.strokeStyle = ss; c.lineWidth = lw; c.lineJoin = lj; if (ld.length) c.setLineDash(ld); if (sb) c.shadowBlur = sb;
  };
  P.fill = function(a, b){
    if (a === undefined) f0.call(this); else if (b === undefined) f0.call(this, a); else f0.call(this, a, b);
    if (inkOn && solid(this)) ink(this, () => a instanceof Path2D ? this.stroke(a) : this.stroke());
  };
  P.fillRect = function(x, y, w, h){
    fr0.call(this, x, y, w, h);
    if (inkOn && Math.abs(w) > 3 && Math.abs(h) > 3 && solid(this)) ink(this, () => this.strokeRect(x, y, w, h));
  };
})();
// Film overlay in screen space: grain, flicker, dust, scratches and a vignette.
const FILM = { grain: [], vig: null, vw: 0, vh: 0, n: 0, scratch: [], vigColor: '40,22,8', vigAlpha: 0.55, flicker: 0.25, scratchOdds: 0.04, dustOdds: 0.3 };
function filmFx(){
  const c = ctx, W = cv.width, H = cv.height;
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (!FILM.grain.length) for (let g = 0; g < 4; g++) {
    const n = document.createElement('canvas'); n.width = n.height = 160; const x = n.getContext('2d'), d = x.createImageData(160, 160);
    for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255 | 0; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = Math.random() < 0.5 ? 26 : 0; }
    x.putImageData(d, 0, 0); FILM.grain.push(c.createPattern(n, 'repeat'));
  }
  if (FILM.vw !== W || FILM.vh !== H) {
    FILM.vw = W; FILM.vh = H; const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    g.addColorStop(0, `rgba(${FILM.vigColor},0)`); g.addColorStop(1, `rgba(${FILM.vigColor},${FILM.vigAlpha})`);
    const v = document.createElement('canvas'); v.width = W; v.height = H; const vc = v.getContext('2d'); vc.fillStyle = g; vc.fillRect(0, 0, W, H); FILM.vig = v;   // drawn once per size, then blitted
  }
  FILM.n++;
  const q = (FILM.n >> 1) % 4;   // grain changes every other frame, like film at 30fps
  const gp = FILM.grain[q]; if (gp.setTransform) gp.setTransform(new DOMMatrix([1, 0, 0, 1, (Math.random() * 160) | 0, (Math.random() * 160) | 0])); c.fillStyle = gp; c.fillRect(0, 0, W, H);
  c.drawImage(FILM.vig, 0, 0);
  if (Math.random() < FILM.flicker) { c.fillStyle = `rgba(255,236,200,${Math.random() * 0.035})`; c.fillRect(0, 0, W, H); }   // projector flicker
  if (Math.random() < FILM.scratchOdds) FILM.scratch.push({ x: Math.random() * W, life: 6 + Math.random() * 14 | 0, w: Math.random() < 0.5 ? 1 : 2 });
  c.fillStyle = 'rgba(30,18,8,.35)';
  for (const sc of FILM.scratch) { sc.x += (Math.random() - 0.5) * 6; c.fillRect(sc.x, 0, sc.w * dpr, H); sc.life--; }
  FILM.scratch = FILM.scratch.filter(sc => sc.life > 0);
  if (Math.random() < FILM.dustOdds) { c.fillStyle = 'rgba(25,15,6,.5)'; for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(Math.random() * W, Math.random() * H, (0.8 + Math.random() * 2.2) * dpr, 0, TAU); c.fill(); } }
}


/* ---- src/profiler.js ---- */
/* ================================================================
   PROFILER: how long each system and phase takes, and an on-screen overlay.
     Profiler.on = true;                         // runSystems() then times every system automatically
     Profiler.begin('render'); ...; Profiler.end('render');   // time anything else
     Profiler.count('particles', fx.count);      // any number you want on the overlay
     Profiler.frame();                           // once per frame, after rendering
     Profiler.draw(ctx);                         // the overlay (top-left, CSS-pixel space); Profiler.report() -> rows
   Times are smoothed averages in milliseconds. Turning it off costs nothing.
   ================================================================ */
const Profiler = {
  on: false, t: new Map(), open: new Map(), counts: new Map(), frameMs: 0, _last: 0, fps: 0,
  begin(name){ if (this.on) this.open.set(name, performance.now()); },
  end(name){
    if (!this.on) return; const s = this.open.get(name); if (s === undefined) return;
    const d = performance.now() - s, o = this.t.get(name); this.t.set(name, o === undefined ? d : o + (d - o) * 0.1);
  },
  count(name, n){ if (this.on) this.counts.set(name, n); },
  frame(){
    const now = performance.now();
    if (this._last) { const d = now - this._last; this.frameMs += (d - this.frameMs) * 0.1; this.fps = this.frameMs ? 1000 / this.frameMs : 0; }
    this._last = now;
  },
  report(){ return [...this.t.entries()].sort((a, b) => b[1] - a[1]).map(([name, ms]) => ({ name, ms })); },
  draw(c, top = 8){
    if (!this.on) return;
    c.save(); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rows = [`${this.fps.toFixed(0)} fps  ${this.frameMs.toFixed(1)} ms`, ...[...this.counts].map(([k, v]) => `${k}: ${v}`), ...this.report().slice(0, 14).map(r => `${r.ms.toFixed(2).padStart(6)}  ${r.name}`)];
    c.font = '11px monospace'; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillStyle = 'rgba(0,0,0,.65)'; c.fillRect(8, top, 230, rows.length * 14 + 8);
    c.fillStyle = '#d7f7d0'; rows.forEach((r, i) => c.fillText(r, 14, top + 4 + i * 14));
    c.restore();
  },
};


/* ---- src/net.js ---- */
/* ---------------- NETWORK transport: the claude.ai live room when the page runs there, else a BroadcastChannel between tabs of one browser.
   netInit() picks one; netJoin(name) gives a room with presence(patch), peers(), leave(). Presence only: each peer publishes one small object. ---------------- */
const NET = { kind: null, api: null, lobby: null, channel: 'bge-net' };   // set NET.channel per game before netInit()
function localNet(){                     // BroadcastChannel stand-in with the room API's shape (tabs of one browser)
  const id = Math.random().toString(36).slice(2, 10), bc = new BroadcastChannel(NET.channel), rooms = new Map();
  const send = (r, extra) => { try { bc.postMessage({ id, room: r.name, p: r.mine, ...extra }); } catch (e) {} };
  bc.onmessage = ev => {
    const m = ev.data; if (!m || m.id === id) return; const r = rooms.get(m.room); if (!r) return;
    if (m.bye) r.others.delete(m.id); else r.others.set(m.id, { peer: m.id, isMe: false, sameTab: false, presence: Object.freeze(m.p || {}), seen: performance.now() });
    if (m.hello) send(r);
  };
  setInterval(() => { const now = performance.now(); for (const r of rooms.values()) { send(r); for (const [k, o] of r.others) if (now - o.seen > 3500) r.others.delete(k); } }, 1000);
  addEventListener('pagehide', () => { for (const r of rooms.values()) send(r, { bye: 1 }); });
  function room(name){
    if (rooms.has(name)) return rooms.get(name);
    let pend = 0;
    const r = { name, mine: {}, others: new Map(),
      presence(patch){ r.mine = { ...r.mine }; for (const k in patch) { if (patch[k] === null) delete r.mine[k]; else r.mine[k] = patch[k]; } if (!pend) pend = setTimeout(() => { pend = 0; send(r); }, 33); return Promise.resolve(); },
      peers(){ return [{ peer: id, isMe: true, sameTab: true, presence: r.mine }, ...r.others.values()]; },
      leave(){ send(r, { bye: 1 }); rooms.delete(name); return Promise.resolve(); },
      connected(){ return true; } };
    rooms.set(name, r); send(r, { hello: 1 });
    return r;
  }
  return { lobby: room('lobby'), join: name => Promise.resolve(room(name)) };
}
async function netInit(){
  if (NET.kind) return NET.kind !== 'none';
  let room = null;
  try { if (window.claude && claude.use) room = await claude.use('room'); } catch (e) {}
  if (room) { NET.kind = 'room'; NET.api = room; NET.lobby = room; }
  else if (typeof BroadcastChannel !== 'undefined') { NET.kind = 'local'; NET.api = localNet(); NET.lobby = NET.api.lobby; }
  else NET.kind = 'none';
  return NET.kind !== 'none';
}
const netJoin = name => NET.api ? NET.api.join(name) : Promise.reject(new Error('netJoin: call netInit() first (or no transport is available)'));
const safePres = (room, obj) => { try { room.presence(obj).catch(() => {}); } catch (e) {} };

