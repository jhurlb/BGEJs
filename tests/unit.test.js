'use strict';
// Engine modules loaded straight from src/*.js into a Node VM (no browser), one script per file like <script> tags.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

function load(files, names){
  // A canvas whose 2D context records drawImage calls and accepts everything else.
  const draws = [];
  const mkCtx = () => new Proxy({ globalAlpha: 1 }, { get: (t, k) => k in t ? t[k] : k === 'drawImage' ? (...a) => { draws.push(a); } : () => {}, set: (t, k, v) => { t[k] = v; return true; } });
  const mkCanvas = () => ({ getContext: mkCtx, width: 0, height: 0 });
  const canvas = mkCanvas();
  const mem = new Map(), listeners = {}, pads = [];
  const store = { fail: false,
    getItem: k => mem.has(k) ? mem.get(k) : null, removeItem: k => mem.delete(k), key: i => [...mem.keys()][i] ?? null, get length(){ return mem.size; },
    setItem: (k, v) => { if (store.fail) throw new Error('QuotaExceededError'); mem.set(k, String(v)); } };
  const ctx = vm.createContext({
    document: { getElementById: () => canvas, addEventListener(){}, createElement: mkCanvas, body: { appendChild: c => c }, hidden: false },
    addEventListener(type, fn){ (listeners[type] || (listeners[type] = [])).push(fn); }, innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
    localStorage: store, navigator: { getGamepads: () => pads },
    requestAnimationFrame: () => 0, cancelAnimationFrame(){}, setInterval: () => 0, clearInterval(){},
    performance: { now: () => Date.now() }, Math, Map, Set, console, Float32Array, Uint8Array, Uint32Array, Error, JSON, Object, Array, Number, String, Promise,
  });
  ctx.window = ctx;
  // One script per file, like <script> tags: they share top-level const / let / class, which the last script hands back.
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  vm.runInContext(`this.__x = { ${names.join(', ')} };`, ctx);
  // The test's handles on the fake browser: fire(type, event) runs the page's listeners, pads is what the gamepad API returns.
  const fire = (type, ev = {}) => { let stopped = false; const e = { type, target: null, preventDefault(){ stopped = true; }, ...ev }; for (const fn of listeners[type] || []) fn(e); return stopped; };
  return Object.assign(ctx.__x, { fire, pads, storage: store, draws });
}
const ENGINE = ['core', 'rng', 'events', 'ecs', 'time', 'scenes', 'pool', 'store', 'collide', 'spatial', 'particles', 'camera'].map(f => `src/${f}.js`);
const X = load(ENGINE,
  ['World', 'system', 'runSystems', 'ecsBasics', 'Rng', 'rand', 'shuffle', 'pickW', 'angDiff', 'clamp', 'damp', 'Bus', 'Clock', 'Ease', 'Scenes', 'Pool', 'Store',
   'Collide', 'SpatialHash', 'Particles', 'Camera']);
// Arrays made inside the VM have another realm's prototype, so compare them by value.
const eq = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b, msg);
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

test('World: spawn, query, deferred destroy', () => {
  const w = new X.World();
  const a = w.spawn({ Pos: { x: 1 }, Vel: { x: 2 } }), b = w.spawn({ Pos: { x: 3 } });
  const seen = []; w.each(['Pos', 'Vel'], (id, p, v) => seen.push([id, p.x, v.x]));
  eq(seen, [[a, 1, 2]]);
  eq(w.list('Pos').map(p => p.x), [1, 3]);
  w.destroy(a); assert.strictEqual(w.count('Pos'), 2);   // deferred until flush
  w.flush(); assert.strictEqual(w.count('Pos'), 1); assert.ok(!w.has(a, 'Vel')); assert.ok(w.has(b, 'Pos'));
  eq(w.list('Pos').map(p => p.x), [3]);   // cached list invalidated
});

test('World.each with three components passes them in the asked order', () => {
  const w = new X.World();
  w.spawn({ A: 'a1', B: 'b1', C: 'c1' }); w.spawn({ A: 'a2', C: 'c2' });
  const seen = []; w.each(['C', 'A', 'B'], (id, c, a, b) => seen.push(c + a + b));
  eq(seen, ['c1a1b1']);
});

test('runSystems runs in order and stops when a system returns false', () => {
  const w = new X.World(), log = [];
  X.system('t', 'second', () => { log.push(2); return false; }, 20);
  X.system('t', 'first', () => { log.push(1); }, 10);
  X.system('t', 'never', () => { log.push(3); }, 30);
  X.runSystems('t', w, 0);
  eq(log, [1, 2]);
});

test('ecsBasics moves, drags and expires entities', () => {
  const w = new X.World(); X.ecsBasics('b');
  const id = w.spawn({ Pos: { x: 0, y: 0 }, Vel: { x: 60, y: 0 }, Life: { t: 0.5, max: 0.5 } });
  X.runSystems('b', w, 0.25); near(w.get(id, 'Pos').x, 15);
  X.runSystems('b', w, 0.3); assert.ok(!w.has(id, 'Pos'));
});

