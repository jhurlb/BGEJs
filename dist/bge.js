'use strict';
/* BGEjs 0.8.0: a small browser game engine. Built from src/ by scripts/bundle.js; edit src/, not this file. */

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

   TRANSITIONS: a last argument to go, push or pop fades the screen out, switches behind the cover, and fades back in.
     Scenes.go('play', { level: 2 }, 0.5);                    // half a second through black
     Scenes.go('title', null, { fade: 0.8, color: '#fff' });  // through white
     Scenes.pop({ fade: 0.6, draw(c, k){ ... } });            // your own cover: k goes 0 -> 1 (covered, the switch happens) -> 0
   It is driven by Scenes.update(dt) and drawn by Scenes.render(ctx), over every scene. The scene on top is not updated
   while the cover closes, so nothing is pressed twice (freeze: false keeps it running). Scenes.busy is true meanwhile.
   A second go / push / pop with a transition while the cover is still closing replaces the first.
   ================================================================ */
const Scenes = {
  defs: new Map(), stack: [], fade: null,
  add(name, def){ this.defs.set(name, { name, ...def }); return this; },
  get current(){ const s = this.stack[this.stack.length - 1]; return s ? s.name : null; },
  _get(name){ const d = this.defs.get(name); if (!d) throw new Error(`Scenes: unknown scene "${name}"`); return d; },
  // The name is checked first, so a typo throws before any scene has been exited or paused.
  go(name, args, tr){ const d = this._get(name); if (tr) return this._via(tr, () => this.go(name, args)); while (this.stack.length) this.stack.pop().exit?.(); this.stack.push(d); d.enter?.(args); },
  push(name, args, tr){ const d = this._get(name); if (tr) return this._via(tr, () => this.push(name, args)); this.stack[this.stack.length - 1]?.pause?.(); this.stack.push(d); d.enter?.(args); },
  pop(tr){ if (tr) return this._via(tr, () => this.pop()); const d = this.stack.pop(); d?.exit?.(); this.stack[this.stack.length - 1]?.resume?.(); return d; },
  get busy(){ return !!this.fade; },
  _via(o, act){
    if (typeof o === 'number') o = { fade: o };
    const f = this.fade;
    if (f && f.act) { f.act = act; return; }   // still closing: switch to the newer place instead
    this.fade = { t: 0, dur: Math.max(1e-6, o.fade ?? 0.4), color: o.color || '#000', draw: o.draw || null, freeze: o.freeze !== false, act };
  },
  update(dt){
    const f = this.fade;
    if (f) {
      const closing = !!f.act; f.t += dt;
      if (closing && f.t >= f.dur / 2) { const act = f.act; f.act = null; act(); }
      if (f.t >= f.dur && this.fade === f) this.fade = null;
      if (closing && f.freeze) return;
    }
    const top = this.stack[this.stack.length - 1]; top?.update?.(dt);
  },
  render(c){
    let from = 0;
    for (let i = this.stack.length - 1; i >= 0; i--) if (this.stack[i].opaque) { from = i; break; }
    for (let i = from; i < this.stack.length; i++) this.stack[i].render?.(c);
    const f = this.fade;
    if (f) {
      const k = clamp(1 - Math.abs(1 - 2 * f.t / f.dur), 0, 1), cn = c.canvas || cv;
      if (f.draw) f.draw(c, k);
      else { c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = k; c.fillStyle = f.color; c.fillRect(0, 0, cn.width, cn.height); c.restore(); }
    }
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
   the first hit, or -1. Functions that find a surface (rayBox, pushOutOfBox, ray, overlap, sweep) leave its normal in
   Collide.nx / ny, which you can hand to Collide.bounce(vel, restitution) to reflect a velocity { vx, vy } off it:
     if (Collide.pushOutOfBox(ball, wall)) Collide.bounce(ball, 0.8);   // ball: { x, y, r, vx, vy }

   SHAPES. overlap, sweep, ray and resolve take any two shapes, each a plain object:
     { x, y, r }             a circle, x, y its centre
     { x, y, w, h }          a box, x, y its top-left corner
     { x, y, pts: [...] }    a convex polygon: [x0, y0, x1, y1, ...] relative to x, y, wound either way
     Collide.overlap(a, b)            how deep a is in b (0 = apart); nx / ny is the way to move a to get out
     Collide.sweep(a, dx, dy, b)      a moves by (dx, dy): the share of the move, 0..1, at which it first touches b, or -1.
                                      Nothing can tunnel through this, however fast or thin. nx / ny is the surface it hits
     Collide.ray(ox, oy, dx, dy, s)   rayCircle / rayBox for any shape, always with the normal
     Collide.resolve(a, b, bounce, friction)   a full collision between two things with vx, vy and an optional mass:
                                      pushes them apart and trades momentum. mass: Infinity or fixed: true never moves
   For many things at once, with gravity, stacking and resting contact, use Physics (physics.js), which is built on these.
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
  // mass: Infinity (or fixed: true) is never moved.
  separate(a, b){
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), o = (a.r + b.r) - d;
    if (o <= 0) return 0;
    const ia = Collide.invMass(a), ib = Collide.invMass(b), k = ia + ib; if (!k) return o;
    const nx = d ? dx / d : 1, ny = d ? dy / d : 0, ka = ia / k, kb = ib / k;
    a.x -= nx * o * ka; a.y -= ny * o * ka; b.x += nx * o * kb; b.y += ny * o * kb;
    return o;
  },
  invMass(o){ return o.fixed || o.mass === Infinity ? 0 : o.mass > 0 ? 1 / o.mass : 1; },   // no mass, 0 or nonsense counts as 1
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
  // ---- any shape against any shape
  // How deep a is in b, or 0 when they are apart. Collide.nx / ny is the shortest way to move a out of b.
  overlap(a, b, tol = 0){   // tol is for Physics: see _polys
    const C = Collide, ka = a.r !== undefined ? 0 : a.pts ? 2 : 1, kb = b.r !== undefined ? 0 : b.pts ? 2 : 1;
    if (ka === 0) {
      if (kb === 0) {
        const dx = a.x - b.x, dy = a.y - b.y, r = a.r + b.r, d2 = dx * dx + dy * dy; if (d2 >= r * r) return 0;
        const d = Math.sqrt(d2); C.nx = d ? dx / d : -1; C.ny = d ? dy / d : 0; return r - d;
      }
      return kb === 1 ? C._circleBox(a, b) : C._circlePoly(a, C._b, C._verts(b, C._b));
    }
    if (kb === 0) { const d = ka === 1 ? C._circleBox(b, a) : C._circlePoly(b, C._a, C._verts(a, C._a)); if (d) { C.nx = 0 - C.nx; C.ny = 0 - C.ny; } return d; }
    if (ka === 1 && kb === 1) {
      const l = a.x + a.w - b.x, r = b.x + b.w - a.x, t = a.y + a.h - b.y, u = b.y + b.h - a.y;
      if (l <= 0 || r <= 0 || t <= 0 || u <= 0) return 0;
      const ox = l < r ? l : r, oy = t < u ? t : u;
      if (ox < oy) { C.nx = l < r ? -1 : 1; C.ny = 0; return ox; }
      C.nx = 0; C.ny = t < u ? -1 : 1; return oy;
    }
    return C._polys(C._a, C._verts(a, C._a), C._b, C._verts(b, C._b), tol);
  },
  // a moves by (dx, dy) while b stays put: the share of the move (0..1) at which a first touches b, or -1 if it never does.
  // The point of contact is a's position plus (dx, dy) * t, and Collide.nx / ny is b's surface normal there. For two moving
  // things pass their relative movement. If they already overlap: 0 when the move goes deeper, -1 when it leads out.
  sweep(a, dx, dy, b){ const C = Collide; if (C.overlap(a, b)) return dx * C.nx + dy * C.ny < 0 ? 0 : -1; return C._sweep(a, dx, dy, b); },
  // Ray from (ox, oy) along unit (dx, dy) against any shape: distance to the first hit, or -1. Starting inside gives 0
  // with no normal (nx = ny = 0).
  ray(ox, oy, dx, dy, s){
    const C = Collide;
    if (s.r !== undefined) {
      const t = C.rayCircle(ox, oy, dx, dy, s.x, s.y, s.r);
      if (t > 0) { C.nx = (ox + dx * t - s.x) / s.r; C.ny = (oy + dy * t - s.y) / s.r; } else if (t === 0) C.nx = C.ny = 0;
      return t;
    }
    if (!s.pts) return C.rayBox(ox, oy, dx, dy, s);
    const V = C._b, n = C._verts(s, V); let t0 = 0, t1 = Infinity, bx = 0, by = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const x1 = V[j * 2], y1 = V[j * 2 + 1], ex = V[i * 2] - x1, ey = V[i * 2 + 1] - y1, l = Math.hypot(ex, ey); if (!l) continue;
      const ux = ey / l, uy = -ex / l, den = dx * ux + dy * uy, off = (x1 - ox) * ux + (y1 - oy) * uy;
      if (!den) { if (off < 0) return -1; continue; }
      const t = off / den;
      if (den < 0) { if (t > t0) { t0 = t; bx = ux; by = uy; } } else if (t < t1) t1 = t;
      if (t0 > t1) return -1;
    }
    C.nx = bx + 0; C.ny = by + 0;
    return t0;
  },
  // A whole collision between two shapes that have a velocity (vx, vy) and maybe a mass: push them apart, split by mass,
  // and exchange momentum along the normal. bounce 0 = they stop against each other, 1 = perfectly elastic; friction
  // slows the slide along the surface. Returns the overlap there was (0 = no contact), with the normal in Collide.nx / ny.
  resolve(a, b, bounce = 0, friction = 0){
    const C = Collide, d = C.overlap(a, b); if (!d) return 0;
    const ia = C.invMass(a), ib = C.invMass(b), k = ia + ib; if (!k) return d;
    const nx = C.nx, ny = C.ny, avx = a.vx || 0, avy = a.vy || 0, bvx = b.vx || 0, bvy = b.vy || 0;
    a.x += nx * d * ia / k; a.y += ny * d * ia / k; b.x -= nx * d * ib / k; b.y -= ny * d * ib / k;
    const rx = avx - bvx, ry = avy - bvy, vn = rx * nx + ry * ny;
    if (vn < 0) {
      const j = -(1 + bounce) * vn / k, f = clamp((rx * ny - ry * nx) / k, -friction * j, friction * j), px = nx * j - ny * f, py = ny * j + nx * f;
      if (ia) { a.vx = avx + px * ia; a.vy = avy + py * ia; }
      if (ib) { b.vx = bvx - px * ib; b.vy = bvy - py * ib; }
    }
    return d;
  },
  // ---- the workings of the above. Polygons are copied into _a / _b in world space, wound so (ey, -ex) points outwards.
  _a: [], _b: [], _e: { x: 0, y: 0, w: 0, h: 0 },
  _verts(s, out){
    const x = s.x, y = s.y, p = s.pts;
    if (!p) { const X = x + s.w, Y = y + s.h; out[0] = x; out[1] = y; out[2] = X; out[3] = y; out[4] = X; out[5] = Y; out[6] = x; out[7] = Y; return 4; }
    const n = p.length >> 1; let area = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) area += p[j * 2] * p[i * 2 + 1] - p[i * 2] * p[j * 2 + 1];
    if (area >= 0) for (let i = 0; i < n * 2; i += 2) { out[i] = p[i] + x; out[i + 1] = p[i + 1] + y; }
    else for (let i = 0, j = n * 2 - 2; i < n * 2; i += 2, j -= 2) { out[i] = p[j] + x; out[i + 1] = p[j + 1] + y; }
    return n;
  },
  _circleBox(c, b){
    const C = Collide, qx = clamp(c.x, b.x, b.x + b.w), qy = clamp(c.y, b.y, b.y + b.h), dx = c.x - qx, dy = c.y - qy, d2 = dx * dx + dy * dy;
    if (d2 > 0) { if (d2 >= c.r * c.r) return 0; const d = Math.sqrt(d2); C.nx = dx / d; C.ny = dy / d; return c.r - d; }
    const l = c.x - b.x, r = b.x + b.w - c.x, t = c.y - b.y, u = b.y + b.h - c.y, m = Math.min(l, r, t, u);   // the centre is inside
    C.nx = m === l ? -1 : m === r ? 1 : 0; C.ny = C.nx ? 0 : m === t ? -1 : 1;
    return m + c.r;
  },
  _circlePoly(c, V, n){
    const C = Collide, r = c.r; let best = -Infinity, bx = 0, by = 0, near = Infinity, qx = 0, qy = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const x1 = V[j * 2], y1 = V[j * 2 + 1], ex = V[i * 2] - x1, ey = V[i * 2 + 1] - y1, l2 = ex * ex + ey * ey; if (!l2) continue;   // a repeated point
      const l = Math.sqrt(l2), ux = ey / l, uy = -ex / l, s = (c.x - x1) * ux + (c.y - y1) * uy; if (s >= r && s > 0) return 0;
      if (s > best) { best = s; bx = ux; by = uy; }
      const u = clamp(((c.x - x1) * ex + (c.y - y1) * ey) / l2, 0, 1), px = x1 + ex * u, py = y1 + ey * u, d2 = dist2(c.x, c.y, px, py);
      if (d2 < near) { near = d2; qx = px; qy = py; }
    }
    if (best > 0) {   // the centre is outside: it touches the nearest point of the outline, an edge or a corner
      if (near >= r * r) return 0;
      const d = Math.sqrt(near); if (d) { C.nx = (c.x - qx) / d; C.ny = (c.y - qy) / d; return r - d; }
    }
    if (best === -Infinity) return 0;
    C.nx = bx + 0; C.ny = by + 0;
    return r - best;
  },
  // Separating axes: the edge normals of both polygons. The smallest overlap is the way out. With a tolerance, an axis
  // they overlap on by no more than that is preferred, the deepest such: Physics uses this for things resting across a
  // seam between two tiles, which overlap the next tile's side by a hair and its top by the depth things rest at.
  _polys(A, na, B, nb, tol = 0){
    const C = Collide; let best = Infinity, bx = 0, by = 0, sh = 0, sx = 0, sy = 0;
    for (let pass = 0; pass < 2; pass++) {
      const V = pass ? B : A, n = pass ? nb : na;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ex = V[i * 2] - V[j * 2], ey = V[i * 2 + 1] - V[j * 2 + 1], l = Math.hypot(ex, ey); if (!l) continue;   // a repeated point
        const ux = ey / l, uy = -ex / l;
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        for (let k = 0; k < na * 2; k += 2) { const p = A[k] * ux + A[k + 1] * uy; if (p < a0) a0 = p; if (p > a1) a1 = p; }
        for (let k = 0; k < nb * 2; k += 2) { const p = B[k] * ux + B[k + 1] * uy; if (p < b0) b0 = p; if (p > b1) b1 = p; }
        const lo = a1 - b0, hi = b1 - a0, o = lo < hi ? lo : hi, s = lo < hi ? -1 : 1; if (o <= 0) return 0;
        if (o < best) { best = o; bx = ux * s; by = uy * s; }
        if (o <= tol && o > sh) { sh = o; sx = ux * s; sy = uy * s; }
      }
    }
    if (best === Infinity) return 0;
    if (sh) { C.nx = sx + 0; C.ny = sy + 0; return sh; }
    C.nx = bx + 0; C.ny = by + 0;
    return best;
  },
  // sweep() for shapes known to be apart (touching counts as a hit at 0 when the move presses them together).
  _sweep(a, dx, dy, b, tol = 0){
    const C = Collide, ka = a.r !== undefined ? 0 : a.pts ? 2 : 1, kb = b.r !== undefined ? 0 : b.pts ? 2 : 1;
    if (!dx && !dy) return -1;
    if (ka === 0) return kb === 0 ? C._sweepPt(a.x - b.x, a.y - b.y, dx, dy, a.r + b.r) : kb === 1 ? C._sweepCB(a, dx, dy, b) : C._sweepCP(a, dx, dy, C._b, C._verts(b, C._b));
    if (kb === 0) { const t = ka === 1 ? C._sweepCB(b, -dx, -dy, a) : C._sweepCP(b, -dx, -dy, C._a, C._verts(a, C._a)); if (t >= 0) { C.nx = 0 - C.nx; C.ny = 0 - C.ny; } return t; }
    if (ka === 1 && kb === 1) {   // a box against a box is a point against a bigger box
      const E = C._e; E.x = b.x - a.w; E.y = b.y - a.h; E.w = b.w + a.w; E.h = b.h + a.h;
      const t = C.rayBox(a.x, a.y, dx, dy, E);
      return t < 0 || t > 1 ? -1 : t === 0 && !C.nx && !C.ny ? C._face(a.x, a.y, dx, dy, E) : t;
    }
    return C._sweepPP(C._a, C._verts(a, C._a), dx, dy, C._b, C._verts(b, C._b), tol);
  },
  // A point at (fx, fy) from the centre of a circle of radius R moves by (dx, dy).
  _sweepPt(fx, fy, dx, dy, R){
    const C = Collide, A = dx * dx + dy * dy, B = fx * dx + fy * dy, c = fx * fx + fy * fy - R * R;
    if (B >= 0 || !A) return -1;   // moving away
    let t = 0;
    if (c > 0) { const disc = B * B - A * c; if (disc < 0) return -1; t = (-B - Math.sqrt(disc)) / A; if (t > 1) return -1; if (t < 0) t = 0; }
    const hx = fx + dx * t, hy = fy + dy * t, l = Math.hypot(hx, hy);
    if (l) { C.nx = hx / l; C.ny = hy / l; } else { const m = Math.sqrt(A); C.nx = -dx / m; C.ny = -dy / m; }
    return t;
  },
  // A point on the edge of box E (or a hair inside it): the face it is on, if the move goes into it.
  _face(px, py, dx, dy, E){
    const C = Collide, l = px - E.x, r = E.x + E.w - px, t = py - E.y, u = E.y + E.h - py, m = Math.min(l, r, t, u);
    C.nx = m === l ? -1 : m === r ? 1 : 0; C.ny = C.nx ? 0 : m === t ? -1 : 1;
    return dx * C.nx + dy * C.ny < 0 ? 0 : -1;
  },
  // A circle against a box is a point against the box grown by r, with rounded corners.
  _sweepCB(c, dx, dy, b){
    const C = Collide, r = c.r, E = C._e; E.x = b.x - r; E.y = b.y - r; E.w = b.w + r * 2; E.h = b.h + r * 2;
    const t = C.rayBox(c.x, c.y, dx, dy, E); if (t < 0 || t > 1) return -1;
    const hx = c.x + dx * t, hy = c.y + dy * t, kx = hx < b.x ? b.x : hx > b.x + b.w ? b.x + b.w : hx, ky = hy < b.y ? b.y : hy > b.y + b.h ? b.y + b.h : hy;
    if (kx !== hx && ky !== hy) return C._sweepPt(c.x - kx, c.y - ky, dx, dy, r);
    return t === 0 && !C.nx && !C.ny ? C._face(c.x, c.y, dx, dy, E) : t;
  },
  // A circle against a polygon: each edge moved out by r, and a circle of r round each corner.
  _sweepCP(c, dx, dy, V, n){
    const C = Collide, r = c.r; let best = -1, bx = 0, by = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const x1 = V[j * 2], y1 = V[j * 2 + 1], ex = V[i * 2] - x1, ey = V[i * 2 + 1] - y1, l = Math.hypot(ex, ey), ux = l ? ey / l : 0, uy = l ? -ex / l : 0, dn = dx * ux + dy * uy;
      if (dn < 0) {
        const s = (c.x - x1) * ux + (c.y - y1) * uy - r;
        if (s > -1e-6) {
          const t = s > 0 ? -s / dn : 0, u = ((c.x + dx * t - x1) * ex + (c.y + dy * t - y1) * ey) / (l * l);
          if (t <= 1 && (best < 0 || t < best) && u >= 0 && u <= 1) { best = t; bx = ux; by = uy; }
        }
      }
      const t = C._sweepPt(c.x - x1, c.y - y1, dx, dy, r);
      if (t >= 0 && (best < 0 || t < best)) { best = t; bx = C.nx; by = C.ny; }
    }
    C.nx = bx + 0; C.ny = by + 0;
    return best;
  },
  // Two convex polygons: on each axis find when their shadows start and stop overlapping. They touch when the last
  // axis starts, provided no axis has stopped by then. With a tolerance (Physics again), a hit is let go when on some
  // other axis the two are level to within it: that is something on one tile meeting the side of the next.
  _sweepPP(A, na, dx, dy, B, nb, tol = 0){
    const C = Collide; let t0 = -Infinity, t1 = Infinity, bx = 0, by = 0, seams = 0, sx = 0, sy = 0;
    for (let pass = 0; pass < 2; pass++) {
      const V = pass ? B : A, n = pass ? nb : na;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ex = V[i * 2] - V[j * 2], ey = V[i * 2 + 1] - V[j * 2 + 1], l = Math.hypot(ex, ey); if (!l) continue;   // a repeated point
        const ux = ey / l, uy = -ex / l, v = dx * ux + dy * uy;
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        for (let k = 0; k < na * 2; k += 2) { const p = A[k] * ux + A[k + 1] * uy; if (p < a0) a0 = p; if (p > a1) a1 = p; }
        for (let k = 0; k < nb * 2; k += 2) { const p = B[k] * ux + B[k + 1] * uy; if (p < b0) b0 = p; if (p > b1) b1 = p; }
        if (tol && Math.abs(Math.min(a1 - b0, b1 - a0)) <= tol) {   // remember up to two such axes that differ
          if (!seams) { seams = 1; sx = ux; sy = uy; } else if (Math.abs(sx * ux + sy * uy) < 0.999) seams = 2;
        }
        if (Math.abs(v) < 1e-12) { if (a1 <= b0 || b1 <= a0) return -1; continue; }
        const en = (v > 0 ? b0 - a1 : b1 - a0) / v, lv = (v > 0 ? b1 - a0 : b0 - a1) / v;
        if (en > t0) { t0 = en; bx = v > 0 ? -ux : ux; by = v > 0 ? -uy : uy; }
        if (lv < t1) t1 = lv;
        if (t0 > t1 || t0 > 1 || t1 <= 0) return -1;
      }
    }
    if (t0 === -Infinity || seams === 2 || (seams && Math.abs(sx * bx + sy * by) < 0.999)) return -1;
    C.nx = bx + 0; C.ny = by + 0;
    return t0 < 0 ? 0 : t0;
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


