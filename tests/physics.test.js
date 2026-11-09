'use strict';
// Collide's shape functions (overlap, sweep, ray, resolve) and the Physics world, in a Node VM like unit.test.js.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

const canvas = () => ({ getContext: () => new Proxy({}, { get: () => () => {} }), width: 0, height: 0 });
const sandbox = vm.createContext({ document: { getElementById: canvas, createElement: canvas, body: { appendChild: c => c } }, addEventListener(){}, innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, Math, Map, console });
sandbox.window = sandbox;
for (const f of ['core', 'rng', 'collide', 'spatial', 'physics']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f + '.js'), 'utf8'), sandbox, { filename: f });
vm.runInContext('this.__x = { Collide, Physics, Rng };', sandbox);
const { Collide: C, Physics, Rng } = sandbox.__x;
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const run = (w, seconds, each) => { for (let i = 0, n = Math.round(seconds * 60); i < n; i++) { w.step(1 / 60); if (each) each(i); } };
const bottom = b => b.r !== undefined ? b.y + b.r : b.y + b.h;
// A random circle, box or convex polygon near (x, y).
function shape(R, x, y, kind = R.int(0, 2)){
  if (kind === 0) return { x, y, r: R.range(2, 30) };
  if (kind === 1) return { x, y, w: R.range(3, 60), h: R.range(3, 60) };
  const n = R.int(3, 7), rx = R.range(8, 40), ry = R.range(8, 40), a0 = R.range(0, 6), pts = [], cw = R.chance(0.5);
  for (let i = 0; i < n; i++) { const a = a0 + (cw ? -i : i) / n * Math.PI * 2; pts.push(Math.cos(a) * rx, Math.sin(a) * ry); }
  return { x, y, pts };
}
const moved = (s, dx, dy) => Object.assign({}, s, { x: s.x + dx, y: s.y + dy });

test('Collide.separate: an infinite mass or a fixed thing is never moved (it used to turn positions into NaN)', () => {
  const wall = { x: 0, y: 0, r: 10, mass: Infinity }, a = { x: 12, y: 0, r: 5 };
  near(C.separate(wall, a), 3); near(wall.x, 0); near(a.x, 15);
  const post = { x: 0, y: 0, r: 10, fixed: true }, b = { x: -12, y: 0, r: 5 };
  near(C.separate(b, post), 3); near(post.x, 0); near(b.x, -15);
  const p = { x: 0, y: 0, r: 5, mass: Infinity }, q = { x: 4, y: 0, r: 5, mass: Infinity }; near(C.separate(p, q), 6); near(q.x, 4);
  const l = { x: 0, y: 0, r: 5 }, h = { x: 6, y: 0, r: 5, mass: 3 }; C.separate(l, h); near(l.x, -3); near(h.x, 7);   // as before: split by mass
});

test('Collide.overlap: depth and the way out, for every pair of shapes', () => {
  const box = { x: 0, y: 0, w: 20, h: 10 }, tri = { x: 100, y: 0, pts: [0, 0, 20, 0, 0, 20] };
  near(C.overlap({ x: 0, y: 0, r: 5 }, { x: 8, y: 0, r: 5 }), 2); assert.deepStrictEqual([C.nx, C.ny], [-1, 0]);
  assert.strictEqual(C.overlap({ x: 0, y: 0, r: 5 }, { x: 10, y: 0, r: 5 }), 0);
  near(C.overlap({ x: 10, y: -3, r: 4 }, box), 1); assert.deepStrictEqual([C.nx, C.ny], [0, -1]);
  near(C.overlap(box, { x: 10, y: -3, r: 4 }), 1); assert.deepStrictEqual([C.nx, C.ny], [0, 1]);   // the other way round: the box moves down
  near(C.overlap({ x: 2, y: 5, r: 1 }, box), 3); assert.deepStrictEqual([C.nx, C.ny], [-1, 0]);    // centre inside: out by the nearest side
  near(C.overlap({ x: 17, y: 2, w: 10, h: 10 }, box), 3); assert.deepStrictEqual([C.nx, C.ny], [1, 0]);
  near(C.overlap({ x: 5, y: 8, w: 10, h: 10 }, box), 2); assert.deepStrictEqual([C.nx, C.ny], [0, 1]);
  assert.strictEqual(C.overlap({ x: 20, y: 0, w: 5, h: 5 }, box), 0);   // touching is not overlapping
  near(C.overlap({ x: 112, y: 12, r: 3 }, tri), 3 - Math.SQRT2 * 2); near(C.nx, Math.SQRT1_2); near(C.ny, Math.SQRT1_2);   // the sloping side
  near(C.overlap({ x: 98, y: -1, r: 3 }, tri), 3 - Math.sqrt(5));   // the corner
  near(C.overlap({ x: 95, y: 5, w: 7, h: 5 }, tri), 2); assert.deepStrictEqual([C.nx, C.ny], [-1, 0]);
  assert.strictEqual(C.overlap({ x: 112, y: 12, w: 5, h: 5 }, tri), 0);
  near(C.overlap({ x: 5, y: 5, r: 0 }, box), 5); assert.strictEqual(C.overlap({ x: 25, y: 5, r: 0 }, box), 0);   // a point
  // Any shapes: moving a out by the depth along the normal just clears b, and a hair less does not.
  const R = new Rng(11); let hits = 0;
  for (let i = 0; i < 4000; i++) {
    const a = shape(R, R.range(-40, 40), R.range(-40, 40)), b = shape(R, R.range(-40, 40), R.range(-40, 40)), d = C.overlap(a, b), nx = C.nx, ny = C.ny;
    if (!d) continue; hits++;
    near(Math.hypot(nx, ny), 1, 1e-9);
    assert.strictEqual(C.overlap(moved(a, nx * (d + 1e-6), ny * (d + 1e-6)), b), 0, `still overlapping: ${JSON.stringify([a, b])}`);
    assert.ok(C.overlap(moved(a, nx * (d - 1e-6), ny * (d - 1e-6)), b) > 0);
    near(C.overlap(b, a), d, 1e-9); near(C.nx, -nx, 1e-9); near(C.ny, -ny, 1e-9);
  }
  assert.ok(hits > 1000);
});