test('Rng is repeatable from a seed and its helpers stay in range', () => {
  const a = new X.Rng(7), b = new X.Rng(7), c = new X.Rng(8);
  const sa = Array.from({ length: 5 }, () => a.next()), sb = Array.from({ length: 5 }, () => b.next());
  eq(sa, sb); assert.notDeepStrictEqual(sa, Array.from({ length: 5 }, () => c.next()));
  const r = new X.Rng(1);
  for (let i = 0; i < 2000; i++) { const f = r.float(), n = r.int(3, 5); assert.ok(f >= 0 && f < 1); assert.ok(n >= 3 && n <= 5 && Number.isInteger(n)); }
  const s = r.state(), v1 = r.float(); r.restore(s); assert.strictEqual(r.float(), v1);
  X.Rng.seed(99); const g1 = X.rand(0, 1); X.Rng.fx.float(); X.Rng.seed(99); X.Rng.fx.float(); X.Rng.fx.float(); assert.strictEqual(X.rand(0, 1), g1);   // Rng.fx never disturbs Rng.main
});

test('shuffle keeps every item and is unbiased', () => {
  const counts = {};
  for (let i = 0; i < 30000; i++) { const s = X.shuffle([1, 2, 3]).join(''); counts[s] = (counts[s] || 0) + 1; }
  assert.strictEqual(Object.keys(counts).length, 6);
  for (const c of Object.values(counts)) assert.ok(c > 4500 && c < 5500, JSON.stringify(counts));   // 5000 each when fair
});

test('angDiff wraps to [-PI, PI]', () => {
  near(X.angDiff(0.1, Math.PI * 2 - 0.1), -0.2, 1e-9);
  near(X.angDiff(-3, 3), 6 - Math.PI * 2, 1e-9);
});

test('Bus: on, once, off, and unsubscribing while emitting', () => {
  const bus = new X.Bus(), log = [];
  const off = bus.on('e', v => log.push('a' + v)); bus.once('e', v => log.push('o' + v));
  bus.on('e', v => { log.push('b' + v); off(); });
  bus.emit('e', 1); bus.emit('e', 2);
  eq(log, ['a1', 'o1', 'b1', 'b2']);
});

test('Clock: after, every, tween with easing and replacement', () => {
  const k = new X.Clock(), log = [], o = { x: 0, y: 10 };
  k.after(1, () => log.push('after'));
  const ev = k.every(0.5, () => log.push('tick'), 3);
  k.tween(o, { x: 100 }, 1, X.Ease.linear);
  k.update(0.5); near(o.x, 50); eq(log, ['tick']);
  k.tween(o, { x: 0, y: 0 }, 1, X.Ease.linear);   // takes x over from the first tween
  k.update(0.5); near(o.x, 25); near(o.y, 5);
  k.update(0.5); near(o.x, 0); near(o.y, 0);
  eq(log, ['tick', 'after', 'tick', 'tick']);
  k.update(5); eq(log, ['tick', 'after', 'tick', 'tick']); assert.strictEqual(k.count, 0); void ev;
  let done = 0; k.tween(o, { x: 1 }, 0.1).then(() => done++); k.update(0.2); assert.strictEqual(done, 1);
  near(X.Ease.outBounce(1), 1); near(X.Ease.outBack(1), 1); near(X.Ease.inOutCubic(0.5), 0.5);
});

test('Scenes: go, push, pop and update only the top', () => {
  const log = [];
  X.Scenes.add('a', { enter: () => log.push('enter a'), exit: () => log.push('exit a'), update: () => log.push('upd a'), pause: () => log.push('pause a'), resume: () => log.push('resume a') });
  X.Scenes.add('b', { enter: v => log.push('enter b ' + v), exit: () => log.push('exit b'), update: () => log.push('upd b') });
  X.Scenes.go('a'); X.Scenes.push('b', 1); X.Scenes.update(0); X.Scenes.pop(); X.Scenes.update(0);
  eq(log, ['enter a', 'pause a', 'enter b 1', 'upd b', 'exit b', 'resume a', 'upd a']);
  assert.strictEqual(X.Scenes.current, 'a');
});

test('Pool reuses released objects', () => {
  let made = 0; const p = new X.Pool(() => ({ n: ++made }), o => { o.used = false; });
  const a = p.get(); p.release(a); assert.strictEqual(p.get(), a); assert.strictEqual(made, 1);
});

test('Store: defaults, round trip, migrations run once', () => {
  const s = new X.Store('t');
  eq(s.get('missing', { d: 1 }), { d: 1 });
  s.set('k', { a: [1, 2] }); eq(s.get('k'), { a: [1, 2] });
  let ran = 0; s.migrate(2, { 1: () => ran++, 2: () => ran++ }); s.migrate(2, { 1: () => ran++, 2: () => ran++ });
  assert.strictEqual(ran, 2);
});

test('Collide helpers', () => {
  const C = X.Collide;
  assert.ok(C.circles(0, 0, 5, 9, 0, 5)); assert.ok(!C.circles(0, 0, 5, 11, 0, 5));
  assert.ok(C.circleBox(-3, 5, 4, { x: 0, y: 0, w: 10, h: 10 })); assert.ok(!C.circleBox(-5, 5, 4, { x: 0, y: 0, w: 10, h: 10 }));
  assert.ok(C.segCircle(0, 0, 10, 0, 5, 2, 3)); assert.ok(!C.segCircle(0, 0, 10, 0, 5, 4, 3));
  near(C.rayCircle(0, 0, 1, 0, 10, 0, 2), 8); assert.strictEqual(C.rayCircle(0, 0, -1, 0, 10, 0, 2), -1);
  assert.ok(C.pointInPoly(1, 1, [0, 0, 4, 0, 4, 4, 0, 4])); assert.ok(!C.pointInPoly(5, 1, [0, 0, 4, 0, 4, 4, 0, 4]));
  const a = { x: 0, y: 0, r: 5 }, b = { x: 6, y: 0, r: 5, mass: 3 }; near(C.separate(a, b), 4); near(b.x - a.x, 10);
});

