'use strict';
/* BGEjs 0.2.1: a small browser game engine. Built from src/ by scripts/bundle.js; edit src/, not this file. */

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
   new Bus() makes a separate bus (one per match, say). Handlers run in the order they were added.
   ================================================================ */
class Bus {
  constructor(){ this.map = new Map(); }
  on(name, fn){
    let l = this.map.get(name); if (!l) this.map.set(name, l = []);
    l.push(fn);
    return () => this.off(name, fn);
  }
  once(name, fn){ const off = this.on(name, (...a) => { off(); fn(...a); }); return off; }
  off(name, fn){
    const l = this.map.get(name); if (!l) return;
    const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
  }
  emit(name, data){
    const l = this.map.get(name); if (!l || !l.length) return;
    for (const fn of l.slice()) fn(data);   // a copy, so handlers can unsubscribe while running
  }
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

   Destroying is deferred until the phase finishes (safe mid-loop); kill() removes at once.
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
  add(id, name, data){ this.store(name).set(id, data); this.stale.add(name); return data; }
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
   Loop.realTime is wall seconds since start. Loop.fps is a smoothed frame rate.
   While the tab is hidden the browser stops animation frames; set keepAliveHidden to keep updating on a timer
   (a network host needs this).
   ================================================================ */
const Loop = {
  update: null, render: null, step: null, maxDt: 1 / 30, maxSteps: 8,
  timeScale: 1, paused: false, keepAliveHidden: false,
  time: 0, realTime: 0, frame: 0, fps: 60, running: false,
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
    this.realTime += raw; this.frame++;
    if (raw > 0) this.fps += (1 / raw - this.fps) * 0.05;
    let dt = hidden ? Math.min(raw, 1.5) : Math.min(raw, this.maxDt);
    if (!this.paused && this.update) {
      if (this._stop > 0) { this._stop -= dt; dt = 0; }
      dt *= this.timeScale;
      if (dt > 0) {
        if (this.step) {
          this._acc += dt; let n = 0;
          while (this._acc >= this.step && n < (hidden ? 1e4 : this.maxSteps)) { this.update(this.step); this.time += this.step; this._acc -= this.step; n++; }
          if (n >= this.maxSteps && !hidden) this._acc = 0;   // spiral of death guard
        } else {
          // variable step, split so no single update is longer than maxDt (keeps physics stable in slow tabs and fast-forward)
          const n = Math.ceil(dt / this.maxDt - 1e-9);
          for (let i = 0; i < n; i++) { this.update(dt / n); this.time += dt / n; }
        }
      }
    }
    if (!hidden && this.render) this.render(raw, this.step ? this._acc / this.step : 1);
  },
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
   ================================================================ */
const Ease = {
  linear: t => t,
  inQuad: t => t * t, outQuad: t => t * (2 - t), inOutQuad: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  inCubic: t => t * t * t, outCubic: t => 1 - (1 - t) ** 3, inOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2,
  outBack: t => { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
  outElastic: t => t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1,
  outBounce: t => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; },
  inExpo: t => t === 0 ? 0 : 2 ** (10 * t - 10), outExpo: t => t === 1 ? 1 : 1 - 2 ** (-10 * t),
};
class Clock {
  constructor(){ this.t = 0; this.items = []; this.tweens = new Map(); }
  _add(it){ it.cancel = () => { it.dead = true; }; it.then = fn => { it.done = fn; return it; }; this.items.push(it); return it; }
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
            if (k >= 1) { it.dead = true; it.done && it.done(); }
          }
        } else if (this.t >= it.at) {
          it.fn();
          if (it.every && --it.left > 0) it.at += it.every; else { it.dead = true; it.done && it.done(); }
        }
      }
      if (!it.dead) list[w++] = it;
      else if (it.tween) { const m = this.tweens.get(it.obj); if (m) { for (const p in m) if (m[p] === it) delete m[p]; } }
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
  go(name, args){ while (this.stack.length) this.stack.pop().exit?.(); const d = this._get(name); this.stack.push(d); d.enter?.(args); },
  push(name, args){ const top = this.stack[this.stack.length - 1]; top?.pause?.(); const d = this._get(name); this.stack.push(d); d.enter?.(args); },
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
   a private window or blocked storage just means nothing is kept.
     const save = new Store('mygame');
     save.get('settings', { vol: 0.8 });    // the default comes back when nothing is saved or it can't be read
     save.set('settings', { vol: 0.5 });  save.remove('settings');
     save.migrate(2, { 2: data => { ... } });   // runs each step above the saved version once, in order
   Values are JSON. Keys are stored as `${ns}.${key}`.
   ================================================================ */