test('Collide.sweep: the exact moment of contact, for every pair of shapes, checked against small steps', () => {
  const box = { x: 100, y: 0, w: 2, h: 100 };
  near(C.sweep({ x: 0, y: 50, r: 5 }, 1000, 0, box), 0.095); assert.deepStrictEqual([C.nx, C.ny], [-1, 0]);   // across a 2-wide wall in one move
  near(C.sweep({ x: 0, y: 40, w: 10, h: 10 }, 1000, 0, box), 0.09); assert.deepStrictEqual([C.nx, C.ny], [-1, 0]);
  assert.strictEqual(C.sweep({ x: 0, y: 50, r: 5 }, -1000, 0, box), -1);
  assert.strictEqual(C.sweep({ x: 0, y: 50, r: 5 }, 90, 0, box), -1);   // stops short
  near(C.sweep({ x: 0, y: 0, r: 5 }, 100, 0, { x: 50, y: 0, r: 5 }), 0.4);
  near(C.sweep({ x: 0, y: 0, r: 5 }, 0, 0, { x: 8, y: 0, r: 5 }), -1);
  assert.strictEqual(C.sweep({ x: 0, y: 0, r: 5 }, 10, 0, { x: 8, y: 0, r: 5 }), 0); assert.strictEqual(C.sweep({ x: 0, y: 0, r: 5 }, -10, 0, { x: 8, y: 0, r: 5 }), -1);   // overlapping: only blocked going in
  const t = C.sweep({ x: 90, y: -20, r: 5 }, 20, 40, box); assert.ok(t > 0); near(Math.hypot(90 + 20 * t - 100, -20 + 40 * t), 5);   // round a corner
  const R = new Rng(7); let hit = 0, miss = 0;
  for (let i = 0; i < 6000; i++) {
    const a = shape(R, R.range(-150, 150), R.range(-150, 150)), b = shape(R, R.range(-30, 30), R.range(-30, 30));
    const dx = R.range(-400, 400), dy = R.range(-400, 400), len = Math.hypot(dx, dy);
    if (C.overlap(a, b)) continue;
    const t = C.sweep(a, dx, dy, b), nx = C.nx, ny = C.ny, ctx = JSON.stringify([a, dx, dy, b, t]);
    if (t < 0) {
      miss++;
      for (let s = 0; s <= 400; s++) assert.ok(C.overlap(moved(a, dx * s / 400, dy * s / 400), b) < 1e-6, `missed a hit: ${ctx}`);
    } else {
      hit++;
      assert.ok(t <= 1); near(Math.hypot(nx, ny), 1, 1e-9); assert.ok(dx * nx + dy * ny < 1e-9, `normal faces the wrong way: ${ctx}`);
      const e = 1e-6 / len;
      assert.strictEqual(C.overlap(moved(a, dx * (t - e), dy * (t - e)), b), 0, `already in before t: ${ctx}`);
      if (dx * nx + dy * ny < -0.05 * len) assert.ok(C.overlap(moved(a, dx * (t + e * 100), dy * (t + e * 100)), b) > 0, `not in after t: ${ctx}`);
      for (let s = 0; s < 50; s++) assert.ok(C.overlap(moved(a, dx * t * s / 50, dy * t * s / 50), b) < 1e-6, `hit earlier than t: ${ctx}`);
    }
  }
  assert.ok(hit > 500 && miss > 500, `${hit} ${miss}`);
});