test('SpatialHash finds what is near, across cells and negative coordinates', () => {
  const h = new X.SpatialHash(32), things = [];
  for (let i = 0; i < 500; i++) things.push({ x: (i * 37) % 1000 - 500, y: (i * 91) % 1000 - 500, dead: i % 50 === 0 });
  for (const t of things) h.insert(t);
  const want = things.filter(t => !t.dead && Math.hypot(t.x - 10, t.y + 20) < 120).length;
  const got = h.query(10, -20, 120).filter(t => Math.hypot(t.x - 10, t.y + 20) < 120).length;
  assert.strictEqual(got, want);
  const n = h.nearest(10, -20, 400); const best = things.filter(t => !t.dead).sort((a, b) => Math.hypot(a.x - 10, a.y + 20) - Math.hypot(b.x - 10, b.y + 20))[0];
  assert.strictEqual(n, best);
  h.clear(); assert.strictEqual(h.query(0, 0, 1000).length, 0);
});

test('Particles: spawn, physics, expiry, capacity, emitters', () => {
  const P = new X.Particles(100);
  P.kind('a', { drag: 1, gravity: 100, draw(){} });
  P.spawn('a', 0, 0, 10, 0, 1);
  P.update(0.5); near(P.x[0], 5); near(P.vy[0], 50); near(P.y[0], 25);
  P.update(0.6); assert.strictEqual(P.count, 0);
  P.burst('a', 0, 0, 150, { speed: [10, 20], life: 1 }); assert.strictEqual(P.count, 100);   // drops past capacity
  P.clear(); const R = new X.Particles(10, { overflow: 'replace' }); R.kind('a', { draw(){} });
  for (let i = 0; i < 15; i++) R.spawn('a', i, 0, 0, 0, 1);
  assert.strictEqual(R.count, 10); eq([...R.x].sort((a, b) => a - b), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);   // the oldest were recycled
  const E = new X.Particles(1000); E.kind('a', { draw(){} });
  const em = E.emitter('a', { rate: 100, life: 10 }); E.update(0.5); assert.strictEqual(E.count, 50);
  em.on = false; E.update(0.5); assert.strictEqual(E.count, 50); em.stop(); E.update(0.1); assert.strictEqual(E.emitters.length, 0);
  let drawn = 0; E.kinds[0].draw = () => drawn++; E.draw({ globalCompositeOperation: '', globalAlpha: 1 }); assert.strictEqual(drawn, 50);
  drawn = 0; E.draw({ globalCompositeOperation: '', globalAlpha: 1 }, { x0: 1e5, y0: 1e5, x1: 1e5 + 1, y1: 1e5 + 1 }); assert.strictEqual(drawn, 0);   // culled
  assert.throws(() => E.spawn('nope', 0, 0, 0, 0, 1));
});

test('Camera follows, clamps to bounds and converts coordinates', () => {
  const cam = new X.Camera(); cam.follow({ x: 100, y: 50 }); cam.update(0.016);
  const s = cam.toScreen(100, 50); near(s.x, 400); near(s.y, 300);
  const w = cam.toWorld(400 + cam.k * 10, 300); near(w.x, 110);
  cam.bounds = { x0: 0, y0: 0, x1: 2000, y1: 2000 }; cam.follow({ x: 0, y: 0 }); cam.update(0.016);
  near(cam.view.x0, 0); near(cam.view.y0, 0);
  assert.ok(cam.inView(10, 10)); assert.ok(!cam.inView(-50, 10));
  cam.kick(8); assert.strictEqual(cam.amp, 8); cam.kick(4); assert.strictEqual(cam.amp, 8);   // the bigger jolt wins
  cam.update(0.5); assert.ok(cam.amp < 8 * Math.exp(-3.9) && cam.amp > 0);
  cam.kick(100); assert.strictEqual(cam.amp, cam.kickMax);
});

// ---- 0.3.0

test('Bus: several arguments, off() for a once() handler, handlers added mid-emit wait for the next emit', () => {
  const bus = new X.Bus(), log = [];
  bus.on('hit', (who, dmg, crit) => log.push(`${who}:${dmg}:${crit}`)); bus.emit('hit', 'orc', 5, true);
  const never = () => log.push('never'); bus.once('hit', never); bus.off('hit', never);
  bus.on('hit', () => { if (bus.count('hit') === 2) bus.on('hit', () => log.push('late')); });
  bus.emit('hit', 'elf', 1, false); eq(log, ['orc:5:true', 'elf:1:false']);
  bus.emit('hit', 'elf', 2, false); eq(log.slice(2), ['elf:2:false', 'late']);
  bus.clear('hit'); assert.strictEqual(bus.count('hit'), 0); bus.emit('hit');
});