class Store {
  constructor(ns){ this.ns = ns; }
  _k(key){ return this.ns ? `${this.ns}.${key}` : key; }
  get(key, def = null){
    try { const s = localStorage.getItem(this._k(key)); return s === null ? def : JSON.parse(s); } catch (e) { return def; }
  }
  set(key, v){ try { localStorage.setItem(this._k(key), JSON.stringify(v)); return true; } catch (e) { return false; } }
  remove(key){ try { localStorage.removeItem(this._k(key)); } catch (e) {} }
  // steps: { [version]: fn(store) }. Each runs once, lowest first, for versions above the saved one.
  migrate(version, steps = {}){
    const at = this.get('__version', 0);
    for (const v of Object.keys(steps).map(Number).sort((a, b) => a - b)) if (v > at && v <= version) { try { steps[v](this); } catch (e) {} }
    if (at !== version) this.set('__version', version);
  }
}


/* ---- src/collide.js ---- */
/* ================================================================
   COLLISION HELPERS for circles, axis-aligned boxes and segments. Plain functions, no allocation
   unless noted. Boxes are { x, y, w, h } with x, y the top-left corner.
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
     hash.clear(); for (const e of enemies) hash.insert(e);   // anything with x and y
     for (const e of hash.query(x, y, r)) ...           // everything in the cells that touch the circle (check the distance yourself)
     hash.nearest(x, y, maxR, e => !e.dead);            // the closest match within maxR, or null
   query() fills and returns one shared array unless you pass your own `out`, so copy it if you keep it
   across another query. Objects with dead === true are skipped. The world has no bounds.
   ================================================================ */
class SpatialHash {
  constructor(cell = 64){ this.cell = cell; this.inv = 1 / cell; this.cells = new Map(); this.buf = []; this.used = []; }
  _key(cx, cy){ return (cx + 32768) * 65536 + (cy + 32768); }
  clear(){ for (const a of this.used) a.length = 0; this.used.length = 0; if (this.cells.size > 8192) this.cells.clear(); }
  insert(o){
    const k = this._key(Math.floor(o.x * this.inv), Math.floor(o.y * this.inv));
    let a = this.cells.get(k); if (!a) this.cells.set(k, a = []);
    if (!a.length) this.used.push(a);
    a.push(o);
  }
  query(x, y, r, out = this.buf){
    out.length = 0;
    const i = this.inv, x0 = Math.floor((x - r) * i), x1 = Math.floor((x + r) * i), y0 = Math.floor((y - r) * i), y1 = Math.floor((y + r) * i);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const a = this.cells.get(this._key(cx, cy)); if (a) for (const o of a) if (!o.dead) out.push(o);
    }
    return out;
  }
  nearest(x, y, maxR, filter = null){
    let best = null, bd = maxR * maxR;
    for (const o of this.query(x, y, maxR, [])) { const d = dist2(x, y, o.x, o.y); if (d < bd && (!filter || filter(o))) { bd = d; best = o; } }
    return best;
  }
}


/* ---- src/particles.js ---- */
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


/* ---- src/camera.js ---- */
/* ================================================================
   CAMERA: a 2D view onto the world with follow, zoom and trauma-based screen shake.
     const cam = new Camera();             // uses the core globals vw, vh, dpr, scale
     cam.follow(player, 0.001);            // track a target; the number is the share of the gap left after 1 s (0 = snap)
     cam.addTrauma(0.5);                   // smooth shake: trauma squared x shakeMax, trauma falls by shakeDecay per second
     cam.kick(6);                          // or a direct jolt in pixels that dies away exponentially (kickDecay per second)
     cam.update(dt);  cam.apply(ctx);      // sets the canvas transform; draw the world after this
     cam.view                              // { x0, y0, x1, y1 } visible world rect (for culling and Particles.draw)
     cam.inView(x, y, margin);  cam.toWorld(sx, sy);  cam.toScreen(wx, wy);   // screen = CSS pixels
     cam.applyScreen(ctx);                 // back to CSS-pixel space for the HUD
   zoom multiplies the core `scale`. bounds = { x0, y0, x1, y1 } keeps the view inside the world.
   ================================================================ */
