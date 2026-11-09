'use strict';
// Engine modules loaded straight from src/*.js into a Node VM (no browser), one script per file like <script> tags.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

function load(files, names){
  const canvas = { getContext: () => ({}), width: 0, height: 0 };
  const mem = new Map();
  const ctx = vm.createContext({
    document: { getElementById: () => canvas, addEventListener(){}, createElement: () => canvas, body: { appendChild: c => c } }, addEventListener(){}, innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
    localStorage: { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) },
    performance: { now: () => Date.now() }, Math, Map, Set, console, Float32Array, Uint8Array, Uint32Array, Error, JSON, Object, Array, Number, String,
  });
  ctx.window = ctx;
  // One script per file, like <script> tags: they share top-level const / let / class, which the last script hands back.
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  vm.runInContext(`this.__x = { ${names.join(', ')} };`, ctx);
  return ctx.__x;
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