test('World: add() on a destroyed entity leaves nothing behind; exists, size, clear', () => {
  const w = new X.World(), a = w.spawn({ Pos: { x: 1 } }), b = w.spawn({ Pos: { x: 2 } });
  assert.ok(w.exists(a)); assert.strictEqual(w.size, 2);
  w.kill(a); assert.ok(!w.exists(a));
  assert.strictEqual(w.add(a, 'Stun', { t: 1 }), undefined); assert.strictEqual(w.count('Stun'), 0);
  eq(w.add(b, 'Stun', { t: 1 }), { t: 1 }); assert.strictEqual(w.count('Stun'), 1);
  eq(w.list('Pos').map(p => p.x), [2]);
  w.clear(); assert.strictEqual(w.size, 0); eq(w.list('Pos'), []); assert.strictEqual(w.count('Stun'), 0);
  assert.ok(w.spawn({ Pos: { x: 3 } }) > b, 'ids are never reused');
});

test('Scenes: an unknown name throws before any scene is exited or paused', () => {
  const log = [];
  X.Scenes.add('s1', { exit: () => log.push('exit'), pause: () => log.push('pause') });
  X.Scenes.go('s1');
  assert.throws(() => X.Scenes.go('typo'), /unknown scene/); assert.throws(() => X.Scenes.push('typo'), /unknown scene/);
  eq(log, []); assert.strictEqual(X.Scenes.current, 's1');
});

test('Clock: every() keeps its rate below the frame time, stops when cancelled inside, and finished tweens are forgotten', async () => {
  const k = new X.Clock(); let n = 0;
  k.every(0.025, () => n++); k.update(0.11); assert.strictEqual(n, 4);
  k.update(0.1); assert.strictEqual(n, 8);
  k.cancelAll(); k.update(0); n = 0;
  const h = k.every(0.01, () => { if (++n === 3) h.cancel(); }); k.update(1); assert.strictEqual(n, 3);
  n = 0; k.every(0.01, () => n++, 5).then(() => n += 100); k.update(1); assert.strictEqual(n, 105);
  n = 0; k.every(0, () => n++); k.update(0.1); k.update(0.1); assert.strictEqual(n, 2);   // a zero interval: once per update, not forever
  k.cancelAll(); k.update(0);
  const o = { x: 0 }, o2 = { x: 0 };
  k.tween(o, { x: 1 }, 0.1); k.tween(o2, { x: 1 }, 0.1).cancel(); k.update(0.2);
  assert.strictEqual(k.tweens.size, 0, 'no object is kept after its tweens end'); assert.strictEqual(k.count, 0);
  const t0 = k.t, waited = (async () => { await k.after(0.1); const at = Math.round((k.t - t0) * 100) / 100; await k.tween(o, { x: 5 }, 0.2, X.Ease.linear); return [at, o.x]; })();   // handles can be awaited
  k.update(0.1); await null; await null; k.update(0.1); k.update(0.1); eq(await waited, [0.1, 5]);
});

test('Ease: every curve starts at 0 and ends at 1', () => {
  const names = Object.keys(X.Ease); assert.ok(names.length >= 18, names.join());
  for (const n of names) { near(X.Ease[n](0), 0, 1e-9); near(X.Ease[n](1), 1, 1e-9); assert.ok(Number.isFinite(X.Ease[n](0.37)), n); }
  near(X.Ease.inOutSine(0.5), 0.5); near(X.Ease.inOutBack(0.5), 0.5); near(X.Ease.inOutExpo(0.5), 0.5);
});

test('Store: falls back to memory when storage refuses, and lists and clears only its own keys', () => {
  const a = new X.Store('ga'), b = new X.Store('gb');
  a.set('one', 1); a.set('two', 2); b.set('one', 10);
  eq(a.keys().sort(), ['one', 'two']);
  eq(a.update('one', v => v + 5), 6); eq(a.get('one'), 6); eq(a.update('fresh', v => v.concat(1), []), [1]);
  X.storage.fail = true;
  assert.strictEqual(a.set('two', 22), false); assert.strictEqual(a.persistent, false);
  eq(a.get('two'), 22, 'the session still sees what it set'); assert.ok(a.keys().includes('two'));
  X.storage.fail = false;
  assert.strictEqual(a.set('two', 23), true); eq(a.get('two'), 23);
  const loop = {}; loop.self = loop; assert.strictEqual(a.set('bad', loop), false); eq(a.get('bad', 'def'), 'def');
  a.clear(); eq(a.keys(), []); eq(a.get('one', null), null); eq(b.get('one'), 10);
});