/* ---- src/physics.js ---- */
/* ================================================================
   PHYSICS: a world of circles, boxes and convex polygons that fall, collide, stack, slide and bounce, and never pass
   through a wall however fast they go. Nothing rotates, which is what most 2D games want.
     const world = new Physics({ gravity: 900 });                // y points down; 0 (the default) for a top-down game
     const ball = world.add({ x: 100, y: 0, r: 12, bounce: 0.6 });
     world.add({ x: 0, y: 400, w: 800, h: 40, fixed: true });    // a floor
     world.step(dt);                                             // once per update; then draw your things where they are

   A body is your own plain object in one of the Collide shapes: { x, y, r }, { x, y, w, h } (x, y the top-left corner)
   or { x, y, pts } (a convex polygon). add() gives it vx, vy and touch if it lacks them and returns it. The world reads
   these from it on every step, so change them whenever you like:
     vx, vy         velocity. Set it to move a thing; the world changes it when things collide
     mass           1 if left out. Heavy things shove light ones. Infinity is the same as fixed
     fixed          true = never pushed and no gravity: walls, floors. Give a fixed body a velocity and it is a moving
                    platform that carries what stands on it
     bounce         0 = lands dead (the default), 1 = loses nothing. The bouncier of the two bodies decides
     friction       grip along a surface, 0 = ice. world.friction (0.3) if left out. Give a player 0 or they cling to walls
     drag           the share of speed lost per second to air, roughly (0 = none)
     gravityScale   1 if left out; 0 floats
     sensor         true = touches are reported but nothing is pushed: pickups, bullets, trigger areas
     layer, mask    bit masks. Two bodies meet only if each one's layer is in the other's mask. layer 1, mask all if left out.
                    layer 0 meets nothing
     oneWay         on a fixed box: things land on its top but pass through from below and from the sides
     dead           true = taken out at the next step (as SpatialHash treats it). To bring one back, clear dead and add() it again
   and after each step it tells you:
     touch          the sides being pressed on, as in Collide.clampToBox: 1 left, 2 right, 4 top, 8 bottom.
                    if (player.touch & 8 && Input.hit('jump')) player.vy = -500;
     onHit(other, nx, ny, speed)   if you give a body this function: called once when it starts touching another.
                    nx, ny points from the other body to this one; speed is how fast they closed
     onLeave(other)                called when they part
   world.onBegin(a, b, nx, ny, speed) and world.onEnd(a, b) hear about every pair. All of these are called at the end
   of step(), so they may add and remove bodies. world.filter(a, b) returning false stops a pair meeting at all.

     world.raycast(ox, oy, dx, dy, max, filter)   the first body along a unit direction, or null. world.dist is how far,
                                                  Collide.nx / ny the surface normal
     world.query(shape, out)       every body that overlaps a shape, e.g. { x, y, r } for a blast
     world.walls(box)              four fixed boxes around the outside of an area
     world.remove(body), world.clear(), world.bodies, world.draw(ctx) to see the shapes while you build

   HOW IT WORKS, as far as it matters to a game. Each step finds the pairs that could meet (a grid, so thousands of
   bodies are fine), then for each pair asks Collide whether they overlap or will touch during the step (a swept test,
   so a bullet can't skip over a thin wall or a small enemy). Contacts are solved together several times
   (world.iterations), which is what lets stacks rest. A body knocked onto a new course in the middle of a step is
   checked again against fixed bodies, so nothing leaves a level; against other moving bodies it is checked at the
   next step, and pushed back out if it has ended up inside one. Two fixed bodies never collide. A floor built from
   tiles is smooth: seams between boxes don't catch. For a simulation that plays back the same every time, call step()
   with a fixed dt (Loop's `step`). Sensors feel gravity like anything else: give a bullet gravityScale 0.
   ================================================================ */