test('Collide.ray: any shape, with the normal; Collide.resolve: momentum, bounce, friction and fixed bodies', () => {
  near(C.ray(0, 0, 1, 0, { x: 10, y: 0, r: 2 }), 8); near(C.nx, -1); near(C.ny, 0);
  near(C.ray(0, 5, 1, 0, { x: 10, y: 0, w: 10, h: 10 }), 10); assert.deepStrictEqual([C.nx, C.ny], [-1, 0]);
  for (const pts of [[0, 0, 20, 0, 0, 20], [0, 0, 0, 20, 20, 0]]) {   // both windings
    const tri = { x: 100, y: 0, pts };
    near(C.ray(120, 20, -Math.SQRT1_2, -Math.SQRT1_2, tri), Math.SQRT2 * 10); near(C.nx, Math.SQRT1_2); near(C.ny, Math.SQRT1_2);
    near(C.ray(90, 5, 1, 0, tri), 10); near(C.nx, -1);
    assert.strictEqual(C.ray(90, 25, 1, 0, tri), -1); assert.strictEqual(C.ray(90, 5, -1, 0, tri), -1);
    assert.strictEqual(C.ray(105, 5, 1, 0, tri), 0);   // from inside
  }
  // Equal masses, head on, perfectly elastic: they swap velocities.
  let a = { x: 0, y: 0, r: 5, vx: 100, vy: 0 }, b = { x: 9, y: 0, r: 5, vx: -20, vy: 0 };
  near(C.resolve(a, b, 1), 1); near(a.vx, -20); near(b.vx, 100); near(b.x - a.x, 10);
  // Unequal masses, no bounce: they leave together, momentum kept.
  a = { x: 0, y: 0, w: 10, h: 10, vx: 60, vy: 0, mass: 2 }; b = { x: 9, y: 0, w: 10, h: 10, vx: 0, vy: 0, mass: 1 };
  C.resolve(a, b); near(a.vx, 40); near(b.vx, 40); near(a.vx * 2 + b.vx, 120);
  // A ball into a fixed floor at an angle: it bounces, friction takes some of the slide, the floor stays.
  const ball = { x: 0, y: -4, r: 5, vx: 100, vy: 100 }, floor = { x: -50, y: 0, w: 100, h: 10, fixed: true };
  C.resolve(ball, floor, 0.5, 0.2); near(ball.y, -5); near(ball.vy, -50); near(ball.vx, 100 - 0.2 * 150); assert.strictEqual(floor.vx, undefined); near(floor.y, 0);
  assert.strictEqual(C.resolve({ x: 0, y: 0, r: 1 }, { x: 9, y: 0, r: 1 }), 0);
  a = { x: 0, y: 0, r: 5, vx: -10, vy: 0 }; b = { x: 9, y: 0, r: 5, vx: 10, vy: 0 }; C.resolve(a, b, 1); near(a.vx, -10);   // already parting: velocities left alone
});

test('Physics: a stack of boxes comes to rest and stays put', () => {
  const w = new Physics({ gravity: 900 }), boxes = [];
  w.add({ x: -500, y: 500, w: 1000, h: 50, fixed: true });
  for (let i = 0; i < 12; i++) boxes.push(w.add({ x: i % 2 * 6, y: 500 - 42 * (i + 1), w: 40, h: 40 }));
  run(w, 5);
  const at = boxes.map(b => [b.x, b.y]);
  run(w, 5);
  boxes.forEach((b, i) => {
    near(b.x, i % 2 * 6, 1e-6); near(b.y, at[i][1], 1e-3); near(b.vy, 0, 1e-6); assert.strictEqual(b.touch & 8, 8);
    near(bottom(b), 500 - 40 * i, 0.25 * (i + 1));   // each sinks into the one below by no more than the slop
  });
});

test('Physics: a ball bounces to the height its bounce allows, a little lower each time, then rests', () => {
  for (const e of [0.5, 0.8, 1]) {
    const w = new Physics({ gravity: 900 }), ball = w.add({ x: 0, y: 100, r: 10, bounce: e }), peaks = [];
    w.add({ x: -500, y: 500, w: 1000, h: 50, fixed: true });
    let vy = 0, low = 0;
    run(w, 12, () => { if (vy < 0 && ball.vy >= 0) peaks.push(490 - ball.y); vy = ball.vy; low = Math.max(low, bottom(ball)); });
    near(peaks[0] / 390, e * e, 0.03); near(peaks[1] / peaks[0], e * e, 0.03);
    assert.ok(low < 500.3, `sank to ${low}`);
    if (e < 1) { near(bottom(ball), 500, 0.3); near(ball.vy, 0, 1e-6); } else assert.ok(peaks[5] > 300);   // a perfect bounce keeps going
  }
});