class Camera {
  constructor(){
    this.x = 0; this.y = 0; this.zoom = 1; this.target = null; this.lag = 0; this.bounds = null;
    this.trauma = 0; this.shakeMax = 16; this.shakeDecay = 1.6; this.amp = 0; this.kickDecay = 8; this.kickMax = 16; this.ox = 0; this.oy = 0;
    this.view = { x0: 0, y0: 0, x1: 0, y1: 0 };
  }
  follow(t, lag = 0){ this.target = t; this.lag = lag; if (t && !lag) { this.x = t.x; this.y = t.y; } return this; }
  addTrauma(a){ this.trauma = Math.min(1, this.trauma + a); }
  kick(a){ this.amp = Math.min(this.kickMax, Math.max(this.amp, a)); }
  get k(){ return scale * this.zoom; }   // CSS pixels per world unit
  update(dt){
    const t = this.target;
    if (t) { if (this.lag) { this.x = damp(this.x, t.x, this.lag, dt); this.y = damp(this.y, t.y, this.lag, dt); } else { this.x = t.x; this.y = t.y; } }
    const hw = vw / 2 / this.k, hh = vh / 2 / this.k, b = this.bounds;
    if (b) {
      this.x = b.x1 - b.x0 < hw * 2 ? (b.x0 + b.x1) / 2 : clamp(this.x, b.x0 + hw, b.x1 - hw);
      this.y = b.y1 - b.y0 < hh * 2 ? (b.y0 + b.y1) / 2 : clamp(this.y, b.y0 + hh, b.y1 - hh);
    }
    this.trauma = Math.max(0, this.trauma - this.shakeDecay * dt);
    this.amp *= Math.exp(-this.kickDecay * dt); if (this.amp < 0.01) this.amp = 0;
    const s = this.trauma * this.trauma * this.shakeMax + this.amp;
    this.ox = s ? (Math.random() * 2 - 1) * s : 0; this.oy = s ? (Math.random() * 2 - 1) * s : 0;
    const v = this.view; v.x0 = this.x - hw; v.x1 = this.x + hw; v.y0 = this.y - hh; v.y1 = this.y + hh;
  }
  apply(c){
    const k = this.k * dpr;
    c.setTransform(k, 0, 0, k, dpr * (vw / 2 + this.ox) - this.x * k, dpr * (vh / 2 + this.oy) - this.y * k);
  }
  applyScreen(c){ c.setTransform(dpr, 0, 0, dpr, 0, 0); }
  inView(x, y, m = 0){ const v = this.view; return x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m; }
  toWorld(sx, sy){ return { x: this.x + (sx - vw / 2) / this.k, y: this.y + (sy - vh / 2) / this.k }; }
  toScreen(wx, wy){ return { x: vw / 2 + (wx - this.x) * this.k, y: vh / 2 + (wy - this.y) * this.k }; }
}


/* ---- src/input.js ---- */
/* ================================================================
   INPUT: keyboard, mouse / touch pointer, an on-screen touch stick, gamepads, and named actions over all of them.
     keys.has('a')                       // raw key state (lower-case KeyboardEvent.key); `keys` is Input.keys
     Input.pressed('a')                  // went down since the last Input.endFrame()
     Input.pointer                       // { x, y, down, hasMouse, type } in CSS pixels
     Input.stick                         // touch drag stick { on, ox, oy, x, y }; Input.stickVec(radius) -> { x, y }
     Input.pollPad()                     // call once per frame; Input.pad is { on, lx, ly, rx, ry, dx, dy, id }, Input.padDown(i) / padHit(i)
     Input.bind('jump', ['key: ', 'pad:0', 'mouse:0']);   Input.down('jump');  Input.hit('jump');
     Input.move({ up: 'up', down: 'down', left: 'left', right: 'right' })   // -> { x, y }, length <= 1, includes the left stick and the touch stick
     Input.endFrame()                    // at the end of every frame (clears the "pressed this frame" sets)
   Pad button numbers follow the standard mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 8 Back, 9 Start, 12-15 d-pad up/down/left/right.
   Input.stickOn(canvas, allow) starts the touch stick on pointerdown when allow(event) is true.
   Typing in a text field is ignored by keys; Input.ignore(e) can widen that rule.
   ================================================================ */