class Physics {
  constructor(opts = {}){
    this.gravity = 0; this.gravityX = 0;
    this.iterations = 8;     // solver passes per step: more = stiffer stacks
    this.substeps = 1;       // split each step() into this many smaller ones: more = more exact, at that many times the cost
    this.cell = 64;          // grid cell size: about the size of a typical body
    this.slop = 0.2;         // how far resting bodies may sink into each other (world units); stops jitter
    this.friction = 0.3;     // for bodies with no friction of their own
    this.bounceMin = 30;     // slower impacts than this don't bounce, so things come to rest
    this.onBegin = this.onEnd = this.filter = null;
    Object.assign(this, opts);
    this.bodies = []; this.buf = []; this.dist = -1; this.contacts = 0;
    this._cells = new Map(); this._used = []; this._ux = []; this._uy = [];
    this._pairs = new Map(); this._live = []; this._free = []; this._con = []; this._ev = []; this._begun = []; this._fixed = []; this._tf = null;
    this._stamp = 0; this._id = 1; this._nc = 0; this._sx = 0; this._sy = 0;
  }
  add(o){
    if (o._pid && o._in === this) return o;
    o.vx = o.vx || 0; o.vy = o.vy || 0; o.touch = 0; o._pid = this._id++; o._in = this; o._im = 0; o._x0 = o._y0 = o._x1 = o._y1 = o._mx = o._my = 0;
    this.bodies.push(o);
    return o;
  }
  remove(o){ const B = this.bodies, i = B.indexOf(o); if (i >= 0) { B[i] = B[B.length - 1]; B.pop(); o._pid = 0; } }
  clear(){
    for (const b of this.bodies) b._pid = 0;
    for (const c of this._live) { c.a = c.b = null; this._free.push(c); }
    this.bodies.length = this._live.length = this._ev.length = this.contacts = 0; this._pairs.clear();
  }
  walls(b, t = 200, opts = null){
    const m = (x, y, w, h) => this.add(Object.assign({ x, y, w, h, fixed: true }, opts));
    return [m(b.x - t, b.y - t, t, b.h + t * 2), m(b.x + b.w, b.y - t, t, b.h + t * 2), m(b.x - t, b.y - t, b.w + t * 2, t), m(b.x - t, b.y + b.h, b.w + t * 2, t)];
  }
  step(dt){
    if (!(dt > 0)) return;
    const B = this.bodies, ev = this._ev;
    for (let i = B.length - 1; i >= 0; i--) { const b = B[i]; if (b.dead === true) { B[i] = B[B.length - 1]; B.pop(); b._pid = 0; } else b.touch = 0; }
    if (this._id > 6e7) this._renumber();
    const n = Math.max(1, this.substeps | 0);
    for (let i = 0; i < n; i++) this._sub(dt / n);
    try {
      for (let i = 0; i < ev.length; i += 6) {
        const a = ev[i + 1], b = ev[i + 2];
        if (ev[i]) {
          const nx = ev[i + 3], ny = ev[i + 4], sp = ev[i + 5];
          if (this.onBegin) this.onBegin(a, b, nx, ny, sp);
          if (a.onHit) a.onHit(b, nx, ny, sp);
          if (b.onHit) b.onHit(a, 0 - nx, 0 - ny, sp);
        } else {
          if (this.onEnd) this.onEnd(a, b);
          if (a.onLeave) a.onLeave(b);
          if (b.onLeave) b.onLeave(a);
        }
      }
    } finally { ev.length = 0; }
  }
  raycast(ox, oy, dx, dy, max = Infinity, filter = null){
    const C = Collide, B = this.bodies; let best = null, bt = max, bx = 0, by = 0;
    for (let i = 0; i < B.length; i++) {
      const b = B[i]; if (b.dead === true) continue;
      const t = C.ray(ox, oy, dx, dy, b), nx = C.nx, ny = C.ny;
      if (t >= 0 && t < bt && (!filter || filter(b))) { best = b; bt = t; bx = nx; by = ny; }
    }
    C.nx = bx; C.ny = by; this.dist = best ? bt : -1;
    return best;
  }
  query(s, out = this.buf){
    const B = this.bodies; out.length = 0;
    for (let i = 0; i < B.length; i++) { const b = B[i]; if (b !== s && b.dead !== true && Collide.overlap(s, b)) out.push(b); }
    return out;
  }
  draw(c, color = '#4f8'){
    c.save(); c.strokeStyle = color; c.lineWidth = 1; c.beginPath();
    for (const b of this.bodies) {
      if (b.r !== undefined) { c.moveTo(b.x + b.r, b.y); c.arc(b.x, b.y, b.r, 0, TAU); }
      else if (b.pts) { for (let i = 0; i < b.pts.length; i += 2) c[i ? 'lineTo' : 'moveTo'](b.x + b.pts[i], b.y + b.pts[i + 1]); c.closePath(); }
      else c.rect(b.x, b.y, b.w, b.h);
    }
    c.stroke(); c.restore();
  }