test('Physics: nothing tunnels, whatever the speed or the shapes', () => {
  const R = new Rng(3);
  for (let i = 0; i < 300; i++) {
    const w = new Physics({ gravity: i % 2 ? 900 : 0 }), speed = R.range(2000, 60000), kind = i % 3, th = R.range(0.5, 4);
    const wall = w.add(kind === 2 ? { x: 300, y: -200, pts: [0, 0, th, 0, th + 30, 400, 30, 400], fixed: true } : { x: 300, y: -200, w: th, h: 400, fixed: true });
    const b = w.add(i % 4 < 2 ? { x: R.range(-50, 50), y: R.range(-60, 60), r: R.range(1, 6), vx: speed, vy: R.range(-300, 300), bounce: R.float() }
      : { x: R.range(-50, 50), y: R.range(-60, 60), w: R.range(2, 10), h: R.range(2, 10), vx: speed, vy: R.range(-300, 300), bounce: R.float() });
    let hits = 0; b.onHit = (o, nx) => { assert.strictEqual(o, wall); assert.ok(nx < 0); hits++; };
    run(w, 0.5, () => assert.ok(b.x < 300.3 + (kind === 2 ? 30 : 0), `through the wall: ${i}`));
    assert.ok(hits >= 1, `never reported: ${i}`);
  }
  // A room with walls one unit thick: fast things thrown about inside it, bouncing off each other, all stay in.
  const room = new Physics({ gravity: 900 }), inside = [];
  for (const [x, y, w, h] of [[0, 0, 400, 1], [0, 299, 400, 1], [0, 0, 1, 300], [399, 0, 1, 300]]) room.add({ x, y, w, h, fixed: true });
  for (let i = 0; i < 30; i++) inside.push(room.add(i % 2 ? { x: R.range(20, 380), y: R.range(20, 280), r: R.range(2, 8), vx: R.range(-9000, 9000), vy: R.range(-9000, 9000), bounce: 0.9 }
    : { x: R.range(20, 370), y: R.range(20, 270), w: R.range(3, 14), h: R.range(3, 14), vx: R.range(-9000, 9000), vy: R.range(-9000, 9000), bounce: 0.9 }));
  run(room, 6, () => { for (const o of inside) assert.ok(o.x > -10 && o.x < 410 && o.y > -10 && o.y < 310, `left the room at ${o.x}, ${o.y}`); });
  // Two fast things flying at each other meet in the middle instead of swapping sides.
  const w = new Physics(), a = w.add({ x: 0, y: 0, r: 3, vx: 30000 }), b = w.add({ x: 1000, y: 1, r: 3, vx: -30000 });
  run(w, 0.2); assert.ok(a.x < b.x); near(a.vx + b.vx, 0, 1e-6);
  // A sensor bullet reports what it flew through, once.
  const w2 = new Physics(), seen = [], foe = w2.add({ x: 400, y: 0, r: 8, fixed: true }), shot = w2.add({ x: 0, y: 0, r: 2, vx: 50000, sensor: true });
  shot.onHit = o => seen.push(o); run(w2, 0.1); assert.deepStrictEqual(seen, [foe]); assert.ok(shot.x > 4000);
});

test('Physics: a floor or a wall built from tiles is smooth: nothing catches or hops on the seams', () => {
  const w = new Physics({ gravity: 900 });
  for (let i = 0; i < 60; i++) w.add({ x: i * 32, y: 100, w: 32, h: 32, fixed: true });
  const box = w.add({ x: 10, y: 60, w: 20, h: 30, friction: 0 }), ball = w.add({ x: 50, y: 80, r: 10, friction: 0, bounce: 0.9 }), puck = w.add({ x: 90, y: 60, r: 10, friction: 0 });
  run(w, 6); box.vx = ball.vx = puck.vx = 250;
  run(w, 5, () => { for (const b of [box, ball, puck]) { near(b.vx, 250, 1e-6); near(bottom(b), 100, 0.25); assert.strictEqual(b.touch, 8); } });
  assert.ok(box.x > 1200);
  // Sliding down a wall of tiles while pressed against it.
  const w2 = new Physics({ gravity: 900 });
  for (let i = 0; i < 60; i++) w2.add({ x: 0, y: i * 32, w: 32, h: 32, fixed: true });
  const crate = w2.add({ x: 40, y: 0, w: 20, h: 20, friction: 0 }), orb = w2.add({ x: 45, y: 100, r: 10, friction: 0 });
  let t = 0; run(w2, 1.5, () => { crate.vx = orb.vx = -100; t += 1 / 60; for (const b of [crate, orb]) { near(b.vy, 900 * t, 1e-6); if (t > 0.2) assert.strictEqual(b.touch, 1); } });
  near(crate.x, 32, 0.25); near(orb.x, 42, 0.25);
});