const Input = {
  keys: new Set(), _hitKeys: new Set(),
  pointer: { x: 0, y: 0, down: false, hasMouse: false, type: '' }, _hitMouse: new Set(),
  stick: { on: false, id: null, ox: 0, oy: 0, x: 0, y: 0 },
  pad: { on: false, id: '', lx: 0, ly: 0, rx: 0, ry: 0, dx: 0, dy: 0 }, padDead: 0.22, _pb: [], _pp: [],
  actions: new Map(),
  ignore(e){ return e.target instanceof HTMLInputElement && e.target.type !== 'range' && e.target.type !== 'checkbox'; },
  pressed(k){ return this._hitKeys.has(k); },
  endFrame(){ this._hitKeys.clear(); this._hitMouse.clear(); },
  // ---- gamepad
  deadzone(v){ const d = this.padDead; return Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d); },
  pollPad(){
    const gp = [...(navigator.getGamepads?.() || [])].find(g => g && g.connected), P = this.pad;
    this._pp = this._pb;
    if (!gp) { P.on = false; this._pb = []; return P; }
    P.on = true; P.id = gp.id;
    this._pb = gp.buttons.map(b => !!(b && (b.pressed || b.value > 0.5)));
    P.lx = this.deadzone(gp.axes[0] || 0); P.ly = this.deadzone(gp.axes[1] || 0); P.rx = gp.axes[2] || 0; P.ry = gp.axes[3] || 0;
    P.dx = (this._pb[15] ? 1 : 0) - (this._pb[14] ? 1 : 0); P.dy = (this._pb[13] ? 1 : 0) - (this._pb[12] ? 1 : 0);
    return P;
  },
  padDown(i){ return !!this._pb[i]; },
  padHit(i){ return !!this._pb[i] && !this._pp[i]; },
  padAnyHit(){ return this._pb.some((b, i) => b && !this._pp[i]); },
  // ---- touch stick
  stickOn(canvas, allow = () => true){
    const s = this.stick;
    canvas.addEventListener('pointerdown', e => { if (!allow(e)) return; s.on = true; s.id = e.pointerId; s.ox = s.x = e.clientX; s.oy = s.y = e.clientY; canvas.setPointerCapture?.(e.pointerId); });
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
  down(name){
    const l = this.actions.get(name); if (!l) return false;
    for (const [t, v] of l) if (t === 'key' ? this.keys.has(v) : t === 'pad' ? this.padDown(+v) : t === 'mouse' ? this.pointer.down && this.pointer.button === +v : false) return true;
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
};
const keys = Input.keys;
addEventListener('keydown', e => { if (Input.ignore(e)) return; const k = e.key.toLowerCase(); if (!e.repeat) Input._hitKeys.add(k); keys.add(k); }, true);
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()), true);
addEventListener('blur', () => { keys.clear(); Input.stick.on = false; Input.pointer.down = false; });
addEventListener('pointermove', e => { const p = Input.pointer; p.x = e.clientX; p.y = e.clientY; p.type = e.pointerType; if (e.pointerType === 'mouse') p.hasMouse = true; }, true);
addEventListener('pointerdown', e => { const p = Input.pointer; p.x = e.clientX; p.y = e.clientY; p.down = true; p.button = e.button; p.type = e.pointerType; Input._hitMouse.add(e.button); }, true);
addEventListener('pointerup', () => { Input.pointer.down = false; }, true);


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
   R is the drawing's radius in world units; pass the scale you will draw at so it stays sharp. Include anything
   that changes the art in the key, and draw moving parts live on top.
   ================================================================ */
const Sprites = {
  map: new Map(), max: 800, made: 0,
  get(key, R, ds, draw){
    let sp = this.map.get(key);
    if (sp) { this.map.delete(key); this.map.set(key, sp); return sp; }   // mark as recently used
    const px = Math.ceil(2 * R * ds) + 2, cnv = document.createElement('canvas'); cnv.width = cnv.height = px;
    const c = cnv.getContext('2d'); c.setTransform(ds, 0, 0, ds, px / 2, px / 2); c.lineCap = 'round';
    draw(c);
    sp = { cv: cnv, h: px / 2 / ds, w: px / ds }; this.map.set(key, sp); this.made++;
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
const netJoin = name => NET.api.join(name);
const safePres = (room, obj) => { try { room.presence(obj).catch(() => {}); } catch (e) {} };