test('Collide: rayBox, segments, pushOutOfBox and bounce', () => {
  const C = X.Collide, box = { x: 10, y: 0, w: 10, h: 10 };
  near(C.rayBox(0, 5, 1, 0, box), 10); eq([C.nx, C.ny], [-1, 0]);
  near(C.rayBox(15, 30, 0, -1, box), 20); eq([C.nx, C.ny], [0, 1]);
  assert.strictEqual(C.rayBox(0, 5, -1, 0, box), -1); assert.strictEqual(C.rayBox(0, 20, 1, 0, box), -1);
  assert.strictEqual(C.rayBox(15, 5, 1, 0, box), 0);   // starts inside
  const d = Math.SQRT1_2; near(C.rayBox(0, -5, d, d, box), 10 / d);
  near(C.segments(0, 0, 10, 10, 0, 10, 10, 0), 0.5); assert.strictEqual(C.segments(0, 0, 1, 1, 5, 0, 5, 9), -1);
  assert.strictEqual(C.segments(0, 0, 10, 0, 0, 1, 10, 1), -1);   // parallel
  const ball = { x: 8, y: 5, r: 3, vx: 50, vy: 20 };
  assert.ok(C.pushOutOfBox(ball, box)); near(ball.x, 7); near(ball.y, 5); eq([C.nx, C.ny], [-1, 0]);
  C.bounce(ball, 0.5); near(ball.vx, -25); near(ball.vy, 20);
  C.bounce(ball, 0.5); near(ball.vx, -25);   // already moving away: unchanged
  assert.ok(!C.pushOutOfBox({ x: 0, y: 5, r: 3 }, box));
  const corner = { x: 8, y: -2, r: 4 }; assert.ok(C.pushOutOfBox(corner, box)); near(Math.hypot(corner.x - 10, corner.y), 4);
  const inside = { x: 18, y: 5, r: 2 }; assert.ok(C.pushOutOfBox(inside, box)); near(inside.x, 22); eq([C.nx, C.ny], [1, 0]);
});

test('SpatialHash: within() is exact for sized things, nearest() matches a full search at any range', () => {
  const R = new X.Rng(5), h = new X.SpatialHash(40), things = [];
  for (let i = 0; i < 400; i++) things.push({ x: R.range(-900, 900), y: R.range(-900, 900), r: R.chance(0.1) ? R.range(60, 150) : R.range(2, 20), dead: i % 40 === 0, i });
  for (const t of things) h.insert(t);
  const live = things.filter(t => !t.dead), ids = l => l.map(t => t.i).sort((a, b) => a - b);
  for (let q = 0; q < 200; q++) {
    const x = R.range(-1100, 1100), y = R.range(-1100, 1100), r = R.range(1, 200);
    eq(ids(h.within(x, y, r)), ids(live.filter(t => Math.hypot(t.x - x, t.y - y) < r + t.r)));
    const maxR = q % 4 === 0 ? Infinity : R.range(10, 600), filter = q % 3 === 0 ? t => t.i % 2 === 0 : null;
    const pool = live.filter(t => (!filter || filter(t)) && Math.hypot(t.x - x, t.y - y) < maxR).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
    assert.strictEqual(h.nearest(x, y, maxR, filter), pool[0] || null);
  }
  assert.strictEqual(h.nearest(1e7, -1e7), live.slice().sort((a, b) => Math.hypot(a.x - 1e7, a.y + 1e7) - Math.hypot(b.x - 1e7, b.y + 1e7))[0]);
  assert.strictEqual(h.query(0, 0, Infinity).length, live.length);   // a huge radius walks only the cells in use
  h.clear(); assert.strictEqual(h.nearest(0, 0), null); assert.strictEqual(h.maxR, 0); eq(h.within(0, 0, 1e6), []);
});