test('Physics: one-way platforms hold what lands on them and let everything else through', () => {
  const w = new Physics({ gravity: 900 });
  w.add({ x: -400, y: 300, w: 800, h: 20, fixed: true });
  const plat = w.add({ x: -100, y: 200, w: 200, h: 8, fixed: true, oneWay: true });
  const p = w.add({ x: -10, y: 260, w: 20, h: 40 }), ball = w.add({ x: 60, y: 285, r: 10 });
  run(w, 0.5); assert.strictEqual(p.touch, 8); near(bottom(p), 300, 0.25);
  p.vy = ball.vy = -620; let top = 1e9;   // jump: up through the platform from below...
  run(w, 2, () => { top = Math.min(top, p.y); });
  assert.ok(top < 150, `blocked from below at ${top}`);
  near(bottom(p), 200, 0.25); near(bottom(ball), 200, 0.25); assert.strictEqual(p.touch, 8);   // ...and land on it
  ball.dead = true; run(w, 1.4, () => { p.vx = 150; }); near(bottom(p), 300, 0.25); assert.ok(p.x > 100);   // walk off the end, fall to the floor
  run(w, 2, () => { p.vx = -150; }); near(bottom(p), 300, 0.25); assert.ok(p.x < -50, `stopped by the side of the platform at ${p.x}`);   // and walk back under it
  // A heavy pile on a one-way platform does not leak through it.
  const pile = []; for (let i = 0; i < 8; i++) pile.push(w.add({ x: 20, y: 150 - i * 32, w: 30, h: 30, mass: 5 }));
  run(w, 4); pile.forEach((b, i) => near(bottom(b), 200 - i * 30, 0.25 * (i + 1)));
});

test('Physics: begin and end events, onHit normals, sensors, and bodies that leave or come back', () => {
  const w = new Physics({ gravity: 900 }), log = [];
  const floor = w.add({ x: -200, y: 100, w: 900, h: 20, fixed: true, name: 'floor' });
  const zone = w.add({ x: 50, y: 40, w: 40, h: 60, fixed: true, sensor: true, name: 'zone' });
  const p = w.add({ x: 0, y: 0, w: 20, h: 20, friction: 0, name: 'p' });
  w.onBegin = (a, b, nx, ny, sp) => log.push(`+${a.name}/${b.name}`); w.onEnd = (a, b) => log.push(`-${a.name}/${b.name}`);
  let hit = null; p.onHit = (o, nx, ny, sp) => { if (o === floor) hit = [nx, ny, sp]; };
  const inZone = []; zone.onHit = o => inZone.push('in'); zone.onLeave = o => inZone.push('out');
  run(w, 1);
  assert.deepStrictEqual(log, ['+floor/p']); assert.deepStrictEqual([hit[0], hit[1]], [0, -1]); near(hit[2], Math.sqrt(2 * 900 * 80), 20);   // landed: told once, with the speed
  p.vx = 120; run(w, 2);   // slides through the zone and out the other side; resting on the floor all the while
  assert.deepStrictEqual(log, ['+floor/p', '+zone/p', '-zone/p']); assert.deepStrictEqual(inZone, ['in', 'out']);
  near(p.vx, 120, 1e-6);   // the sensor did not push
  p.vy = -300; run(w, 2); assert.deepStrictEqual(log.slice(3), ['-floor/p', '+floor/p']);   // a hop: leaves and lands again
  // Handlers may remove and add bodies. A body that is taken out and put straight back counts as new.
  const w2 = new Physics(), foe = w2.add({ x: 30, y: 0, r: 10, fixed: true }), shot = w2.add({ x: 0, y: 0, r: 3, vx: 600, sensor: true });
  let n = 0, ends = 0; w2.onEnd = () => ends++;
  shot.onHit = () => { n++; w2.remove(shot); shot.x = 25; if (n < 3) w2.add(shot); w2.add({ x: 500 + n * 10, y: 500, r: 1 }); };
  run(w2, 0.5); assert.strictEqual(n, 3); assert.strictEqual(ends, 3); assert.strictEqual(w2.bodies.length, 4);
  foe.dead = true; w2.step(1 / 60); assert.ok(!w2.bodies.includes(foe)); assert.strictEqual(foe._pid, 0);
  // Ids start again after sixty million; pairs that are touching carry on without a second begin.
  const w3 = new Physics({ gravity: 900 }), seen = []; w3.add({ x: -100, y: 50, w: 200, h: 10, fixed: true });
  const gone = w3.add({ x: -50, y: 30, w: 20, h: 20 }), a = w3.add({ x: 0, y: 30, w: 20, h: 20 }), b = w3.add({ x: 0, y: 5, w: 20, h: 20 });
  w3.onBegin = (p, q) => seen.push('+'); w3.onEnd = () => seen.push('-');
  run(w3, 1); assert.deepStrictEqual(seen, ['+', '+', '+']);
  w3.remove(gone); w3._id = 6e7 + 1; run(w3, 1);
  assert.deepStrictEqual(seen, ['+', '+', '+', '-']); assert.ok(w3._id < 10); near(bottom(b), 30, 0.5); near(b.vy, 0, 1e-6);
});

