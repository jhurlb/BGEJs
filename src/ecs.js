'use strict';
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