  // ---- one step
  _sub(h){
    const C = Collide, B = this.bodies, inv = 1 / this.cell, gx = this.gravityX * h, gy = this.gravity * h, pad = this.slop * 2, stamp = ++this._stamp;
    const used = this._used, ux = this._ux, uy = this._uy, con = this._con, live = this._live, ev = this._ev, fixed = this._fixed, begun = this._begun;
    // 1. gravity and drag, then where each body could be during this step
    for (let i = 0; i < used.length; i++) used[i].length = 0;
    used.length = ux.length = uy.length = fixed.length = 0; if (this._cells.size > 8192) this._cells.clear();
    let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
    for (let i = 0; i < B.length; i++) {
      const b = B[i], im = b._im = C.invMass(b);
      if (im) {
        const g = b.gravityScale === undefined ? 1 : b.gravityScale; b.vx += gx * g; b.vy += gy * g;
        if (b.drag) { const k = Math.exp(-b.drag * h); b.vx *= k; b.vy *= k; }
      }
      let x0, y0, x1, y1;
      if (b.r !== undefined) { x0 = b.x - b.r; y0 = b.y - b.r; x1 = b.x + b.r; y1 = b.y + b.r; }
      else if (b.pts) { const p = b.pts; x0 = y0 = Infinity; x1 = y1 = -Infinity; for (let k = 0; k < p.length; k += 2) { const x = p[k] + b.x, y = p[k + 1] + b.y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      else { x0 = b.x; y0 = b.y; x1 = b.x + b.w; y1 = b.y + b.h; }
      const mx = b._mx = b.vx * h, my = b._my = b.vy * h;
      b._x0 = (mx < 0 ? x0 + mx : x0) - pad; b._x1 = (mx > 0 ? x1 + mx : x1) + pad; b._y0 = (my < 0 ? y0 + my : y0) - pad; b._y1 = (my > 0 ? y1 + my : y1) + pad;
      if (im) {   // things that can be pushed go in the grid first; fixed things only matter where those are
        const sx = Math.floor(b._x0 * inv), sy = Math.floor(b._y0 * inv), ex = Math.floor(b._x1 * inv), ey = Math.floor(b._y1 * inv);
        if (!((ex - sx + 1) * (ey - sy + 1) <= 16384)) continue;   // a broken position or speed (NaN, Infinity): leave it out
        if (sx < gx0) gx0 = sx; if (sy < gy0) gy0 = sy; if (ex > gx1) gx1 = ex; if (ey > gy1) gy1 = ey;
        this._file(b, sx, sy, ex, ey);
      }
    }
    for (let i = 0; i < B.length; i++) {
      const b = B[i]; if (b._im) continue;
      fixed.push(b);
      const sx = Math.max(gx0, Math.floor(b._x0 * inv)), sy = Math.max(gy0, Math.floor(b._y0 * inv)), ex = Math.min(gx1, Math.floor(b._x1 * inv)), ey = Math.min(gy1, Math.floor(b._y1 * inv));
      if (sx <= ex && sy <= ey) this._file(b, sx, sy, ex, ey);
    }
    // 2. pairs that share a cell. A pair that shares several is taken in the one that holds the corner of their overlap
    this._nc = 0;
    for (let u = 0; u < used.length; u++) {
      const a = used[u], cx = ux[u], cy = uy[u];
      for (let i = 0; i < a.length; i++) {
        const p = a[i];
        for (let j = i + 1; j < a.length; j++) {
          const q = a[j];
          if ((!p._im && !q._im) || p._x0 >= q._x1 || q._x0 >= p._x1 || p._y0 >= q._y1 || q._y0 >= p._y1) continue;
          if (Math.floor((p._x0 > q._x0 ? p._x0 : q._x0) * inv) !== cx || Math.floor((p._y0 > q._y0 ? p._y0 : q._y0) * inv) !== cy) continue;
          if (!((p.layer === undefined ? 1 : p.layer) & (q.mask === undefined ? -1 : q.mask)) || !((q.layer === undefined ? 1 : q.layer) & (p.mask === undefined ? -1 : p.mask))) continue;
          if (this.filter && !this.filter(p, q)) continue;
          if (p._pid < q._pid) this._narrow(p, q, h, stamp); else this._narrow(q, p, h, stamp);
        }
      }
    }
    const nc = this.contacts = this._nc;
    // 3. solve the contacts together: start from last step's answer, then refine
    for (let i = 0; i < nc; i++) {
      const c = con[i]; if (!c.jn && !c.jt) continue;
      const a = c.a, b = c.b, px = c.nx * c.jn - c.ny * c.jt, py = c.ny * c.jn + c.nx * c.jt;
      a.vx += px * a._im; a.vy += py * a._im; b.vx -= px * b._im; b.vy -= py * b._im;
    }
    for (let it = 0, ch = 1; it < this.iterations && ch > 1e-12; it++) {
      ch = 0;   // how much this pass changed anything: a pile at rest is done after one
      for (let i = 0; i < nc; i++) {
        const c = con[i], a = c.a, b = c.b, nx = c.nx, ny = c.ny, ia = a._im, ib = b._im;
        const jn = Math.max(0, c.jn + (c.bias - ((a.vx - b.vx) * nx + (a.vy - b.vy) * ny)) * c.k), j = jn - c.jn; c.jn = jn;
        if (j) { a.vx += nx * j * ia; a.vy += ny * j * ia; b.vx -= nx * j * ib; b.vy -= ny * j * ib; ch += j * j * c.k * c.k; }
        if (c.mu || c.jt) {
          const max = c.mu * jn, jt = clamp(c.jt + ((a.vx - b.vx) * ny - (a.vy - b.vy) * nx) * c.k, -max, max), f = jt - c.jt; c.jt = jt;
          if (f) { a.vx -= ny * f * ia; a.vy += nx * f * ia; b.vx += ny * f * ib; b.vy -= nx * f * ib; ch += f * f * c.k * c.k; }
        }
      }
    }
    // 4. move. A body the contacts have sent somewhere it was not heading is checked once more against the fixed
    // bodies on its new path, and stops where it would go through one (keeping its speed for the next step)
    for (let i = 0; i < B.length; i++) {
      const b = B[i]; if (!b._im) continue;
      let mx = b.vx * h, my = b.vy * h;
      if ((mx !== b._mx || my !== b._my) && mx * mx + my * my > pad * pad && !b.sensor) {
        const t = this._toi(b, mx, my, h);
        if (t < 1) { const f = this._tf; mx = mx * t + f.vx * h * (1 - t); my = my * t + f.vy * h * (1 - t); }
      }
      b.x += mx; b.y += my;
    }
    for (let i = 0; i < fixed.length; i++) { const b = fixed[i]; b.x += b.vx * h; b.y += b.vy * h; }
    // 5. ease apart whatever still overlaps (positions only, so no energy is added)
    const slop = this.slop;
    for (let it = 0; it < 3; it++) for (let i = 0; i < nc; i++) {
      const c = con[i]; if (!c.d && !c.jn) continue;
      const a = c.a, b = c.b, d = C.overlap(a, b); if (d <= slop) continue;
      const nx = C.nx, ny = C.ny; if (nx * c.nx + ny * c.ny < 0.7) continue;   // not the contact that was solved: next step's business
      const m = (d - slop) * 0.8 * c.k;
      a.x += nx * m * a._im; a.y += ny * m * a._im; b.x -= nx * m * b._im; b.y -= ny * m * b._im;
    }
    // 6. bounce: contacts that stopped something arriving fast send it back out. Solved together like step 3, because
    // one ball can be in two collisions at once
    const lim = Math.max(this.bounceMin, Math.hypot(gx, gy) * 2); let any = false;
    for (let i = 0; i < nc; i++) { const c = con[i]; c.out = c.jn > 0 ? c.e && c.vn0 < -lim ? -c.e * c.vn0 : 0 : -1; if (c.out > 0) any = true; }
    for (let it = 0, ch = 1; any && it < this.iterations && ch > 1e-12; it++) {
      ch = 0;
      for (let i = 0; i < nc; i++) {
        const c = con[i]; if (c.out < 0) continue;
        const a = c.a, b = c.b, nx = c.nx, ny = c.ny, jn = Math.max(0, c.jn + (c.out - ((a.vx - b.vx) * nx + (a.vy - b.vy) * ny)) * c.k), j = jn - c.jn; c.jn = jn;
        if (j) { a.vx += nx * j * a._im; a.vy += ny * j * a._im; b.vx -= nx * j * b._im; b.vy -= ny * j * b._im; ch += j * j * c.k * c.k; }
      }
    }
    // 7. who touches whom now: touch flags, begin and end events, and forget pairs that have parted
    for (let i = live.length - 1; i >= 0; i--) {
      const c = live[i], a = c.a, b = c.b, now = c.stamp === stamp && (c.sensor || c.d > 0 || c.jn > 0);
      if (now && !c.on) begun.push(1, a, b, c.nx, c.ny, c.vn0 < 0 ? -c.vn0 : 0); else if (!now && c.on) ev.push(0, a, b, 0, 0, 0);
      c.on = now;
      if (now && !c.sensor) {
        if (c.ny < -0.5) { a.touch |= 8; b.touch |= 4; } else if (c.ny > 0.5) { a.touch |= 4; b.touch |= 8; }
        if (c.nx > 0.5) { a.touch |= 1; b.touch |= 2; } else if (c.nx < -0.5) { a.touch |= 2; b.touch |= 1; }
      }
      if (c.stamp !== stamp) { this._pairs.delete(c.key); live[i] = live[live.length - 1]; live.pop(); c.a = c.b = null; this._free.push(c); }
    }
    for (let i = 0; i < begun.length; i++) ev.push(begun[i]);   // ends first: a body taken out and put back leaves, then arrives
    begun.length = 0;
  }
  _file(b, sx, sy, ex, ey){
    const cells = this._cells;
    for (let cx = sx; cx <= ex; cx++) for (let cy = sy; cy <= ey; cy++) {
      const k = (cx + 32768) * 65536 + (cy + 32768); let a = cells.get(k); if (!a) cells.set(k, a = []);
      if (!a.length) { this._used.push(a); this._ux.push(cx); this._uy.push(cy); }
      a.push(b);
    }
  }
  // One pair (a has the lower id): do they overlap, or will they touch within this step? If so, note the contact.
  _narrow(a, b, h, stamp){
    const C = Collide, sensor = !!(a.sensor || b.sensor), rvx = a.vx - b.vx, rvy = a.vy - b.vy;
    const tol = sensor ? 0 : this.slop * 2;   // for polygons the seam rule below is inside Collide
    let d = C.overlap(a, b, tol), t = 0;
    if (!d) { t = C._sweep(a, rvx * h, rvy * h, b, tol); if (t < 0) return; }
    let nx = C.nx, ny = C.ny;
    const key = a._pid * 67108864 + b._pid; let c = this._pairs.get(key);
    if (!sensor) {
      // Seams. Something resting on one box and meeting the side of its neighbour, by the hair that resting things
      // sink, has not hit a wall: it is on a floor made of two boxes. The face it barely overlaps is the one it is on.
      const ab = a.pts ? 0 : b.pts ? 0 : b.r === undefined ? 1 : a.r === undefined ? -1 : 0;
      if (ab) {
        const p = ab > 0 ? this._seam(a, b, d ? 2 : nx, ny) : this._seam(b, a, d ? 2 : -nx, -ny);
        if (p) { if (!d) return; d = p; nx = this._sx * ab + 0; ny = this._sy * ab + 0; }
      }
      // One-way platforms hold what comes down onto their top, and nothing else.
      if (a.oneWay || b.oneWay) {
        const up = b.oneWay ? ny : -ny, down = b.oneWay ? rvy : -rvy;
        if (!(up < -0.7 && ((c && c.on) || (down >= 0 && d <= this.slop * 4)))) return;
      }
    }
    if (!c) {
      c = this._free.pop() || { a: null, b: null, key: 0, ia: 0, ib: 0, nx: 0, ny: 0, d: 0, bias: 0, vn0: 0, jn: 0, jt: 0, k: 0, e: 0, mu: 0, out: 0, stamp: 0, on: false, sensor: false };
      c.a = a; c.b = b; c.key = key; c.ia = a._pid; c.ib = b._pid; c.jn = c.jt = 0; c.on = false; c.stamp = 0;
      this._pairs.set(key, c); this._live.push(c);
    }
    const vn = rvx * nx + rvy * ny;
    if (c.stamp !== stamp - 1 || c.nx * nx + c.ny * ny < 0.9 || sensor) c.jn = c.jt = 0;   // last step's answer only helps if the contact is the same
    c.nx = nx; c.ny = ny; c.d = d; c.vn0 = vn; c.bias = d ? 0 : Math.min(0, vn * t); c.stamp = stamp; c.sensor = sensor;
    if (sensor) return;
    c.k = 1 / (a._im + b._im); c.e = Math.max(a.bounce || 0, b.bounce || 0);
    const fa = a.friction === undefined ? this.friction : a.friction, fb = b.friction === undefined ? this.friction : b.friction; c.mu = Math.sqrt(fa * fb);
    this._con[this._nc++] = c;
  }
  // How much of its move (mx, my) body b can make before it runs into a fixed body: 1 = all of it. The one in the way
  // is left in _tf. Fixed bodies near where b was heading are in its grid cells; if it is leaving those, look at them all.
  _toi(b, mx, my, h){
    const inv = 1 / this.cell, r = b.r; let x0, y0, x1, y1, best = 1;
    if (r !== undefined) { x0 = b.x - r; y0 = b.y - r; x1 = b.x + r; y1 = b.y + r; }
    else if (b.pts) { x0 = b._x0; y0 = b._y0; x1 = b._x1; y1 = b._y1; }   // roughly: where it could have been
    else { x0 = b.x; y0 = b.y; x1 = b.x + b.w; y1 = b.y + b.h; }
    if (mx < 0) x0 += mx; else x1 += mx; if (my < 0) y0 += my; else y1 += my;
    if (x0 >= b._x0 && x1 <= b._x1 && y0 >= b._y0 && y1 <= b._y1) {
      for (let cx = Math.floor(x0 * inv), ex = Math.floor(x1 * inv); cx <= ex; cx++) for (let cy = Math.floor(y0 * inv), ey = Math.floor(y1 * inv); cy <= ey; cy++) {
        const a = this._cells.get((cx + 32768) * 65536 + (cy + 32768)); if (!a) continue;
        for (let i = 0; i < a.length; i++) if (!a[i]._im) best = this._toi1(b, a[i], mx, my, h, x0, y0, x1, y1, best);
      }
    } else for (let i = 0, F = this._fixed; i < F.length; i++) best = this._toi1(b, F[i], mx, my, h, x0, y0, x1, y1, best);
    return best;
  }
  _toi1(b, f, mx, my, h, x0, y0, x1, y1, best){
    const C = Collide;
    if (f._x0 >= x1 || f._x1 <= x0 || f._y0 >= y1 || f._y1 <= y0 || f.sensor || f.oneWay) return best;
    if (!((b.layer === undefined ? 1 : b.layer) & (f.mask === undefined ? -1 : f.mask)) || !((f.layer === undefined ? 1 : f.layer) & (b.mask === undefined ? -1 : b.mask)) || (this.filter && !this.filter(b, f))) return best;
    if (C.overlap(b, f)) return best;   // already in it: the contact deals with that
    const rx = mx - f.vx * h, ry = my - f.vy * h, t = C._sweep(b, rx, ry, f, this.slop * 2);
    if (t < 0 || t >= best || (rx * C.nx + ry * C.ny) * (t - 1) <= this.slop * 2) return best;   // a miss, or it ends no deeper than things rest
    if (!b.pts && !f.pts && f.r === undefined && this._seam(b, f, C.nx, C.ny)) return best;
    this._tf = f;
    return t;
  }
  // s (a circle or a box) against a box. For an overlap (ex = 2): of the box's four faces, the one s has sunk into
  // deepest without going deeper than a resting body does; returns that depth with the face's normal in _sx / _sy, or 0
  // if there is none. For a sweep that is about to hit the face with normal (ex, ey): returns 1 if s is level with any
  // other face, to within that same depth, which is what resting on the neighbouring box looks like.
  _seam(s, b, ex, ey){
    const tol = this.slop * 2, lo = ex === 2 ? Number.MIN_VALUE : -tol, r = s.r, x0 = s.x - (r === undefined ? 0 : r), y0 = s.y - (r === undefined ? 0 : r);
    const l = x0 + (r === undefined ? s.w : r * 2) - b.x, rt = b.x + b.w - x0, t = y0 + (r === undefined ? s.h : r * 2) - b.y, u = b.y + b.h - y0;
    let p = 0; this._sx = this._sy = 0;
    if (l >= lo && l <= tol && !(ex === -1 && !ey) && (l > p || lo < 0)) { p = l; this._sx = -1; this._sy = 0; if (lo < 0) return 1; }
    if (rt >= lo && rt <= tol && !(ex === 1 && !ey) && (rt > p || lo < 0)) { p = rt; this._sx = 1; this._sy = 0; if (lo < 0) return 1; }
    if (t >= lo && t <= tol && !(ey === -1 && !ex) && (t > p || lo < 0)) { p = t; this._sx = 0; this._sy = -1; if (lo < 0) return 1; }
    if (u >= lo && u <= tol && !(ey === 1 && !ex) && (u > p || lo < 0)) { p = u; this._sx = 0; this._sy = 1; if (lo < 0) return 1; }
    return p;
  }
  // Ids only ever grow, so a body that leaves and comes back is a stranger to the pairs it was in. Once in a very long
  // while, count again from 1.
  _renumber(){
    const live = this._live; this._pairs.clear();
    for (const c of live) if (c.a._pid !== c.ia || c.b._pid !== c.ib) c.key = -1;   // one of them has left: this pair ends at the next step
    let n = 1; for (const b of this.bodies) b._pid = n++; this._id = n;
    for (const c of live) {
      if (c.key < 0) continue;
      if (c.a._pid > c.b._pid) { const a = c.a; c.a = c.b; c.b = a; c.nx = -c.nx; c.ny = -c.ny; }
      c.ia = c.a._pid; c.ib = c.b._pid; c.key = c.ia * 67108864 + c.ib; this._pairs.set(c.key, c);
    }
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
     cam.follow(boss, 0.001, { blend: 0.6, ease, vel });   // blend: glide over to the new target in 0.6 s instead of cutting, tracking it on the way.
                                           // vel: read the lead's velocity from this { x, y } (an ECS Vel) instead of the target; it lasts until the next follow()
     cam.frame([p1, p2, boss], { padding: 80, minZoom: 0.25, maxZoom: 1, lag: 0.01 });   // keep several things in shot: centres on them and
                                           // zooms to fit (their r counts). The list is read every update, so add and remove freely. zoom: false only centres.
                                           // With bounds set it zooms out no farther than it takes to show the whole world
     cam.snap();                           // jump straight to where the camera is heading (after a teleport or a respawn). During a moveTo it finishes the move
   A measured lead reads any jump of the aim point as speed, so call snap() after a teleport or after changing who is in a framed group.

   Zoom and scripted moves
     cam.zoomTo(2, 0.4, Ease.outCubic);    // zoom over 0.4 s (0 = now); following carries on meanwhile
     cam.zoomAt(cam.zoom * 1.1, mx, my);   // zoom now, keeping the world point under a screen point where it is (mouse wheel, pinch)
     cam.moveTo(x, y, 1.2, { ease, zoom: 1.5, hold: true, onDone });   // glide to a point; following waits until it arrives,
     cam.moving;  cam.held;  cam.release();                            // or with hold: true, until release(). follow() and frame() also cancel a move
     cam.fit({ x0, y0, x1, y1 }, 1, { padding: 40, ease, hold, onDone });   // a moveTo that ends with the rect filling the view
     cam.setBounds(room, 0.5, ease);       // new bounds, sliding into them over 0.5 s instead of jumping (room to room)
     await cam.moveTo(x, y, 1).wait();     // wait() is a promise for the end of the first update with no move, zoom, blend or slide running
   Cancelling a move cancels its zoom too. A zoomTo or zoomAt replaces a zoom that is running, and the replaced one's onDone is not called.
   A blend or a bounds slide only changes how the view gets there: following, moves and bounds carry on underneath and the view glides
   from where it was to wherever they are. It runs out its time whatever else is called: snap() ends it early and a new blend or slide
   starts again from the view as it is. Meanwhile cam.x, y are the gliding view, and a value written to them lasts only until the next update.

   Shake
     cam.addTrauma(0.5);                   // trauma squared x shakeMax pixels, trauma falls by shakeDecay per second
     cam.kick(6);                          // a direct jolt in pixels that dies away exponentially (kickDecay per second)
     cam.kick(10, angle);                  // a push in one direction that settles back: recoil, a landing, a hit from the left
     cam.shakeRoll = 0.05;                 // trauma also rolls the view, up to this many radians
     cam.shakeFreq = 30;                   // smooth shake at about this many wobbles a second, the same at any frame rate (0 = a new offset every update)
     cam.shakeScale = 0.5;                 // scales every shake; set it from a "screen shake" or reduced-motion setting (0 = none)
   Shake takes its random numbers from Rng.fx, so it never shifts gameplay randomness.

   Drawing
     cam.apply(ctx, 0.5);                  // parallax: a layer that scrolls at half speed
     cam.layerView(0.5, rect);             // what that layer shows, in its own coordinates, for culling it (cam.view is for the main layer only)
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
    this.leadVel = null; this._bl = null; this._w = null;
    this._lx = 0; this._ly = 0; this._px = 0; this._py = 0; this._seen = false; this._kx = 0; this._ky = 0; this._n = [0, 0, 0, 0, 0, 0]; this._np = 1;
  }
  follow(t, lag = 0, o){
    this._stop(); this.target = t; this.lag = lag; this.group = this._fit = null; this._lead0(); this.leadVel = (o && o.vel) || null;
    if (t && o && o.blend > 0) { const f = this.offset; this._blend(o.blend, o.ease, t.x + (f ? f.x : 0), t.y + (f ? f.y : 0)); }
    else if (t && !lag) this._put(t.x, t.y);
    return this;
  }
  frame(list, o = {}){
    this._stop(); this.group = list; this.target = null; this.leadVel = null; this.lag = o.lag ?? 0.01; this._lead0();
    this._fit = o.zoom === false ? null : { pad: o.padding ?? 80, min: o.minZoom ?? 0.25, max: o.maxZoom ?? 1, lag: o.zoomLag ?? this.lag };
    return this;
  }
  snap(){
    const m = this._mv, bl = this._bl; if (bl) { this.x = bl.gx; this.y = bl.gy; this._bl = null; }   // a blend or a slide ends where it was going
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
    const b = this.toWorld(sx, sy, Camera._p), dx = wx - b.x, dy = wy - b.y, bl = this._bl; this.x += dx; this.y += dy;
    if (bl) { bl.x0 += dx; bl.y0 += dy; bl.gx += dx; bl.gy += dy; }   // both ends of a blend, so the view shifts by exactly this much
    return this;
  }
  moveTo(x, y, secs = 0.5, o = {}){
    const bl = this._bl;   // under a blend the move starts from where the camera really is, not from the gliding view
    this._mv = { x0: bl ? bl.gx : this.x, y0: bl ? bl.gy : this.y, x1: x, y1: y, t: 0, d: secs, ease: o.ease || Camera.smooth, hold: !!o.hold, onDone: o.onDone || null };
    if (o.zoom != null) { this.zoomTo(o.zoom, secs, this._mv.ease); this._mv.zt = this._zt; }
    return this;
  }
  fit(r, secs = 0.5, o = {}){
    const co = Math.abs(Math.cos(this.angle)), si = Math.abs(Math.sin(this.angle)), w = Math.abs(r.x1 - r.x0), h = Math.abs(r.y1 - r.y0), p = (o.padding || 0) * 2;
    const fw = w * co + h * si + p, fh = w * si + h * co + p, z = Math.min(fw > 0 ? vw / fw : Infinity, fh > 0 ? vh / fh : Infinity) / scale;
    return this.moveTo((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, secs, { ease: o.ease, hold: o.hold, onDone: o.onDone, zoom: z < Infinity ? z : null });
  }
  setBounds(b, secs = 0, ease){ this.bounds = b; if (secs > 0) this._blend(secs, ease); return this; }
  wait(){ return new Promise(ok => { (this._w || (this._w = [])).push(ok); }); }
  // A blend: the camera proper carries on unseen in gx, gy while x, y glide from where the view was to there.
  _blend(secs, ease, gx, gy){
    const bl = this._bl;
    this._bl = { x0: this.x, y0: this.y, gx: gx ?? (bl ? bl.gx : this.x), gy: gy ?? (bl ? bl.gy : this.y), t: 0, d: secs, ease: ease || Camera.smooth };
  }
  _put(x, y){ const bl = this._bl; if (bl) { bl.gx = x; bl.gy = y; } else { this.x = x; this.y = y; } }
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
      let z = clamp(Math.min(fw > 0 ? vw / fw : Infinity, fh > 0 ? vh / fh : Infinity) / scale, f.min, f.max);
      const b = this.bounds;   // no farther out than it takes to show the whole world, when maxZoom allows that
      if (b) z = Math.max(z, Math.min(f.max, Math.min((vw * co + vh * si) / (b.x1 - b.x0), (vw * si + vh * co) / (b.y1 - b.y0)) / scale));
      this._gz = z < Infinity ? z : this.zoom;   // a single point with no padding and no top limit: nothing to fit, so stay as it is
    }
    return true;
  }
  update(dt){
    const m = this._mv, zt = this._zt, bl = this._bl;
    if (bl) { this.x = bl.gx; this.y = bl.gy; }
    if (m) {
      m.t = m.d > 0 ? Math.min(1, m.t + dt / m.d) : 1; const e = m.ease(m.t);
      this.x = lerp(m.x0, m.x1, e); this.y = lerp(m.y0, m.y1, e);
      if (m.t >= 1) { this._mv = null; this.held = m.hold; this._lead0(); }
    } else if (!this.held && this._aim()) {
      let gx = this._gx, gy = this._gy;
      if (this.lead) {
        const t = this.target, lv = this.leadVel, own = lv || (t && typeof t.vx === 'number' && typeof t.vy === 'number');
        if (own || (dt > 0 && this._seen)) {
          let lx = (lv ? lv.x : own ? t.vx : (gx - this._px) / dt) * this.lead, ly = (lv ? lv.y : own ? t.vy : (gy - this._py) / dt) * this.lead; const l = Math.hypot(lx, ly);
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
    if (bl && this._bl === bl) {
      bl.gx = this.x; bl.gy = this.y; bl.t = Math.min(1, bl.t + dt / bl.d);
      if (bl.t >= 1) this._bl = null; else { const e = bl.ease(bl.t); this.x = lerp(bl.x0, bl.gx, e); this.y = lerp(bl.y0, bl.gy, e); }
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
    if (this._w && !this._mv && !this._zt && !this._bl) { const w = this._w; this._w = null; for (let i = 0; i < w.length; i++) w[i](); }
  }
  apply(c, parallax = 1){
    const k = this.k * dpr, a = -(this.angle + this.roll), co = Math.cos(a) * k, si = Math.sin(a) * k, x = this.x * parallax, y = this.y * parallax;
    let e = dpr * (vw / 2 + this.ox) - (co * x - si * y), f = dpr * (vh / 2 + this.oy) - (si * x + co * y);
    if (this.pixelSnap) { e = Math.round(e); f = Math.round(f); }
    c.setTransform(co, si, -si, co, e, f);
  }
  applyScreen(c){ c.setTransform(dpr, 0, 0, dpr, 0, 0); }
  layerView(parallax = 1, out = {}){
    const v = this.view, hw = (v.x1 - v.x0) / 2, hh = (v.y1 - v.y0) / 2, x = this.x * parallax, y = this.y * parallax;
    out.x0 = x - hw; out.y0 = y - hh; out.x1 = x + hw; out.y1 = y + hh; return out;
  }
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


/* ---- src/tilemap.js ---- */
/* ================================================================
   TILEMAP: a level as a grid of numbered tiles, in layers. It draws only what is on screen, collides, hands its
   walls to Physics, casts rays and finds paths. Tile 0 is empty.
     const map = Tilemap.from(['#######',
                               '#P...*#',
                               '#######'], 40, { '#': 1 });   // rows of characters, the tile size in world units, and which
                                                              // character is which tile. '.' and ' ' are empty; any other
                                                              // character leaves a mark: map.marks.P[0] is { x, y, cx, cy }
     const map = new Tilemap(cols, rows, 40);                 // or an empty one...
     const map = Tilemap.tiled(Assets.get('level1'));         // ...or a map saved from the Tiled editor as JSON
     map.get(cx, cy);  map.set(cx, cy, id);  map.at(x, y);    // by cell, or by world position. Outside the map is 0
     map.fill(cx, cy, w, h, id);  map.cx(x);  map.cy(y);  map.w;  map.h;  map.bounds   // bounds fits cam.bounds
     map.layer('back')                                        // get or add a layer; get, set, at, fill and draw take one last
                                                              // (a name or a number, default the first). layer.visible, layer.alpha

   WHAT A TILE IS. With nothing said, every tile but 0 is a solid block. map.def(id, { ... }) says otherwise:
     solid: false            walked through (decoration)
     oneWay: true            a platform: landed on from above, passed through otherwise. h: 0.25 makes it that share of a tile thick
     pts: [0, 1, 1, 0, 1, 1] a convex polygon in shares of a tile (this one is a slope up to the right), for Physics
     color: '#345'           what to fill it with when there is no sheet;  frame: 7  which sheet frame, if not id - 1
     frames: [4, 5, 6], fps: 6   an animated tile (call map.update(dt));  draw(c, x, y, size, cx, cy, id)   draw it yourself
     body: { bounce: 1 }     extra properties for its Physics body

   DRAWING
     map.sheet = Sprites.sheet(Assets.get('tiles'), 16, 16);  // tile id 1 is frame 0, as Tiled numbers them (map.firstId)
     map.draw(ctx, cam.view);                                 // every visible layer, only the tiles in view
     map.draw(ctx, cam.view, 'back');  ...actors...  map.draw(ctx, cam.view, 'front');
     map.paint = (c, id, x, y, size, cx, cy) => { ... };      // or draw every tile yourself
     map.prerender = 16;                                      // draw tiles once into big cached pictures, at this many pixels a tile,
                                                              // and stamp those: far fewer draw calls, and no hairlines between tiles.
                                                              // set() redraws what it touches; call map.redraw() after changing
                                                              // defs, the sheet or paint. Animated tiles stand still when prerendered

   COLLIDING, without Physics: move a box { x, y, w, h } or a circle { x, y, r } (as its square) and stop at the walls.
     const t = map.move(player, player.vx * dt, player.vy * dt);   // t: the sides that hit, 1 left, 2 right, 4 top, 8 bottom
     if (t & 3) player.vx = 0;  if (t & 12) player.vy = 0;  const onGround = t & 8;
   However far it moves it cannot skip a wall. map.move(o, dx, dy, true) falls through one-way platforms.
   map.blocked(x, y) is "is this point in a wall"; map.edge = true makes everything outside the map solid.

   WITH PHYSICS
     map.addTo(world, { friction: 0.5 });      // the walls as fixed bodies: solid tiles joined into as few boxes as will do,
                                               // one-way runs, and a polygon per `pts` tile. map.bodies is the list.
     map.addTo(world) again after changing tiles; map.removeFrom() takes them out.

   RAYS AND PATHS (tiles count as whole squares here, slopes included; one-way tiles do not block)
     map.raycast(ox, oy, dx, dy, max)          // distance along a unit direction to the first wall, or -1. map.hit is
                                               // { cx, cy, id } and Collide.nx / ny the wall's normal
     map.sees(ax, ay, bx, by)                  // true when no wall is between two points
     map.path(ax, ay, bx, by, { diagonal: true, max: 5000, cost(id, cx, cy) })   // the shortest way round the walls (A*): the
                                               // centre of each tile to pass through, [{ x, y }, ...], or null when there is none.
                                               // cost returns how many times dearer a tile is to cross (mud: 3), Infinity = never.
                                               // max caps the tiles looked at, so a far goal can't stall a frame
   ================================================================ */
class Tilemap {
  constructor(cols, rows, tile = 32, o = {}){
    this.cols = cols; this.rows = rows; this.tile = tile; this.x = o.x || 0; this.y = o.y || 0;
    this.layers = []; this.defs = []; this.marks = {}; this.objects = {};
    this.sheet = null; this.firstId = 1; this.paint = null; this.color = '#556'; this.prerender = 0; this.smooth = false; this.time = 0;
    this.collide = 0; this.edge = false; this.hit = { cx: 0, cy: 0, id: 0 }; this.dist = -1; this.bodies = []; this._world = null;
    this._d = { w: 0, h: 0, ox: 0, oy: 0 }; this._g = null; this._from = null; this._st = null; this._stamp = 0; this._heap = [];
    this.layer(o.layer || 'main');
  }
  get w(){ return this.cols * this.tile; }
  get h(){ return this.rows * this.tile; }
  get bounds(){ return { x0: this.x, y0: this.y, x1: this.x + this.w, y1: this.y + this.h }; }
  cx(x){ return Math.floor((x - this.x) / this.tile); }
  cy(y){ return Math.floor((y - this.y) / this.tile); }
  layer(name){
    let L = this.layers.find(l => l.name === name);
    if (!L) this.layers.push(L = { name, data: new Uint16Array(this.cols * this.rows), visible: true, alpha: 1, chunks: new Map() });
    return L;
  }
  _L(l){
    if (l === undefined) return this.layers[0];
    const L = typeof l === 'number' ? this.layers[l] : typeof l === 'string' ? this.layers.find(a => a.name === l) : l;
    if (!L) throw new Error(`Tilemap: unknown layer "${l}"`);
    return L;
  }
  get(cx, cy, l){ return cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows ? 0 : this._L(l).data[cy * this.cols + cx]; }
  at(x, y, l){ return this.get(this.cx(x), this.cy(y), l); }
  set(cx, cy, id, l){
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return this;
    const L = this._L(l); L.data[cy * this.cols + cx] = id;
    const ch = L.chunks.get((cy >> 4) * 4096 + (cx >> 4)); if (ch) ch.dirty = true;
    return this;
  }
  fill(cx, cy, w, h, id, l){ for (let j = cy; j < cy + h; j++) for (let i = cx; i < cx + w; i++) this.set(i, j, id, l); return this; }
  def(id, props){ if (props === undefined) return this.defs[id]; this.defs[id] = props; return this; }
  solid(id){ if (!id) return false; const d = this.defs[id]; return d ? d.solid !== undefined ? !!d.solid : !d.oneWay : true; }
  blocked(x, y){ return this._solid(this._L(this.collide).data, this.cx(x), this.cy(y)); }
  _solid(D, cx, cy){ return cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows ? this.edge : this.solid(D[cy * this.cols + cx]); }
  _one(D, cx, cy){ if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return false; const d = this.defs[D[cy * this.cols + cx]]; return !!d && !!d.oneWay; }
  update(dt){ this.time += dt; }
  redraw(){ for (const L of this.layers) L.chunks.clear(); return this; }

  // ---- drawing
  draw(c, view = null, l){
    if (l === undefined) { for (const L of this.layers) if (L.visible) this._draw(c, view, L); }
    else this._draw(c, view, this._L(l));
  }
  _draw(c, v, L){
    const T = this.tile, cols = this.cols; let c0 = 0, r0 = 0, c1 = cols - 1, r1 = this.rows - 1;
    if (v) { c0 = Math.max(c0, this.cx(v.x0)); r0 = Math.max(r0, this.cy(v.y0)); c1 = Math.min(c1, this.cx(v.x1)); r1 = Math.min(r1, this.cy(v.y1)); }
    if (c0 > c1 || r0 > r1) return;
    const pa = c.globalAlpha; if (L.alpha !== 1) c.globalAlpha = pa * L.alpha;
    if (this.prerender > 0) {
      const S = 16 * T;
      for (let j = r0 >> 4; j <= r1 >> 4; j++) for (let i = c0 >> 4; i <= c1 >> 4; i++) { const ch = this._chunk(L, i, j); if (ch.any) c.drawImage(ch.cv, this.x + i * S, this.y + j * S, S, S); }
    } else for (let j = r0; j <= r1; j++) for (let i = c0; i <= c1; i++) { const id = L.data[j * cols + i]; if (id) this.drawTile(c, id, this.x + i * T, this.y + j * T, T, i, j); }
    if (L.alpha !== 1) c.globalAlpha = pa;
  }
  drawTile(c, id, x, y, T, cx, cy){
    const d = this.defs[id];
    if (d && d.draw) d.draw(c, x, y, T, cx, cy, id);
    else if (this.paint) this.paint(c, id, x, y, T, cx, cy);
    else if (this.sheet && !(d && d.color)) {
      const o = this._d; o.w = o.h = T;
      this.sheet.draw(c, d && d.frames ? d.frames[Math.floor(this.time * (d.fps || 8)) % d.frames.length] : d && d.frame !== undefined ? d.frame : id - this.firstId, x, y, o);
    } else { c.fillStyle = (d && d.color) || this.color; c.fillRect(x, y, T, T); }
  }
  // A 16 x 16 block of one layer as a picture, redrawn only when a tile in it has changed.
  _chunk(L, i, j){
    const px = this.prerender, key = j * 4096 + i, T = this.tile; let ch = L.chunks.get(key);
    if (ch && !ch.dirty && ch.px === px) return ch;
    if (!ch) L.chunks.set(key, ch = { cv: document.createElement('canvas'), dirty: true, px: 0, any: false });
    ch.cv.width = ch.cv.height = 16 * px;   // also wipes it
    const g = ch.cv.getContext('2d'), k = px / T; g.imageSmoothingEnabled = this.smooth;
    g.setTransform(k, 0, 0, k, -(this.x + i * 16 * T) * k, -(this.y + j * 16 * T) * k);
    ch.any = false; ch.dirty = false; ch.px = px;
    for (let r = j * 16, r1 = Math.min(this.rows, r + 16); r < r1; r++) for (let q = i * 16, q1 = Math.min(this.cols, q + 16); q < q1; q++) {
      const id = L.data[r * this.cols + q]; if (id) { ch.any = true; this.drawTile(g, id, this.x + q * T, this.y + r * T, T, q, r); }
    }
    return ch;
  }

  // ---- colliding
  // Each axis in turn, checking every column or row the leading edge crosses, so no speed skips a wall.
  move(o, dx, dy, through = false){
    const T = this.tile, X = this.x, Y = this.y, D = this._L(this.collide).data, r = o.r, w = r ? r * 2 : o.w, h = r ? r * 2 : o.h, e = 1e-9;
    let x = r ? o.x - r : o.x, y = r ? o.y - r : o.y, hit = 0;
    if (dx) {
      const r0 = Math.floor((y - Y) / T + e), r1 = Math.ceil((y + h - Y) / T - e) - 1; let nx = x + dx;
      if (dx > 0) {
        scan: for (let c = Math.ceil((x + w - X) / T - e), c1 = Math.ceil((nx + w - X) / T - e) - 1; c <= c1; c++)
          for (let j = r0; j <= r1; j++) if (this._solid(D, c, j)) { nx = X + c * T - w; hit |= 2; break scan; }
      } else {
        scan: for (let c = Math.floor((x - X) / T + e) - 1, c1 = Math.floor((nx - X) / T + e); c >= c1; c--)
          for (let j = r0; j <= r1; j++) if (this._solid(D, c, j)) { nx = X + (c + 1) * T; hit |= 1; break scan; }
      }
      x = nx;
    }
    if (dy) {
      const c0 = Math.floor((x - X) / T + e), c1 = Math.ceil((x + w - X) / T - e) - 1; let ny = y + dy;
      if (dy > 0) {
        scan: for (let j = Math.ceil((y + h - Y) / T - e), j1 = Math.ceil((ny + h - Y) / T - e) - 1; j <= j1; j++)
          for (let c = c0; c <= c1; c++) if (this._solid(D, c, j) || (!through && this._one(D, c, j))) { ny = Y + j * T - h; hit |= 8; break scan; }
      } else {
        scan: for (let j = Math.floor((y - Y) / T + e) - 1, j1 = Math.floor((ny - Y) / T + e); j >= j1; j--)
          for (let c = c0; c <= c1; c++) if (this._solid(D, c, j)) { ny = Y + (j + 1) * T; hit |= 4; break scan; }
      }
      y = ny;
    }
    o.x = r ? x + r : x; o.y = r ? y + r : y;
    return hit;
  }

  // ---- Physics
  addTo(world, opts = null){
    this.removeFrom(); this._world = world;
    const T = this.tile, cols = this.cols, D = this._L(this.collide).data, out = this.bodies;
    const make = (id, b) => { const d = this.defs[id]; out.push(world.add(Object.assign(b, { fixed: true, tile: id }, opts, d && d.body))); return b; };
    // 1 = a plain block, 2 = one-way, 3 = a polygon, 0 = nothing to hit
    const kind = id => { if (!id) return 0; const d = this.defs[id]; return !d ? 1 : d.pts ? 3 : d.oneWay ? 2 : d.solid === false ? 0 : 1; };
    const loose = id => { const d = this.defs[id]; return !(d && d.body); }, same = (a, b) => a === b || (loose(a) && loose(b));   // tiles with a body of their own only join their own kind
    let open = new Map();   // the boxes that ended on the row above, by the columns they span: a run that matches one grows it
    for (let j = 0; j < this.rows; j++) {
      const next = new Map(), y = this.y + j * T;
      for (let i = 0; i < cols; i++) {
        const id = D[j * cols + i], k = kind(id); if (!k) continue;
        const x = this.x + i * T, d = this.defs[id];
        if (k === 3) { make(id, { x, y, pts: d.pts.map(v => v * T) }); continue; }
        let e = i; while (e + 1 < cols && kind(D[j * cols + e + 1]) === k && (k === 1 ? same(id, D[j * cols + e + 1]) : D[j * cols + e + 1] === id)) e++;
        const w = (e - i + 1) * T;
        if (k === 2) make(id, { x, y, w, h: (d.h ?? 1) * T, oneWay: true });
        else { const key = i * 65536 + e; let up = open.get(key); if (up && same(up.tile, id)) up.h += T; else up = make(id, { x, y, w, h: T }); next.set(key, up); }
        i = e;
      }
      open = next;
    }
    return out;
  }
  removeFrom(){ if (this._world) for (const b of this.bodies) this._world.remove(b); this.bodies.length = 0; this._world = null; return this; }

  // ---- rays and paths
  raycast(ox, oy, dx, dy, max = Infinity){
    const T = this.tile, X = this.x, Y = this.y, D = this._L(this.collide).data, H = this.hit; let t0 = 0, en = 0;
    const end = (t, cx, cy, nx, ny) => { H.cx = cx; H.cy = cy; H.id = this.get(cx, cy, this.collide); Collide.nx = nx; Collide.ny = ny; return this.dist = t; };
    this.dist = -1;
    if (ox < X || oy < Y || ox >= X + this.w || oy >= Y + this.h) {   // from outside: skip to where it enters the map
      if (this.edge) return end(0, this.cx(ox), this.cy(oy), -dx, -dy);
      let a = 0, b = max;
      if (dx) { const p = (X - ox) / dx, q = (X + this.w - ox) / dx, lo = Math.min(p, q); if (lo > a) { a = lo; en = 1; } b = Math.min(b, Math.max(p, q)); } else if (ox < X || ox >= X + this.w) return -1;
      if (dy) { const p = (Y - oy) / dy, q = (Y + this.h - oy) / dy, lo = Math.min(p, q); if (lo > a) { a = lo; en = 2; } b = Math.min(b, Math.max(p, q)); } else if (oy < Y || oy >= Y + this.h) return -1;
      if (a > b) return -1;
      t0 = a;
    }
    const px = ox + dx * t0, py = oy + dy * t0, sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    let cx = clamp(Math.floor((px - X) / T + (t0 ? sx * 1e-7 : 0)), 0, this.cols - 1), cy = clamp(Math.floor((py - Y) / T + (t0 ? sy * 1e-7 : 0)), 0, this.rows - 1);
    if (this._solid(D, cx, cy)) return en === 1 ? end(t0, cx, cy, -sx, 0) : en === 2 ? end(t0, cx, cy, 0, -sy) : end(t0, cx, cy, -dx, -dy);   // starts in a wall, or meets one on the map's rim
    const ax = dx ? T / Math.abs(dx) : Infinity, ay = dy ? T / Math.abs(dy) : Infinity;
    let tx = dx ? (X + (cx + (dx > 0 ? 1 : 0)) * T - px) / dx : Infinity, ty = dy ? (Y + (cy + (dy > 0 ? 1 : 0)) * T - py) / dy : Infinity;
    for (;;) {
      let t, nx = 0, ny = 0;
      if (tx < ty) { t = tx; tx += ax; cx += sx; nx = -sx; } else { t = ty; ty += ay; cy += sy; ny = -sy; }
      if (!(t0 + t <= max)) return -1;
      const outside = cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows;
      if (outside ? this.edge : this.solid(D[cy * this.cols + cx])) return end(t0 + t, cx, cy, nx, ny);
      if (outside) return -1;
    }
  }
  sees(ax, ay, bx, by){ const d = Math.hypot(bx - ax, by - ay); return !d || this.raycast(ax, ay, (bx - ax) / d, (by - ay) / d, d) < 0; }
  path(ax, ay, bx, by, o = {}){
    const cols = this.cols, rows = this.rows, n = cols * rows, D = this._L(this.collide).data, T = this.tile;
    const sx = this.cx(ax), sy = this.cy(ay), gx = this.cx(bx), gy = this.cy(by);
    if (sx < 0 || sy < 0 || sx >= cols || sy >= rows || gx < 0 || gy < 0 || gx >= cols || gy >= rows) return null;
    const cost = o.cost || null, diag = o.diagonal !== false, max = o.max ?? 5000, goal = gy * cols + gx, start = sy * cols + sx;
    // What it costs to step onto a tile: 0 = can't.
    const price = i => { const id = D[i]; if (this.solid(id)) return 0; if (!cost) return 1; const k = cost(id, i % cols, (i / cols) | 0); return k > 0 && k < Infinity ? k : 0; };
    if (start === goal) return [];
    if (!price(goal)) return null;
    if (!this._g || this._g.length !== n) { this._g = new Float32Array(n); this._from = new Int32Array(n); this._st = new Uint32Array(n); this._stamp = 0; }
    const G = this._g, F = this._from, S = this._st, heap = this._heap, open = (this._stamp += 2), shut = open + 1;   // S[i]: open = seen, shut = done
    // A binary heap of [f, cell] pairs kept flat.
    heap.length = 0;
    const push = (f, i) => { let k = heap.length; heap.push(f, i); while (k > 0) { const p = ((k / 2 - 1) >> 1) * 2; if (heap[p] <= f) break; heap[k] = heap[p]; heap[k + 1] = heap[p + 1]; k = p; } heap[k] = f; heap[k + 1] = i; };
    const pop = () => {
      const top = heap[1], f = heap[heap.length - 2], i = heap[heap.length - 1]; heap.length -= 2; const len = heap.length; if (!len) return top;
      let k = 0; for (;;) { let c = k * 2 + 2; if (c >= len) break; if (c + 2 < len && heap[c + 2] < heap[c]) c += 2; if (heap[c] >= f) break; heap[k] = heap[c]; heap[k + 1] = heap[c + 1]; k = c; }
      heap[k] = f; heap[k + 1] = i; return top;
    };
    const est = i => { const ex = Math.abs(i % cols - gx), ey = Math.abs(((i / cols) | 0) - gy); return diag ? Math.max(ex, ey) + 0.41421356 * Math.min(ex, ey) : ex + ey; };
    G[start] = 0; S[start] = open; F[start] = -1; push(est(start), start);
    let looked = 0;
    while (heap.length) {
      const i = pop(); if (S[i] === shut) continue;
      if (i === goal) {
        const out = []; for (let k = goal; k !== start; k = F[k]) out.push({ x: this.x + (k % cols + 0.5) * T, y: this.y + (((k / cols) | 0) + 0.5) * T });
        return out.reverse();
      }
      S[i] = shut; if (++looked > max) return null;
      const x = i % cols, y = (i / cols) | 0;
      for (let d = 0; d < (diag ? 8 : 4); d++) {
        const ox = Tilemap._DX[d], oy = Tilemap._DY[d], qx = x + ox, qy = y + oy; if (qx < 0 || qy < 0 || qx >= cols || qy >= rows) continue;
        const q = qy * cols + qx; if (S[q] === shut) continue;
        const p = price(q); if (!p) continue;
        if (d > 3 && (!price(y * cols + qx) || !price(qy * cols + x))) continue;   // no squeezing between two corners
        const g = G[i] + p * (d > 3 ? 1.41421356 : 1);
        if (S[q] !== open || g < G[q]) { G[q] = g; F[q] = i; S[q] = open; push(g + est(q), q); }
      }
    }
    return null;
  }

  // ---- making one
  static from(lines, tile = 32, legend = {}, o = {}){
    const cols = Math.max(0, ...lines.map(s => s.length)), m = new Tilemap(cols, lines.length, tile, o);
    lines.forEach((row, j) => { for (let i = 0; i < row.length; i++) {
      const ch = row[i], id = legend[ch];
      if (id !== undefined) m.set(i, j, id);
      else if (ch !== '.' && ch !== ' ') (m.marks[ch] || (m.marks[ch] = [])).push({ x: m.x + (i + 0.5) * tile, y: m.y + (j + 0.5) * tile, cx: i, cy: j });
    } });
    return m;
  }
  // A map exported from Tiled as JSON (orthogonal, layer data as CSV or uncompressed base64). o: { tile, x, y, collide: 'layer name' }.
  // Tile layers keep their names, visibility and opacity; object layers land in map.objects[name]; custom tile properties
  // (solid, oneWay...) and tile animations become defs. Flipped and rotated tiles are drawn unflipped.
  static tiled(j, o = {}){
    if (j.infinite) throw new Error('Tilemap: infinite Tiled maps are not supported (untick "Infinite" in the map properties)');
    if (j.orientation && j.orientation !== 'orthogonal') throw new Error(`Tilemap: only orthogonal maps are supported, not "${j.orientation}"`);
    const m = new Tilemap(j.width, j.height, o.tile || j.tilewidth, o), k = m.tile / j.tilewidth; m.layers.length = 0;
    const walk = list => { for (const L of list || []) {
      if (L.type === 'group') walk(L.layers);
      else if (L.type === 'tilelayer') {
        let data = L.data;
        if (typeof data === 'string') {
          if (L.compression) throw new Error(`Tilemap: layer "${L.name}" is compressed (${L.compression}); set the Tile Layer Format to CSV in Tiled`);
          const bin = atob(data); data = new Array(bin.length >> 2);
          for (let i = 0; i < data.length; i++) data[i] = (bin.charCodeAt(i * 4) | bin.charCodeAt(i * 4 + 1) << 8 | bin.charCodeAt(i * 4 + 2) << 16 | bin.charCodeAt(i * 4 + 3) << 24) >>> 0;
        }
        const l = m.layer(L.name); l.visible = L.visible !== false; l.alpha = L.opacity ?? 1;
        for (let i = 0; i < l.data.length; i++) l.data[i] = (data[i] || 0) & 0x0fffffff;   // the top bits are Tiled's flip flags
      } else if (L.type === 'objectgroup') m.objects[L.name] = (L.objects || []).map(ob => ({ ...ob, x: m.x + ob.x * k, y: m.y + ob.y * k, width: (ob.width || 0) * k, height: (ob.height || 0) * k }));
    } };
    walk(j.layers);
    if (!m.layers.length) m.layer('main');
    const sets = j.tilesets || []; if (sets.length) m.firstId = sets[0].firstgid || 1;
    for (const ts of sets) for (const t of ts.tiles || []) {
      const d = {}; let any = false;
      for (const p of t.properties || []) { d[p.name] = p.value; any = true; }
      if (t.animation && t.animation.length) { d.frames = t.animation.map(a => a.tileid + ts.firstgid - m.firstId); d.fps = 1000 / (t.animation[0].duration || 100); any = true; }
      if (any) m.def(ts.firstgid + t.id, d);
    }
    if (o.collide !== undefined) m.collide = o.collide;
    return m;
  }
}
Tilemap._DX = [1, -1, 0, 0, 1, 1, -1, -1]; Tilemap._DY = [0, 0, 1, -1, 1, -1, 1, -1];


/* ---- src/text.js ---- */
/* ================================================================
   TEXT on the canvas: sizes, outlines and shadows, wrapping, alignment, coloured words, typewriter reveal, bitmap
   fonts and floating numbers. It is `Txt` because `Text` already means something else to the browser.
     Txt.draw(ctx, 'Score 120', x, y, { size: 24, color: '#fff', outline: '#000' });
   Sizes are in whatever units the context is in: world units after cam.apply(ctx), CSS pixels after cam.applyScreen(ctx).
   Options (all optional):
     size: 16, font: 'system-ui, sans-serif' (Txt.font), weight: 400, italic: false
     color: '#fff', alpha: 1
     align: 'left' | 'center' | 'right'       where x is on each line
     valign: 'top' | 'middle' | 'bottom'      where y is on the whole block
     width: 300                               wrap at this width; '\n' always starts a new line
     lineHeight: 1.25                         x size
     outline: '#000', outlineWidth: size * 0.18
     shadow: '#000', shadowX, shadowY         a copy behind, offset by size * 0.08 unless given
     angle, scale                             turned and scaled about (x, y)
     reveal: 12                               only the first 12 characters (a typewriter: reveal: seconds * 30). Words keep
                                              their places as they appear; Txt.measure(...).chars is how many there are
     rich: true                               colour tags in the string: 'Take the {#fd5}gold key{/} to the {door}door{/}'.
                                              {#rgb} or {any css colour} starts a colour, or a name set in Txt.colors;
                                              {/} goes back. '{{' is a plain '{'
   A style can be named and reused; a draw can add to it:
     Txt.style('title', { size: 48, weight: 800, outline: '#000', align: 'center' });
     Txt.draw(ctx, 'GAME OVER', vw / 2, 80, 'title');   Txt.draw(ctx, 'paused', x, y, { style: 'title', size: 24 });
   Txt.measure(str, opts) gives { w, h, chars, lines } without drawing. Layouts are remembered (the last Txt.max
   different ones), so drawing the same text every frame measures it once. draw() leaves the context's font set.

   BITMAP FONTS, for pixel art: glyphs in a grid image, in the order of a string.
     const font = Txt.bitmap(Assets.get('font'), 8, 8, ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ');
     Txt.draw(ctx, 'HELLO', x, y, { font, size: 16, color: '#fd5' });   // size is the glyph height; color tints (leave it out for the image as drawn)
   Txt.bitmap's last argument: { margin, spacing } of the grid, advance: 1 (how far each glyph moves on, in glyph widths),
   widths: { i: 0.5, ... } for narrow letters, upper: true to draw lower case with the capitals. Outlines are not drawn.

   FLOATING TEXT (damage numbers, "+10"): rises, pops and fades by itself.
     Txt.pop('-25', enemy.x, enemy.y, { color: '#f55', size: 18, outline: '#000' });   // also life: 0.8, vx, vy: -60, gravity: 0, grow: 1.4
     Txt.update(dt);                      // in your update
     Txt.drawPops(ctx, cam.view);         // with the world, after cam.apply(ctx). Txt.pops is the list; Txt.clearPops() empties it
   ================================================================ */
const Txt = {
  font: 'system-ui, sans-serif', styles: new Map(), colors: {}, pops: [], max: 400, _lay: new Map(), _none: {}, _fid: 0,
  style(name, o){ this.styles.set(name, o); return this; },
  _opts(o){
    if (!o) return this._none;
    if (typeof o === 'string') { const s = this.styles.get(o); if (!s) throw new Error(`Txt: unknown style "${o}"`); return s; }
    return o.style ? Object.assign({}, this._opts(o.style), o, { style: undefined }) : o;
  },
  measure(s, o, c = ctx){ return this._layout(c, String(s), this._opts(o)); },
  // Lines of runs (a run is a stretch of one colour), each with its place on its line. Worked out once per text and style.
  _layout(c, s, o){
    const f = o.font, bm = f && typeof f === 'object' ? f : null, size = o.size ?? 16;
    const css = bm ? '' : `${o.italic ? 'italic ' : ''}${o.weight ?? 400} ${size}px ${f || this.font}`;
    const key = `${s}\n${bm ? '#' + bm.id + ' ' + size : css}|${o.width || 0}|${o.rich ? 1 : 0}|${o.lineHeight ?? 1.25}`, M = this._lay;
    let L = M.get(key);
    if (L) { M.delete(key); M.set(key, L); return L; }
    if (!bm) c.font = css;
    const meas = t => bm ? bm.measure(t, size) : c.measureText(t).width, max = o.width > 0 ? o.width : Infinity;
    const lines = []; let line = { runs: [], w: 0 }, color = null, chars = 0, wide = 0, soft = false;
    const endLine = () => {
      const R = line.runs; if (R.length) { const last = R[R.length - 1]; last.text = last.text.replace(/[^\S\n]+$/, ''); if (!last.text && R.length > 1) R.pop(); }
      let x = 0; for (const r of R) { r.x = x; r.w = meas(r.text); x += r.w; chars += r.text.length; }
      line.w = x; if (x > wide) wide = x; lines.push(line); line = { runs: [], w: 0 };
    };
    const add = (t, col) => { const R = line.runs, last = R[R.length - 1]; if (last && last.color === col) last.text += t; else R.push({ text: t, color: col, x: 0, w: 0 }); };
    const put = (text, col) => {   // words and the gaps between them, wrapping before a word that would not fit
      for (const tok of text.match(/\n|[^\S\n]+|[^\s]+/g) || []) {
        if (tok === '\n') { endLine(); soft = false; continue; }
        const w = meas(tok), gap = tok.trim() === '';
        if (gap && !line.runs.length && soft) continue;   // no gap at the start of a wrapped line
        if (!gap && line.w + w > max && line.runs.length) { endLine(); soft = true; }
        add(tok, col); line.w += w;
      }
    };
    if (o.rich) {
      let at = 0; const re = /\{\{|\{([^{}\n]*)\}/g; let m;
      while ((m = re.exec(s))) {
        if (m.index > at) put(s.slice(at, m.index), color);
        if (m[0] === '{{') put('{', color); else color = m[1] === '/' || m[1] === '' ? null : this.colors[m[1]] || m[1];
        at = re.lastIndex;
      }
      if (at < s.length) put(s.slice(at), color);
    } else put(s, null);
    endLine();
    const lh = size * (o.lineHeight ?? 1.25);
    L = { lines, w: wide, h: lines.length * lh, lh, chars, css };
    M.set(key, L); if (M.size > this.max) M.delete(M.keys().next().value);
    return L;
  },
  draw(c, s, x, y, o){ o = this._opts(o); return this._draw(c, String(s), x, y, o, o.alpha ?? 1, o.scale ?? 1); },
  _draw(c, s, x, y, o, alpha, sc){
    const L = this._layout(c, s, o), size = o.size ?? 16, f = o.font, bm = f && typeof f === 'object' ? f : null;
    const turned = o.angle || sc !== 1, pa = c.globalAlpha;
    if (turned) { c.save(); c.translate(x, y); if (o.angle) c.rotate(o.angle); if (sc !== 1) c.scale(sc, sc); x = y = 0; }
    if (alpha !== 1) c.globalAlpha = pa * alpha;
    if (!bm) { c.font = L.css; c.textAlign = 'left'; c.textBaseline = 'middle'; }
    const va = o.valign, y0 = y - (va === 'middle' ? L.h / 2 : va === 'bottom' ? L.h : 0) + L.lh / 2;
    const n = o.reveal === undefined ? Infinity : Math.floor(o.reveal);
    if (o.shadow) this._pass(c, L, x + (o.shadowX ?? size * 0.08), y0 + (o.shadowY ?? size * 0.08), o, n, 1, bm, size);
    if (o.outline && !bm) { c.lineJoin = 'round'; c.lineWidth = o.outlineWidth ?? size * 0.18; c.strokeStyle = o.outline; this._pass(c, L, x, y0, o, n, 2, bm, size); }
    this._pass(c, L, x, y0, o, n, 0, bm, size);
    if (turned) c.restore(); else if (alpha !== 1) c.globalAlpha = pa;
    return L;
  },
  // One pass over every run: 0 = the letters, 1 = the shadow, 2 = the outline.
  _pass(c, L, x, y, o, n, mode, bm, size){
    const al = o.align, lines = L.lines;
    for (let i = 0; i < lines.length && n > 0; i++) {
      const ln = lines[i], lx = x - (al === 'center' ? ln.w / 2 : al === 'right' ? ln.w : 0), ly = y + i * L.lh;
      for (const r of ln.runs) {
        if (n <= 0) break;
        const t = n >= r.text.length ? r.text : r.text.slice(0, n); n -= r.text.length;
        const col = mode === 1 ? o.shadow : r.color || o.color;
        if (bm) bm.draw(c, t, lx + r.x, ly, size, col);
        else if (mode === 2) c.strokeText(t, lx + r.x, ly);
        else { c.fillStyle = col || '#fff'; c.fillText(t, lx + r.x, ly); }
      }
    }
  },
  bitmap(img, fw, fh, chars, o = {}){
    const sheet = Sprites.sheet(img, fw, fh, o), map = new Map(), adv = o.advance ?? 1, widths = o.widths || {}, d = { w: 0, h: 0, ox: 0, oy: 0.5 }, tints = new Map();
    [...chars].forEach((ch, i) => map.set(ch, i));
    const wOf = ch => widths[ch] ?? adv, fix = t => o.upper ? t.toUpperCase() : t;
    // The whole image in one colour, made once per colour.
    const tinted = col => {
      let s = tints.get(col); if (s) return s;
      const cnv = document.createElement('canvas'); cnv.width = img.naturalWidth || img.width; cnv.height = img.naturalHeight || img.height;
      const g = cnv.getContext('2d'); g.drawImage(img, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, cnv.width, cnv.height);
      tints.set(col, s = Sprites.sheet(cnv, fw, fh, o)); if (tints.size > 32) tints.delete(tints.keys().next().value);
      return s;
    };
    return { id: ++this._fid, sheet, map, chars,
      measure(t, size){ let w = 0; for (const ch of fix(t)) w += wOf(ch); return w * size * fw / fh; },
      draw(c, t, x, y, size, col){
        const gw = size * fw / fh, sh = col ? tinted(col) : sheet; d.w = gw; d.h = size;
        for (const ch of fix(t)) { const fr = map.get(ch); if (fr !== undefined) sh.draw(c, fr, x, y, d); x += wOf(ch) * gw; }
      } };
  },
  pop(s, x, y, o){
    const st = this._opts(o), p = { s: String(s), x, y, vx: st.vx || 0, vy: st.vy ?? -60, gravity: st.gravity || 0, t: 0, life: st.life ?? 0.8, grow: st.grow ?? 1.4,
      o: Object.assign({ align: 'center', valign: 'middle' }, st) };
    this.pops.push(p); return p;
  },
  update(dt){
    const P = this.pops; let w = 0;
    for (let i = 0; i < P.length; i++) { const p = P[i]; p.t += dt; if (p.t >= p.life) continue; p.vy += p.gravity * dt; p.x += p.vx * dt; p.y += p.vy * dt; P[w++] = p; }
    P.length = w;
  },
  drawPops(c, view = null, m = 60){
    for (const p of this.pops) {
      if (view && (p.x < view.x0 - m || p.x > view.x1 + m || p.y < view.y0 - m || p.y > view.y1 + m)) continue;
      const k = p.t / p.life;   // a quick swell at the start, a fade over the last third
      this._draw(c, p.s, p.x, p.y, p.o, (p.o.alpha ?? 1) * (k < 0.67 ? 1 : (1 - k) * 3), (p.o.scale ?? 1) * (1 + (p.grow - 1) * Math.max(0, 1 - k * 6)));
    }
  },
  clearPops(){ this.pops.length = 0; },
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