test('Physics: layers, masks and filter decide who meets; mass decides who gives way', () => {
  const w = new Physics();
  const a = w.add({ x: 0, y: 0, r: 5, vx: 100, layer: 1, mask: 2 }), b = w.add({ x: 30, y: 0, r: 5, layer: 2, mask: 2 });   // b's mask leaves out a's layer
  const c = w.add({ x: 60, y: 0, r: 5, layer: 2 }), d = w.add({ x: 200, y: 0, r: 5, layer: 2 });
  w.filter = (p, q) => p !== d && q !== d;
  run(w, 3); near(b.x, 30); assert.ok(c.x > 60); assert.ok(a.x < c.x); near(d.x, 200);
  // A heavy thing shoves a light one and hardly slows; momentum is kept.
  const w2 = new Physics(), big = w2.add({ x: 0, y: 0, r: 20, vx: 100, mass: 50 }), small = w2.add({ x: 60, y: 0, r: 5 });
  run(w2, 1); near(big.vx * 50 + small.vx, 5000, 1e-6); assert.ok(big.vx > 97 && small.vx >= big.vx - 1e-9);
  // Pushing against a wall: the wall holds.
  const w3 = new Physics(), wall = w3.add({ x: 50, y: -50, w: 10, h: 100, fixed: true }), me = w3.add({ x: 0, y: 0, w: 20, h: 20 }), crate = w3.add({ x: 25, y: 0, w: 20, h: 20 });
  run(w3, 2, () => { me.vx = 200; }); near(crate.x, 30, 0.25); near(me.x, 10, 0.5); near(wall.x, 50); assert.strictEqual(crate.touch, 3); assert.strictEqual(me.touch, 2);
});

test('Physics: moving platforms carry their riders; friction holds a box on a slope; drag and gravityScale', () => {
  const w = new Physics({ gravity: 900 });
  const plat = w.add({ x: 0, y: 100, w: 100, h: 10, fixed: true, vx: 60 }), rider = w.add({ x: 40, y: 70, w: 20, h: 30, friction: 1 }), ice = w.add({ x: 10, y: 80, w: 20, h: 20, friction: 0 });
  run(w, 1); near(plat.x, 60, 1e-6); near(rider.vx, 60, 1e-6); near(rider.x, 100, 5); assert.ok(ice.x < 20);   // the frictionless one is left behind
  plat.vx = 0; plat.vy = -80; run(w, 1); near(bottom(rider), plat.y, 0.3); near(plat.y, 20, 1e-6);   // and a lift takes it up
  // A 20 degree slope: a grippy box stays where it is put, an icy one slides off.
  const w2 = new Physics({ gravity: 900 }); w2.add({ x: 0, y: 200, pts: [0, 0, 400, 146, 0, 146], fixed: true });
  const grip = w2.add({ x: 100, y: 0, w: 20, h: 20, friction: 1 }), slick = w2.add({ x: 200, y: 0, w: 20, h: 20, friction: 0 });
  run(w2, 1.5); const gx = grip.x; run(w2, 1.5); near(grip.x, gx, 0.01); near(grip.vx, 0, 1e-3); assert.ok(slick.x > 380 && slick.vx > 200);
  // Drag slows; gravityScale 0 floats.
  const w3 = new Physics({ gravity: 900 }), f = w3.add({ x: 0, y: 0, r: 5, vx: 100, gravityScale: 0, drag: 1 });
  run(w3, 1); near(f.y, 0); near(f.vx, 100 / Math.E, 0.01);
});