test('Particles: a bad kind takes no slot, kinds need draw(), a moving emitter spreads along its path', () => {
  const P = new X.Particles(100);
  assert.throws(() => P.kind('nodraw', { drag: 1 }), /draw/);
  P.kind('a', { draw(){} });
  assert.throws(() => P.spawn('nope', 0, 0, 0, 0, 1)); assert.strictEqual(P.count, 0);
  const e = P.emitter('a', { rate: 100, speed: 0, life: 10 }); e.x = 0; P.update(0.1); assert.strictEqual(P.count, 10);
  eq([...P.x.slice(0, 10)], Array(10).fill(0));   // standing still: all at the emitter
  e.x = 100; P.update(0.1); assert.strictEqual(P.count, 20);
  eq([...P.x.slice(10, 20)].map(Math.round), [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  const obj = { x: 500, y: 0 }; e.follow(obj); P.update(0.1); eq([...P.x.slice(20, 30)], Array(10).fill(500));   // no streak from the old place
  P.clear(); assert.ok(e.dead);
});

test('Camera: the view rect grows by the shake so culling never shows a gap', () => {
  const cam = new X.Camera(); cam.update(0.016);
  const w0 = cam.view.x1 - cam.view.x0; cam.kick(10); cam.update(0);
  near(cam.view.x1 - cam.view.x0, w0 + 2 * 10 / cam.k); assert.ok(Math.abs(cam.ox) <= 10 && Math.abs(cam.oy) <= 10);
});

// Loop and Input in their own fake page each, so tests don't share key state.
const page = () => load(['core', 'loop', 'input', 'sprites'].map(f => `src/${f}.js`), ['Loop', 'Input', 'keys', 'Sprites']);
const frames = (L, n, ms, t0 = 0) => { for (let i = 1; i <= n; i++) L._tick(t0 + i * ms); return t0 + n * ms; };

test('Loop: variable and fixed steps, timeScale, pause, and a hitstop that takes only its own time', () => {
  const { Loop } = page(); let n = 0, sim = 0, alpha = -1;
  Object.assign(Loop, { update(dt){ n++; sim += dt; }, render(dt, a){ alpha = a; } });
  let t = frames(Loop, 60, 1000 / 60); assert.strictEqual(n, 60); near(sim, 1, 1e-9); near(Loop.time, 1, 1e-9); assert.strictEqual(Loop.updates, 1);
  Loop.timeScale = 0.5; t = frames(Loop, 60, 1000 / 60, t); near(sim, 1.5, 1e-9);
  Loop.timeScale = 4; n = 0; t = frames(Loop, 1, 1000 / 60, t); assert.strictEqual(n, 2);   // 4/60 s split so no step is over maxDt
  Loop.timeScale = 1; Loop.paused = true; n = 0; t = frames(Loop, 10, 16, t); assert.strictEqual(n, 0); Loop.paused = false;
  sim = 0; Loop.hitstop(0.024); assert.ok(Loop.frozen); t = frames(Loop, 3, 16, t); near(sim, 0.024, 1e-9); assert.ok(!Loop.frozen);
  t = frames(Loop, 1, 5000, t); near(sim, 0.024 + 1 / 30, 1e-9);   // a long stall is capped at maxDt
  Loop.step = 1 / 60; n = 0; sim = 0; t = frames(Loop, 120, 1000 / 120, t);   // a 120 Hz display
  assert.ok(n === 60 || n === 59, `n = ${n}`); near(sim, n / 60, 1e-9); assert.ok(alpha >= 0 && alpha < 1);
  n = 0; t = frames(Loop, 1, 33, t); assert.ok(n === 2 || n === 1); assert.ok(Loop._acc < Loop.step);
  Loop.step = 1 / 1000; n = 0; frames(Loop, 1, 33, t); assert.strictEqual(n, Loop.maxSteps); assert.strictEqual(Loop._acc, 0);   // can't keep up: the backlog is dropped
});

test('Loop autoInput: every press reaches exactly one update, at a fixed step, through a hitstop and while paused', () => {
  const { Loop, Input, fire, pads } = page(); let hits = 0, keyHits = 0, padHits = 0, renderHits = 0, wheel = 0;
  Input.bind('jump', ['key: ', 'pad:0']);
  Object.assign(Loop, { autoInput: true, step: 1 / 60, update(){ if (Input.hit('jump')) hits++; if (Input.pressed(' ')) keyHits++; if (Input.padHit(0)) padHits++; wheel += Input.wheel; }, render(){ if (Input.hit('jump')) renderHits++; } });
  const pad = { connected: true, id: 'p', axes: [0, 0, 0, 0], buttons: [{ pressed: false, value: 0 }] }; pads.push(pad);
  let t = 0, presses = 0;
  for (let f = 0; f < 240; f++) {   // 120 Hz: every other frame runs no update
    if (f % 7 === 0) { fire('keydown', { key: ' ', code: 'Space' }); fire('keyup', { key: ' ', code: 'Space' }); presses++; }
    pad.buttons[0].pressed = f % 10 < 2;   // held for two frames, 24 times
    if (f % 5 === 0) fire('wheel', { deltaY: 100 });
    t = frames(Loop, 1, 1000 / 120, t);
  }
  assert.strictEqual(keyHits, presses, 'no key press lost or seen twice'); assert.strictEqual(padHits, 24); assert.strictEqual(wheel, 48); assert.ok(hits >= 24 && hits <= presses + 24);
  hits = 0; Loop.hitstop(0.1); fire('keydown', { key: ' ', code: 'Space' }); t = frames(Loop, 3, 16, t); assert.strictEqual(hits, 0);
  t = frames(Loop, 12, 16, t); assert.strictEqual(hits, 1, 'a press during a hitstop waits for the next update');
  fire('keyup', { key: ' ', code: 'Space' });
  Loop.paused = true; renderHits = 0; fire('keydown', { key: ' ', code: 'Space' }); t = frames(Loop, 5, 16, t);
  assert.strictEqual(renderHits, 1, 'paused: render sees the press once'); Loop.paused = false; hits = 0; frames(Loop, 5, 16, t); assert.strictEqual(hits, 0);
});

test('Input: keys never stick (Shift renames, Cmd, blur), text fields are left alone, blocked keys lose their default', () => {
  const { Input, keys, fire } = page();
  fire('keydown', { key: '1', code: 'Digit1' }); fire('keydown', { key: 'Shift', code: 'ShiftLeft' }); fire('keyup', { key: '!', code: 'Digit1' });
  assert.ok(!keys.has('1'), 'released under its other name'); fire('keyup', { key: 'Shift', code: 'ShiftLeft' }); assert.strictEqual(keys.size, 0);
  fire('keydown', { key: 'Meta', code: 'MetaLeft' }); fire('keydown', { key: 's', code: 'KeyS' }); fire('keyup', { key: 'Meta', code: 'MetaLeft' }); assert.strictEqual(keys.size, 0);
  fire('keydown', { key: 'A', code: 'KeyA' }); assert.ok(keys.has('a') && Input.pressed('a'));
  fire('keydown', { key: 'a', code: 'KeyA', repeat: true }); Input.endFrame(); assert.ok(keys.has('a') && !Input.pressed('a'));
  fire('blur'); assert.strictEqual(keys.size, 0);
  for (const target of [{ tagName: 'INPUT', type: 'text' }, { tagName: 'TEXTAREA' }, { tagName: 'DIV', isContentEditable: true }]) fire('keydown', { key: 'w', code: 'KeyW', target });
  assert.strictEqual(keys.size, 0); fire('keydown', { key: 'w', code: 'KeyW', target: { tagName: 'INPUT', type: 'range' } }); assert.ok(keys.has('w'));
  Input.block(['key: ', 'key:arrowup']);
  assert.ok(fire('keydown', { key: ' ', code: 'Space' })); assert.ok(fire('keydown', { key: 'ArrowUp', code: 'ArrowUp' }));
  assert.ok(!fire('keydown', { key: 'ArrowDown', code: 'ArrowDown' })); assert.ok(!fire('keydown', { key: ' ', code: 'Space', ctrlKey: true }), 'shortcuts are left alone');
  assert.ok(!fire('keydown', { key: ' ', code: 'Space', target: { tagName: 'TEXTAREA' } }), 'so is typing');
});

test('Input: pointers and buttons are tracked one by one', () => {
  const { Input, fire } = page(), P = Input.pointer;
  Input.bind('fire', ['mouse:0']); Input.bind('alt', ['mouse:2']);
  fire('pointerdown', { pointerId: 5, button: 0, pointerType: 'touch', clientX: 1, clientY: 2 }); fire('pointerdown', { pointerId: 6, button: 0, pointerType: 'touch' });
  fire('pointerup', { pointerId: 6, pointerType: 'touch' }); assert.ok(P.down && Input.down('fire'), 'the first finger is still down');
  fire('pointercancel', { pointerId: 5, pointerType: 'touch' }); assert.ok(!P.down && !Input.down('fire'), 'a cancelled touch is released');
  Input.endFrame();
  fire('pointerdown', { pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }); assert.ok(Input.hit('fire') && !Input.hit('alt'));
  fire('pointermove', { pointerId: 1, button: 2, buttons: 3, pointerType: 'mouse' }); assert.ok(Input.hit('alt') && Input.down('alt') && Input.down('fire'), 'a second button arrives as a move');
  fire('pointermove', { pointerId: 1, button: -1, buttons: 3, pointerType: 'mouse', clientX: 40, clientY: 50 }); eq([P.x, P.y], [40, 50]); assert.ok(Input.down('alt'));
  fire('pointermove', { pointerId: 1, button: 0, buttons: 2, pointerType: 'mouse' }); assert.ok(!Input.down('fire') && Input.down('alt') && P.down);
  fire('pointerup', { pointerId: 1, button: 2, buttons: 0, pointerType: 'mouse' }); assert.ok(!Input.down('alt') && !P.down);
});

test('Input: gamepad sticks get a round dead zone and presses are edges', () => {
  const { Input, pads } = page();
  const pad = { connected: true, id: 'p', axes: [0.15, 0.15, 0.7, 0.7, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) }; pads.push(pad);
  let P = Input.pollPad(); assert.ok(P.on); eq([P.lx, P.ly], [0, 0]);
  near(P.rx, P.ry); near(Math.hypot(P.rx, P.ry), (Math.hypot(0.7, 0.7) - 0.22) / 0.78);
  pad.axes = [1, 1, 0, -1]; P = Input.pollPad(); near(Math.hypot(P.lx, P.ly), 1); near(P.ry, -1); assert.strictEqual(P.rx, 0);
  pad.buttons[0].pressed = true; pad.buttons[15].pressed = true; Input.pollPad(); assert.ok(Input.padHit(0) && Input.padDown(0) && Input.padAnyHit()); assert.strictEqual(P.dx, 1);
  Input.pollPad(); assert.ok(!Input.padHit(0) && Input.padDown(0) && !Input.padAnyHit());
  pads.length = 0; P = Input.pollPad(); assert.ok(!P.on && !Input.padDown(0)); eq([P.lx, P.ly, P.dx], [0, 0, 0]);
});

test('Sprites: one cached copy per scale, sheets cut frames in rows, animations loop or play once', () => {
  const { Sprites, draws } = page(); let made = 0;
  const a = Sprites.get('k', 10, 1, () => made++), b = Sprites.get('k', 10, 1, () => made++), c = Sprites.get('k', 10, 2, () => made++);
  assert.strictEqual(a, b); assert.notStrictEqual(a, c); assert.strictEqual(made, 2); assert.strictEqual(c.cv.width, 42);
  assert.strictEqual(Sprites.get('k', 10, 1, () => made++), a); assert.strictEqual(Sprites.get('k', 10, 2, () => made++), c); assert.strictEqual(made, 2); assert.strictEqual(Sprites.map.size, 2);
  const img = { width: 72, height: 36 }, sh = Sprites.sheet(img, 16, 16, { margin: 1, spacing: 2 });   // 4 x 2 frames
  eq([sh.cols, sh.rows, sh.count], [4, 2, 8]);
  const ctx = a.cv.getContext('2d'); draws.length = 0;
  sh.draw(ctx, 5, 100, 50); eq(draws[0].slice(1), [19, 19, 16, 16, 92, 42, 16, 16]);
  sh.draw(ctx, 3, 100, 50, { w: 32, oy: 1 }); eq(draws[1].slice(1), [55, 1, 16, 16, 84, 18, 32, 32]);
  sh.draw(ctx, 0, 100, 50, { h: 8, flipX: true, alpha: 0.5 }); eq(draws[2].slice(1), [1, 1, 16, 16, -4, -4, 8, 8]); assert.strictEqual(ctx.globalAlpha, 1);
  const run = sh.anim([4, 5, 6], 10); eq(run.frame, 4); run.update(0.15); eq(run.frame, 5); run.update(0.1); eq(run.frame, 6); run.update(0.1); eq(run.frame, 4);
  run.update(3.05); eq(run.frame, 4); assert.ok(run.t < 0.3 + 1e-9, 'time wraps instead of growing');
  let ended = 0; const die = sh.anim([1, 2], 10, { loop: false, onEnd: () => ended++ });
  die.update(0.1); eq(die.frame, 2); assert.ok(!die.done); die.update(5); die.update(5); eq(die.frame, 2); assert.ok(die.done); assert.strictEqual(ended, 1);
  die.reset(); eq(die.frame, 1); assert.ok(!die.done);
  draws.length = 0; run.reset().draw(ctx, 0, 0); eq(draws[0].slice(1, 3), [1, 19]);
});

// ---- found in review of 0.3.0

test('Loop autoInput: the press that unpauses from render is not seen again, and timeScale 0 clears like a pause', () => {
  const { Loop, Input, fire } = page(), log = [];
  Object.assign(Loop, { autoInput: true, update(){ if (Input.pressed('p')) { Loop.paused = true; log.push('pause'); } }, render(){ if (Loop.paused && Input.pressed('p')) { Loop.paused = false; log.push('resume'); } } });
  const tap = () => { fire('keydown', { key: 'p', code: 'KeyP' }); fire('keyup', { key: 'p', code: 'KeyP' }); };
  let t = frames(Loop, 2, 16); tap(); t = frames(Loop, 3, 16, t); eq(log, ['pause']);   // update paused it and cleared the press
  tap(); t = frames(Loop, 5, 16, t); eq(log, ['pause', 'resume']); assert.ok(!Loop.paused);
  let seen = 0; Object.assign(Loop, { timeScale: 0, update(){}, render(){ if (Input.pressed('x')) seen++; } });
  fire('keydown', { key: 'x', code: 'KeyX' }); fire('wheel', { deltaY: 1 }); frames(Loop, 5, 16, t); assert.strictEqual(seen, 1); assert.strictEqual(Input.wheel, 0);
});

test('Input: a held key that repeats under a new name is still released; a drag is one press', () => {
  const { Input, keys, fire } = page();
  fire('keydown', { key: '1', code: 'Digit1' }); fire('keydown', { key: 'Shift', code: 'ShiftLeft' }); fire('keydown', { key: '!', code: 'Digit1', repeat: true });
  eq([...keys].sort(), ['!', 'shift']); fire('keyup', { key: '!', code: 'Digit1' }); fire('keyup', { key: 'Shift', code: 'ShiftLeft' }); assert.strictEqual(keys.size, 0);
  Input.bind('fire', ['mouse:0']);
  fire('pointerdown', { pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }); Input.endFrame();
  fire('pointermove', { pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }); assert.ok(Input.down('fire') && !Input.hit('fire'));
});

test('Bus.off with no handler removes nothing; a timer handle can have several then()s', async () => {
  const bus = new X.Bus(); let n = 0; bus.on('e', () => n++); bus.off('e', undefined); bus.emit('e'); assert.strictEqual(n, 1);
  const k = new X.Clock(), log = [], h = k.after(0.1).then(() => log.push('a')); h.then(() => log.push('b'));
  const both = Promise.all([(async () => { await h; log.push('c'); })(), (async () => { await h; log.push('d'); })()]);
  await null; await null; k.update(0.2); await both; eq(log.sort(), ['a', 'b', 'c', 'd']);
});

test('Store: clear keeps the migration version and needs a namespace; undefined removes; update() accepts in-place changes', () => {
  const s = new X.Store('rv'); let ran = 0;
  s.migrate(1, { 1: () => ran++ }); s.set('a', 1); eq(s.keys(), ['a']); s.clear(); s.migrate(1, { 1: () => ran++ }); assert.strictEqual(ran, 1);
  s.set('run', { lvl: 3 }); assert.strictEqual(s.set('run', undefined), true); eq(s.get('run', 'none'), 'none');
  s.set('stats', { runs: 1 }); eq(s.update('stats', v => { v.runs++; }), { runs: 2 }); eq(s.get('stats'), { runs: 2 });
  const bare = new X.Store(); bare.clear(); eq(s.get('stats'), { runs: 2 });
});

test('Sprites: a scale that changes every frame makes a few copies, not one per frame; a teleporting emitter leaves no streak', () => {
  const { Sprites } = page(); let made = 0;
  for (let i = 0; i < 120; i++) Sprites.get('z', 10, 1 + i / 120, () => made++);   // a zoom tween from 1x to 2x
  assert.ok(made <= 17, `made ${made}`); assert.ok(Sprites.map.size <= 17);
  const sp = Sprites.get('z', 10, 1.5, () => made++); assert.ok(sp.ds >= 1.5 && sp.ds < 1.5 * 1.045, 'never blurrier than asked, at most 4.4% larger');
  const P = new X.Particles(100); P.kind('a', { draw(){} });
  const e = P.emitter('a', { rate: 100, speed: 0, life: 10 }); P.update(0.1); e.x = 1000; P.update(0.1);
  eq([...P.x.slice(10, 20)], Array(10).fill(1000));
});