test('Physics: raycast, query, walls, remove, clear, and bad numbers do no harm', () => {
  const w = new Physics();
  const a = w.add({ x: 100, y: 0, r: 10 }), b = w.add({ x: 200, y: -20, w: 20, h: 40 }), tri = w.add({ x: 300, y: -10, pts: [0, 0, 20, 10, 0, 20] });
  assert.strictEqual(w.raycast(0, 0, 1, 0), a); near(w.dist, 90); near(C.nx, -1);
  assert.strictEqual(w.raycast(0, 0, 1, 0, Infinity, o => o !== a), b); near(w.dist, 200);
  assert.strictEqual(w.raycast(250, 0, 1, 0), tri); near(w.dist, 50);
  assert.strictEqual(w.raycast(0, 0, 1, 0, 50), null); assert.strictEqual(w.dist, -1); assert.strictEqual(w.raycast(0, 0, -1, 0), null);
  assert.deepStrictEqual([...w.query({ x: 150, y: 0, r: 55 })].sort((p, q) => p.x - q.x), [a, b]); assert.strictEqual(w.query({ x: 210, y: 0, r: 0 })[0], b);
  assert.strictEqual(w.query(a).length, 0);   // never itself
  w.remove(a); assert.strictEqual(w.raycast(0, 0, 1, 0), b); assert.strictEqual(w.add(b), b); assert.strictEqual(w.bodies.length, 2);   // adding twice is harmless
  w.clear(); assert.strictEqual(w.bodies.length, 0); assert.strictEqual(w.raycast(0, 0, 1, 0), null);
  const walls = w.walls({ x: 0, y: 0, w: 300, h: 200 }), R = new Rng(9), balls = [];
  assert.strictEqual(walls.length, 4);
  for (let i = 0; i < 12; i++) balls.push(w.add({ x: R.range(20, 280), y: R.range(20, 180), r: R.range(4, 9), vx: R.range(-900, 900), vy: R.range(-900, 900), bounce: 1, friction: 0 }));
  const energy = () => balls.reduce((s, o) => s + o.vx * o.vx + o.vy * o.vy, 0), e0 = energy();
  run(w, 10, () => { for (const o of balls) assert.ok(o.x > -0.5 && o.x < 300.5 && o.y > -0.5 && o.y < 200.5, 'out of the box'); });
  near(energy() / e0, 1, 0.02);   // perfectly bouncy balls in a box keep their energy
  const bad = w.add({ x: NaN, y: 0, r: 5 }), wild = w.add({ x: 50, y: 50, r: 5, vx: Infinity }), odd = w.add({ x: 150, y: 100, r: 5, mass: -3 });
  w.step(1 / 60); w.step(0); w.step(-1); w.step(NaN); assert.ok(Number.isNaN(bad.x));
  run(w, 1); for (const o of [...balls, odd]) assert.ok(Number.isFinite(o.x + o.y + o.vx + o.vy) && o.x > -0.5 && o.x < 300.5, 'a broken body spoiled another');
});

test('Physics: the same start gives the same result, to the last bit; substeps agree; a crowd is pushed apart', () => {
  const make = (opts) => {
    const w = new Physics(Object.assign({ gravity: 900 }, opts)), R = new Rng(21), all = [];
    w.walls({ x: 0, y: -2000, w: 400, h: 2400 });
    for (let i = 0; i < 120; i++) all.push(w.add(i % 3 ? { x: R.range(20, 380), y: R.range(-600, 380), r: R.range(5, 12), bounce: 0.3 } : { x: R.range(20, 360), y: R.range(-600, 360), w: R.range(10, 30), h: R.range(10, 30) }));
    return { w, all };
  };
  const one = make(), two = make(); run(one.w, 6); run(two.w, 6);
  assert.deepStrictEqual(one.all.map(o => [o.x, o.y, o.vx, o.vy]), two.all.map(o => [o.x, o.y, o.vx, o.vy]));
  for (const { w, all } of [one, make({ substeps: 3 })]) {
    run(w, 6);
    let worst = 0; for (const p of all) { assert.ok(bottom(p) < 400.5 && p.x > -15 && p.x < 415); assert.ok(Math.hypot(p.vx, p.vy) < 5, 'still moving'); for (const q of all) if (p !== q) worst = Math.max(worst, C.overlap(p, q)); }
    assert.ok(worst < 0.5, `overlap ${worst}`);
  }
  // Top-down: 400 circles all heading for one spot end up packed round it, not on top of each other.
  const w = new Physics(), R = new Rng(2), mob = [];
  for (let i = 0; i < 400; i++) mob.push(w.add({ x: R.range(-400, 400), y: R.range(-400, 400), r: R.range(6, 12) }));
  run(w, 8, () => { for (const m of mob) { const d = Math.hypot(m.x, m.y) || 1; m.vx = -m.x / d * 80; m.vy = -m.y / d * 80; } });
  let worst = 0; for (const p of mob) for (const q of mob) if (p !== q) worst = Math.max(worst, C.overlap(p, q));
  assert.ok(worst < 3, `overlap ${worst}`); assert.ok(Math.max(...mob.map(m => Math.hypot(m.x, m.y))) < 260);
});

test('Physics: polygons with repeated or in-line points are solid, and polygons cross tile seams and ramp feet too', () => {
  // Points along a straight side, and a first point written again at the end: both common in hand-made outlines.
  const mid = { x: 0, y: 0, pts: [0, 0, 10, 0, 20, 0, 20, 10, 0, 10] }, closed = { x: 0, y: 0, pts: [0, 0, 40, 0, 0, 40, 0, 0] };
  for (const x of [2, 5, 10, 12, 15, 18]) { near(C.overlap({ x, y: -3, r: 5 }, mid), 2); assert.deepStrictEqual([C.nx, C.ny], [0, -1]); }
  near(C.overlap({ x: 5, y: 5, w: 5, h: 5 }, closed), 10); near(C.overlap({ x: 5, y: 5, r: 3 }, closed), 8); near(Math.hypot(C.nx, C.ny), 1);
  near(C.sweep({ x: 5, y: -20, w: 5, h: 5 }, 0, 40, closed), 0.375); near(C.ray(5, -20, 0, 1, closed), 20);
  const w = new Physics({ gravity: 900 }), R = new Rng(4), all = [];
  w.add({ x: 0, y: 300, pts: [0, 0, 100, 0, 200, 0, 300, 0, 300, 40, 0, 40, 0, 0], fixed: true });
  for (let i = 0; i < 60; i++) all.push(w.add(i % 3 === 0 ? { x: 20 + i % 10 * 27, y: 250 - (i / 10 | 0) * 30, w: 12, h: 12 } : i % 3 === 1 ? { x: 20 + i % 10 * 27, y: 250 - (i / 10 | 0) * 30, r: R.range(4, 12), mass: R.range(1, 5) } : { x: 20 + i % 10 * 27, y: 250 - (i / 10 | 0) * 30, pts: [0, 0, 12, 0, 6, -10] }));
  run(w, 4, () => { for (const o of all) assert.ok(o.y < 310, 'fell through the floor'); });
  // A polygon body over box tiles, and a box over a floor of box and polygon tiles in turn: neither catches.
  const w2 = new Physics({ gravity: 900 });
  for (let i = 0; i < 60; i++) w2.add(i % 2 ? { x: i * 32, y: 100, w: 32, h: 32, fixed: true } : { x: i * 32, y: 100, pts: [0, 0, 32, 0, 32, 32, 0, 32], fixed: true });
  const poly = w2.add({ x: 10, y: 100, pts: [0, 0, 24, 0, 24, -36, 0, -36], friction: 0 }), box = w2.add({ x: 60, y: 70, w: 20, h: 30, friction: 0 });
  run(w2, 1); poly.vx = box.vx = 250;
  run(w2, 5, () => { near(poly.vx, 250, 1e-6); near(box.vx, 250, 1e-6); near(box.y + 30, 100, 0.25); near(poly.y, 100, 0.25); });
  // Walking into the foot of a ramp that stands on the floor, wherever the ramp is: up it goes.
  for (let rx = 380; rx < 560; rx += 4) {
    const w3 = new Physics({ gravity: 1500 }); w3.add({ x: 0, y: 400, w: 1200, h: 40, fixed: true }); w3.add({ x: rx, y: 360, pts: [0, 40, 80, 0, 80, 40], fixed: true }); w3.add({ x: rx + 80, y: 360, w: 900, h: 40, fixed: true });
    const p = w3.add({ x: 200, y: 364, w: 24, h: 36, friction: 0 });
    run(w3, 3, () => { p.vx = 260; }); assert.ok(p.x > rx + 100 && p.y < 330, `stuck at ${p.x}, ${p.y} with the ramp at ${rx}`);
  }
});

test('Physics: leave comes before the hit of a body put straight back; a body moves between worlds; layer 0 meets nothing', () => {
  const w = new Physics({ gravity: 900 }), log = []; w.add({ x: -100, y: 100, w: 200, h: 20, fixed: true });
  const p = w.add({ x: 0, y: 80, w: 20, h: 20, onHit(){ log.push('hit'); }, onLeave(){ log.push('leave'); } });
  run(w, 0.5); assert.deepStrictEqual(log, ['hit']);
  w.remove(p); w.add(p); run(w, 0.2); assert.deepStrictEqual(log, ['hit', 'leave', 'hit']); assert.strictEqual(p.touch, 8);
  const next = new Physics({ gravity: 900 }); next.add({ x: -100, y: 100, w: 200, h: 20, fixed: true });   // the next level, the old world just dropped
  p.y = 0; assert.strictEqual(next.add(p), p); assert.ok(next.bodies.includes(p)); run(next, 1); near(p.y + 20, 100, 0.25);
  const w2 = new Physics(), ghost = w2.add({ x: 0, y: 0, r: 5, vx: 200, layer: 0 }); w2.add({ x: 100, y: -50, w: 10, h: 100, fixed: true });
  run(w2, 1); near(ghost.x, 200, 1e-6);
});
