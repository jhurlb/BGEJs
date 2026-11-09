'use strict';
// Tilemap, Txt and scene transitions in a Node VM, like unit.test.js. The canvas records what is drawn on it.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

const calls = [];   // every fillText / strokeText / fillRect / drawImage, with the fill colour at the time
const mkCtx = () => { const st = { globalAlpha: 1, font: '', fillStyle: '', strokeStyle: '' }; return new Proxy(st, {
  get: (t, k) => k in t ? t[k] : k === 'measureText' ? s => ({ width: s.length * parseFloat(/(\d+(\.\d+)?)px/.exec(t.font)[1]) / 2 })   // every letter is half its size wide
    : ['fillText', 'strokeText', 'fillRect', 'drawImage'].includes(k) ? (...a) => { calls.push({ k, a, fill: t.fillStyle, stroke: t.strokeStyle, alpha: t.globalAlpha, font: t.font }); } : () => {},
  set: (t, k, v) => { t[k] = v; return true; } }); };
const mkCanvas = () => ({ getContext: mkCtx, width: 0, height: 0 });
const sandbox = vm.createContext({ document: { getElementById: mkCanvas, createElement: mkCanvas, body: { appendChild: c => c } }, addEventListener(){}, innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, Math, Map, console,
  atob: s => Buffer.from(s, 'base64').toString('latin1') });
sandbox.window = sandbox;
for (const f of ['core', 'rng', 'scenes', 'collide', 'spatial', 'physics', 'sprites', 'tilemap', 'text']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f + '.js'), 'utf8'), sandbox, { filename: f });
vm.runInContext('this.__x = { Tilemap, Txt, Scenes, Physics, Collide, ctx };', sandbox);
const { Tilemap, Txt, Scenes, Physics, Collide, ctx } = sandbox.__x;
const eq = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b, msg);
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const ROOM = ['#########',
              '#P..#...#',
              '#...#.G.#',
              '#.......#',
              '#########'];
const room = () => Tilemap.from(ROOM, 10, { '#': 1 });

test('Tilemap: cells, world positions, layers, marks and bounds', () => {
  const m = room();
  eq([m.cols, m.rows, m.w, m.h], [9, 5, 90, 50]); eq(m.bounds, { x0: 0, y0: 0, x1: 90, y1: 50 });
  eq(m.marks.P, [{ x: 15, y: 15, cx: 1, cy: 1 }]); eq(m.marks.G[0], { x: 65, y: 25, cx: 6, cy: 2 });
  eq([m.get(0, 0), m.get(1, 1), m.get(-1, 0), m.get(99, 0), m.at(45, 15), m.at(45, 35)], [1, 0, 0, 0, 1, 0]);
  m.set(1, 1, 7).set(-5, 2, 9); assert.strictEqual(m.get(1, 1), 7);
  const back = m.layer('back'); assert.strictEqual(m.layer('back'), back); m.fill(0, 0, 2, 2, 3, 'back');
  eq([m.get(1, 1, 'back'), m.get(1, 1, 1), m.get(2, 2, back), m.get(0, 0)], [3, 3, 0, 1]);
  assert.throws(() => m.get(0, 0, 'nope'), /unknown layer "nope"/);
  const off = Tilemap.from(['#.'], 10, { '#': 1 }, { x: 100, y: -20 });
  eq([off.at(105, -15), off.at(115, -15), off.cx(100), off.cx(99.9), off.cy(-20)], [1, 0, 0, -1, 0]);
});

test('Tilemap.solid: every tile but 0 unless a def says otherwise', () => {
  const m = new Tilemap(4, 1, 10);
  m.def(2, { solid: false }).def(3, { oneWay: true }).def(4, { color: '#f00' }).def(5, { oneWay: true, solid: true });
  eq([0, 1, 2, 3, 4, 5].map(id => m.solid(id)), [false, true, false, false, true, true]);
  m.set(0, 0, 1); eq([m.blocked(5, 5), m.blocked(15, 5), m.blocked(-5, 5)], [true, false, false]);
  m.edge = true; assert.strictEqual(m.blocked(-5, 5), true);
  assert.strictEqual(m.def(4).color, '#f00');
});

test('Tilemap.move stops at walls on each side, slides along them, and no speed skips one', () => {
  const m = room(), o = { x: 12, y: 12, w: 6, h: 6 };
  assert.strictEqual(m.move(o, 5000, 0), 2); eq(o, { x: 34, y: 12, w: 6, h: 6 });        // the pillar at x 40, not the far wall
  assert.strictEqual(m.move(o, -5000, 0), 1); assert.strictEqual(o.x, 10);
  assert.strictEqual(m.move(o, 0, -5000), 4); assert.strictEqual(o.y, 10);
  assert.strictEqual(m.move(o, 3, 5000), 8); eq([o.x, o.y], [13, 34]);
  assert.strictEqual(m.move(o, 4, 4), 8); eq([o.x, o.y], [17, 34]);                       // pressed on the floor, still slides
  assert.strictEqual(m.move(o, -900, -900), 5); eq([o.x, o.y], [10, 10]);                 // into a corner: both sides
  assert.strictEqual(m.move(o, 2.5, 1.5), 0); eq([o.x, o.y], [12.5, 11.5]);
  const ball = { x: 15, y: 35, r: 4 };                                                     // a circle moves as its square
  assert.strictEqual(m.move(ball, 0, 50), 8); eq([ball.x, ball.y], [15, 36]);
  // resting exactly against a wall never snags the other axis
  const p = { x: 10, y: 34, w: 6, h: 6 }; for (let i = 0; i < 20; i++) m.move(p, 1.3, 0.7); near(p.x, 36); assert.strictEqual(p.y, 34);
});

test('Tilemap.move: one-way tiles are landed on from above only', () => {
  const m = Tilemap.from(['....', '.==.', '....', '####'], 10, { '#': 1, '=': 2 }); m.def(2, { oneWay: true });
  const o = { x: 12, y: 0, w: 6, h: 4 };
  assert.strictEqual(m.move(o, 0, 30), 8); assert.strictEqual(o.y, 6);                    // lands on the platform
  assert.strictEqual(m.move(o, 0, 30, true), 8); assert.strictEqual(o.y, 26);             // drops through when asked, down to the floor
  assert.strictEqual(m.move(o, 0, -22), 0); assert.strictEqual(o.y, 4);                   // and jumps up through it
  o.y = 13; assert.strictEqual(m.move(o, 30, 0), 0);                                      // and walks through it sideways
  assert.strictEqual(m.move(o, 0, 2), 0);                                                 // already inside it: not caught
});

test('Tilemap.addTo: walls become a few big bodies, platforms and slopes their own, and Physics stands on them', () => {
  const m = room(), w = new Physics({ gravity: 900 });
  eq(m.addTo(w, { friction: 0.7 }).map(b => [b.x, b.y, b.w, b.h]), [[0, 0, 90, 10], [0, 10, 10, 30], [40, 10, 10, 20], [80, 10, 10, 30], [0, 40, 90, 10]]);   // 26 tiles, 5 boxes
  assert.ok(m.bodies.every(b => b.fixed && b.tile === 1 && b.friction === 0.7)); assert.strictEqual(w.bodies.length, 5);
  const ball = w.add({ x: 25, y: 15, r: 3 }); for (let i = 0; i < 120; i++) w.step(1 / 60);
  near(ball.y, 37, 0.3); assert.ok(ball.touch & 8);
  m.set(4, 3, 1); m.addTo(w); assert.strictEqual(w.bodies.length, 6); assert.strictEqual(m.bodies.length, 5);   // again after an edit: the old ones are taken out
  eq(m.bodies.map(b => b.h), [10, 30, 30, 30, 10]);
  m.removeFrom(); eq([w.bodies.length, m.bodies.length], [1, 0]);

  const k = Tilemap.from(['.==.', '=/#B', '####'], 10, { '#': 1, '=': 2, '/': 3, 'B': 4 }), w2 = new Physics();
  k.def(2, { oneWay: true, h: 0.3 }).def(3, { pts: [0, 1, 1, 0, 1, 1] }).def(4, { body: { bounce: 1 } });
  const got = k.addTo(w2).map(b => b.pts ? ['poly', b.x, b.y, ...b.pts] : [b.oneWay ? 'oneWay' : b.bounce ? 'bouncy' : 'box', b.x, b.y, b.w, b.h]);
  k.def(5, { pts: [0, 1, 1, 0, 1, 1], solid: false }).set(0, 0, 5); assert.strictEqual(k.addTo(w2).length, 6); k.set(0, 0, 0);   // a tile that is not solid makes no body, whatever its shape
  eq(got, [['oneWay', 10, 0, 20, 3], ['oneWay', 0, 10, 10, 3], ['poly', 10, 10, 0, 10, 10, 0, 10, 10], ['box', 20, 10, 10, 10], ['bouncy', 30, 10, 10, 10], ['box', 0, 20, 40, 10]]);
});

test('Tilemap.raycast: from inside, from outside, along walls, with max, and the normal of what it hit', () => {
  const m = room();
  near(m.raycast(15, 15, 1, 0), 25); eq(m.hit, { cx: 4, cy: 1, id: 1 }); eq([Collide.nx, Collide.ny], [-1, 0]); assert.strictEqual(m.dist, 25);
  near(m.raycast(15, 15, 0, 1), 25); eq([m.hit.cy, Collide.ny], [4, -1]);
  near(m.raycast(15, 15, -1, 0), 5); eq(Collide.nx, 1);
  const d = Math.SQRT1_2; near(m.raycast(15, 15, d, d), 25 / d, 1e-9); eq([m.hit.cx, m.hit.cy], [3, 4]);   // down the diagonal to the floor
  assert.strictEqual(m.raycast(15, 15, 1, 0, 20), -1); assert.strictEqual(m.dist, -1);
  near(m.raycast(15, 15, 1, 0, 25), 25);
  assert.strictEqual(m.raycast(5, 5, 1, 0), 0);                                           // starts in a wall
  near(m.raycast(-50, 25, 1, 0), 50); eq([m.hit.cx, Collide.nx], [0, -1]);                // from outside, into the rim
  assert.strictEqual(m.raycast(-50, 25, -1, 0), -1); assert.strictEqual(m.raycast(-50, -50, 1, 0), -1);
  const open = Tilemap.from(['...', '..#'], 10, { '#': 1 });
  assert.strictEqual(open.raycast(-5, 5, 1, 0), -1);                                      // through and out the other side
  near(open.raycast(-5, 15, 1, 0), 25); near(open.raycast(25, -30, 0, 1), 40); eq([open.hit.cx, open.hit.cy, Collide.ny], [2, 1, -1]);
  near(open.raycast(35, 5, -1, 0, 100), -1); open.edge = true; near(open.raycast(5, 5, -1, 0), 5);   // edge: the outside is solid
  // against brute force: march the ray in tiny steps
  const big = new Tilemap(20, 20, 10); let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 90; i++) big.set(Math.floor(rnd() * 20), Math.floor(rnd() * 20), 1);
  for (let i = 0; i < 300; i++) {
    const ox = rnd() * 200, oy = rnd() * 200, a = rnd() * 7, dx = Math.cos(a), dy = Math.sin(a); if (big.blocked(ox, oy)) continue;
    const got = big.raycast(ox, oy, dx, dy, 150), end = got < 0 ? 150 : got;
    for (let t = 0; t < end - 0.01; t += 0.05) assert.ok(!big.blocked(ox + dx * t, oy + dy * t), `ray ${i} passed through a wall at ${t}, and went on to ${got}`);
    if (got >= 0) assert.ok(big.blocked(ox + dx * (got + 1e-6), oy + dy * (got + 1e-6)), `ray ${i} stopped at ${got}, where there is no wall`);   // (a march alone can step over a clipped corner)
  }
});

test('Tilemap.sees and path: round walls, never through a corner, dearer tiles avoided, null when there is no way', () => {
  const m = room();
  eq([m.sees(15, 15, 35, 35), m.sees(15, 15, 65, 15), m.sees(15, 35, 75, 35), m.sees(15, 15, 15, 15)], [true, false, true, true]);
  eq(m.path(15, 15, 65, 25), [{ x: 25, y: 25 }, { x: 35, y: 35 }, { x: 45, y: 35 }, { x: 55, y: 35 }, { x: 65, y: 25 }]);
  eq(m.path(15, 15, 65, 25, { diagonal: false }).length, 8);
  eq(m.path(15, 15, 18, 12), []);                                                         // already there
  eq([m.path(15, 15, 45, 15), m.path(15, 15, 500, 15), m.path(15, 15, 65, 25, { max: 3 })], [null, null, null]);   // into a wall, off the map, too far to look
  const walled = Tilemap.from(['..#..', '..#..'], 10, { '#': 1 }); assert.strictEqual(walled.path(5, 5, 45, 5), null);
  const gap = Tilemap.from(['.#', '#.'], 10, { '#': 1 }); assert.strictEqual(gap.path(5, 5, 15, 15), null);   // no squeezing between two corners
  const bog = Tilemap.from(['.....', '.~~~.', '.....'], 10, { '~': 2 }); bog.def(2, { solid: false });
  const cost = id => id === 2 ? 5 : 1, ys = p => p.map(q => q.y);
  eq(ys(bog.path(5, 15, 45, 15)), [15, 15, 15, 15]);                                       // straight through the mud
  assert.ok(!ys(bog.path(5, 15, 45, 15, { cost })).slice(0, -1).includes(15));            // round it when mud is dear
  assert.strictEqual(bog.path(5, 15, 25, 15, { cost: id => id === 2 ? Infinity : 1 }), null);
  eq(ys(bog.path(5, 15, 45, 15, { diagonal: false, cost: (id, cx, cy) => cy === 0 ? 0.1 : 1 })), [15, 15, 15, 15]);   // nothing is cheaper than plain ground: a cost under 1 is 1
  // every step of a long path is to a neighbour and never into a wall, and it is as short as breadth-first search says
  const big = new Tilemap(30, 30, 10); let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 260; i++) big.set(1 + Math.floor(rnd() * 28), Math.floor(rnd() * 30), 1);
  const p = big.path(5, 5, 295, 295, { diagonal: false }); assert.ok(p && p.length);
  let px = 5, py = 5; for (const q of p) { near(Math.abs(q.x - px) + Math.abs(q.y - py), 10); assert.ok(!big.blocked(q.x, q.y)); px = q.x; py = q.y; }
  const dist = new Map([[0, 0]]), todo = [0]; for (let h = 0; h < todo.length; h++) { const c = todo[h], x = c % 30, y = (c / 30) | 0; for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const qx = x + ox, qy = y + oy, q = qy * 30 + qx; if (qx >= 0 && qy >= 0 && qx < 30 && qy < 30 && !big.get(qx, qy) && !dist.has(q)) { dist.set(q, dist.get(c) + 1); todo.push(q); } } }
  assert.strictEqual(p.length, dist.get(899));
});

test('Tilemap.draw: only tiles in view, per layer, by sheet frame, colour, paint or the tile\'s own draw; prerender stamps and redraws what changed', () => {
  const m = new Tilemap(40, 40, 10); m.fill(0, 0, 40, 40, 1); m.set(2, 2, 0); m.def(3, { color: '#f00' });
  calls.length = 0; m.draw(ctx, { x0: 15, y0: 15, x1: 44, y1: 34 }); assert.strictEqual(calls.length, 4 * 3 - 1);   // columns 1-4, rows 1-3, less the hole
  assert.ok(calls.every(c => c.k === 'fillRect' && c.fill === m.color)); calls.length = 0;
  m.draw(ctx, { x0: -500, y0: -500, x1: -100, y1: -100 }); assert.strictEqual(calls.length, 0);
  m.set(0, 0, 3); m.draw(ctx, { x0: 0, y0: 0, x1: 5, y1: 5 }); eq([calls[0].fill, calls[0].a], ['#f00', [0, 0, 10, 10]]); calls.length = 0;
  const seen = []; m.paint = (c, id, x, y, s, cx, cy) => seen.push([id, x, y, s, cx, cy]); m.draw(ctx, { x0: 12, y0: 3, x1: 18, y1: 8 }); eq(seen, [[1, 10, 0, 10, 1, 0]]); m.paint = null;
  m.def(4, { draw: (c, x, y, s, cx, cy, id) => seen.push('own' + id) }); m.set(1, 0, 4); m.draw(ctx, { x0: 12, y0: 3, x1: 18, y1: 8 }); assert.strictEqual(seen[1], 'own4');
  // a sheet: frame = id - 1, or a def's frame, or an animation's frame for the time
  const frames = []; m.sheet = { draw: (c, f, x, y, d) => frames.push([f, x, y, d.w, d.h, d.ox]) };
  m.set(5, 5, 9).def(10, { frame: 2 }).set(6, 5, 10).def(11, { frames: [4, 5, 6], fps: 2 }).set(7, 5, 11);
  const v = { x0: 51, y0: 51, x1: 79, y1: 59 }; m.draw(ctx, v); eq(frames, [[8, 50, 50, 10, 10, 0], [2, 60, 50, 10, 10, 0], [4, 70, 50, 10, 10, 0]]);
  m.update(0.6); frames.length = 0; m.draw(ctx, v); assert.strictEqual(frames[2][0], 5); m.sheet = null;
  // layers: all visible ones, or one by name, with its alpha
  const top = m.layer('top'); m.set(0, 1, 3, 'top'); top.alpha = 0.5; calls.length = 0; m.draw(ctx, { x0: 1, y0: 11, x1: 2, y1: 12 });
  eq(calls.map(c => [c.fill, c.alpha]), [[m.color, 1], ['#f00', 0.5]]); assert.strictEqual(ctx.globalAlpha, 1);
  top.visible = false; calls.length = 0; m.draw(ctx, { x0: 1, y0: 11, x1: 2, y1: 12 }); assert.strictEqual(calls.length, 1);
  calls.length = 0; m.draw(ctx, null, 'top'); assert.strictEqual(calls.length, 1);
  // prerender: 16 x 16 tile pictures
  m.prerender = 8; calls.length = 0; m.draw(ctx, { x0: 0, y0: 0, x1: 399, y1: 399 }, 0);
  const stamps = calls.filter(c => c.k === 'drawImage'); eq(stamps.map(c => c.a.slice(1)), [[0, 0, 160, 160], [160, 0, 160, 160], [320, 0, 160, 160], [0, 160, 160, 160], [160, 160, 160, 160], [320, 160, 160, 160], [0, 320, 160, 160], [160, 320, 160, 160], [320, 320, 160, 160]]);
  assert.strictEqual(stamps[0].a[0].width, 128);
  const painted = () => { let n = 0; m.paint = () => n++; calls.length = 0; m.draw(ctx, { x0: 0, y0: 0, x1: 399, y1: 399 }, 0); m.paint = null; return [n, calls.filter(c => c.k === 'drawImage').length]; };
  eq(painted(), [0, 9]);                              // nothing repainted the second time
  m.set(20, 20, 1); eq(painted(), [256, 9]);          // one tile set: only its picture is painted again
  m.redraw(); assert.ok(painted()[0] > 1500);
  const empty = new Tilemap(40, 40, 10); empty.prerender = 8; empty.set(39, 39, 1); calls.length = 0; empty.draw(ctx); assert.strictEqual(calls.filter(c => c.k === 'drawImage').length, 1);   // empty pictures are not stamped
});

test('Tilemap.tiled: layers, flip flags, base64, objects, tile properties and animations', () => {
  const j = { width: 3, height: 2, tilewidth: 16, tileheight: 16, orientation: 'orthogonal', layers: [
    { type: 'tilelayer', name: 'ground', data: [1, 2, 0, (0x80000000 | 3) >>> 0, 0, 5], opacity: 0.5 },
    { type: 'group', layers: [{ type: 'tilelayer', name: 'deco', visible: false, encoding: 'base64', data: Buffer.from(new Uint32Array([0, 0, 7, 0, 0, 0]).buffer).toString('base64') }] },
    { type: 'objectgroup', name: 'spawns', objects: [{ name: 'hero', x: 16, y: 8, width: 32, height: 16, type: 'player' }] }],
    tilesets: [{ firstgid: 1, tiles: [{ id: 1, properties: [{ name: 'solid', type: 'bool', value: false }, { name: 'slow', value: 3 }] }, { id: 4, animation: [{ tileid: 4, duration: 250 }, { tileid: 6, duration: 250 }] }] }] };
  const m = Tilemap.tiled(j, { tile: 32, collide: 'ground' });
  eq([m.cols, m.rows, m.tile, m.layers.map(l => l.name)], [3, 2, 32, ['ground', 'deco']]);
  eq([...m.layers[0].data], [1, 2, 0, 3, 0, 5]); eq([m.get(2, 0, 'deco'), m.layers[0].alpha, m.layers[1].visible], [7, 0.5, false]);
  eq(m.objects.spawns, [{ name: 'hero', x: 32, y: 16, width: 64, height: 32, type: 'player' }]);   // scaled to the tile size asked for
  eq([m.def(2), m.def(5), m.solid(2), m.solid(1), m.collide], [{ solid: false, slow: 3 }, { frames: [4, 6], fps: 4 }, false, true, 'ground']);
  assert.strictEqual(Tilemap.tiled({ width: 2, height: 2, tilewidth: 8, layers: [] }).layers.length, 1);
  assert.throws(() => Tilemap.tiled({ ...j, infinite: true }), /infinite/);
  assert.throws(() => Tilemap.tiled({ ...j, orientation: 'isometric' }), /orthogonal/);
  assert.throws(() => Tilemap.tiled({ ...j, tileheight: 8 }), /square, not 16 x 8/);
  assert.throws(() => Tilemap.tiled({ ...j, layers: [{ type: 'tilelayer', name: 'z', data: 'eJw=', encoding: 'base64', compression: 'zlib' }] }), /"z" is compressed \(zlib\)/);
});

// ---- Txt
const texts = (k = 'fillText') => calls.filter(c => c.k === k).map(c => [c.a[0], c.a[1], c.a[2], c.fill]);
test('Txt.draw: size and font, alignment on both axes, and lines', () => {
  calls.length = 0; Txt.draw(ctx, 'Score 12', 100, 50, { size: 20, weight: 700, color: '#ff0' });
  eq(texts(), [['Score 12', 100, 62.5, '#ff0']]); assert.strictEqual(calls[0].font, '700 20px system-ui, sans-serif'); assert.strictEqual(ctx.textBaseline, 'middle');
  calls.length = 0; Txt.draw(ctx, 'ab\ncdef', 100, 100, { size: 10, align: 'center', valign: 'middle', lineHeight: 2 });
  eq(texts(), [['ab', 95, 90, '#fff'], ['cdef', 90, 110, '#fff']]);
  calls.length = 0; Txt.draw(ctx, 'ab\n\ncdef', 100, 100, { size: 10, align: 'right', valign: 'bottom', lineHeight: 1 });
  eq(texts(), [['ab', 90, 75, '#fff'], ['cdef', 80, 95, '#fff']]);   // the empty line takes its room
  calls.length = 0; Txt.draw(ctx, 42, 0, 0, { size: 10, font: 'monospace', italic: true }); assert.strictEqual(calls[0].font, 'italic 400 10px monospace'); assert.strictEqual(calls[0].a[0], '42');
});

test('Txt wraps at a width, keeps a long word whole, and measures without drawing', () => {
  const L = Txt.measure('the quick brown fox jumps', { size: 10, width: 50 });   // 5 units a letter: 10 letters a line
  eq(L.lines.map(l => l.runs.map(r => r.text).join('')), ['the quick', 'brown fox', 'jumps']); eq([L.w, L.h, L.chars, L.lh], [45, 37.5, 23, 12.5]);
  eq(Txt.measure('a incomprehensible b', { size: 10, width: 50 }).lines.map(l => l.runs[0].text), ['a', 'incomprehensible', 'b']);
  eq(Txt.measure('one\n  two', { size: 10, width: 500 }).lines.map(l => l.runs[0].text), ['one', '  two']);   // spaces after a line break of your own are kept
  eq(Txt.measure('', { size: 10 }).lines.length, 1);
  calls.length = 0; Txt.measure('nothing drawn', { size: 10 }); assert.strictEqual(calls.length, 0);
});

test('Txt: outline under the letters, shadow under both, alpha restored, angle and scale about the point', () => {
  calls.length = 0; ctx.globalAlpha = 0.5;
  Txt.draw(ctx, 'Hi', 10, 20, { size: 10, outline: '#000', shadow: '#333', shadowX: 2, shadowY: 3, alpha: 0.5 });
  eq(calls.map(c => [c.k, c.a[1], c.a[2], c.k === 'strokeText' ? c.stroke : c.fill, c.alpha]), [['fillText', 12, 29.25, '#333', 0.25], ['strokeText', 10, 26.25, '#000', 0.25], ['fillText', 10, 26.25, '#fff', 0.25]]);
  near(ctx.lineWidth, 1.8); assert.strictEqual(ctx.globalAlpha, 0.5); ctx.globalAlpha = 1;
  calls.length = 0; Txt.draw(ctx, 'Hi', 300, 200, { size: 10, angle: 1, scale: 2, align: 'center', valign: 'middle' });
  eq(texts(), [['Hi', -5, 0, '#fff']]);   // drawn about the origin, which the transform has put at (300, 200)
});

test('Txt rich text: colour tags, named colours, {{ for a brace; without rich the braces are just text', () => {
  Txt.colors.gold = '#fd5'; calls.length = 0;
  Txt.draw(ctx, 'Take {gold}3 coins{/} to {#f00}Bob{} {{ok}', 0, 0, { size: 10, rich: true, color: '#aaa' });
  eq(texts(), [['Take ', 0, 6.25, '#aaa'], ['3 coins', 25, 6.25, '#fd5'], [' to ', 60, 6.25, '#aaa'], ['Bob', 80, 6.25, '#f00'], [' {ok}', 95, 6.25, '#aaa']]);
  calls.length = 0; Txt.draw(ctx, '{gold}x{/}', 0, 0, { size: 10 }); eq(texts().map(t => t[0]), ['{gold}x{/}']);
  const L = Txt.measure('{gold}aaaa bbbb{/} cccc', { size: 10, width: 50, rich: true });   // a colour carries over a wrap
  eq(L.lines.map(l => l.runs.map(r => [r.text, r.color])), [[['aaaa bbbb', 'gold']], [['cccc', null]]]); assert.strictEqual(L.chars, 13);
  Txt.colors.gold = '#0f0'; calls.length = 0; Txt.draw(ctx, 'Take {gold}3 coins{/} to {#f00}Bob{} {{ok}', 0, 0, { size: 10, rich: true, color: '#aaa' }); assert.strictEqual(texts()[1][3], '#0f0');   // a changed name shows at once
  // a word whose colour changes part-way wraps as one word
  const lines = (s, width) => Txt.measure(s, { size: 10, width, rich: true }).lines.map(l => l.runs.map(r => r.text).join('|'));
  eq(lines('ab {#f00}gold{/}en', 25), ['ab', 'gold|en']); eq(lines('ab c{#f00}gold{/}en x', 30), ['ab', 'c|gold|en', 'x']); eq(lines('{#f00}gold{/}en', 10), ['gold|en']);
  eq(lines('{#f00}aa bb{/}cc dd', 25), ['aa', 'bb|cc', 'dd']);
  // a gap of another colour at the end of a line is trimmed like any other
  const T = Txt.measure('ab {#f00} {/}', { size: 10, rich: true }); eq([T.w, T.chars, T.lines[0].runs.length], [10, 2, 1]);
  eq(Txt.measure('Hello {#f00} world{/}', { size: 10, rich: true, width: 30 }).lines.map(l => l.w), [25, 25]);
});

test('Txt reveal shows the first n characters with every word already in its place', () => {
  const o = n => ({ size: 10, width: 50, rich: true, align: 'center', reveal: n }), s = 'the {#f00}quick{/} brown fox';
  calls.length = 0; Txt.draw(ctx, s, 100, 0, o(6)); eq(texts(), [['the ', 77.5, 6.25, '#fff'], ['qu', 97.5, 6.25, '#f00']]);
  calls.length = 0; Txt.draw(ctx, s, 100, 0, o(11.9)); eq(texts().map(t => t[0]), ['the ', 'quick', 'br']); assert.strictEqual(texts()[2][1], 77.5);   // 'brown fox' is centred as a whole
  calls.length = 0; Txt.draw(ctx, s, 100, 0, o(0)); assert.strictEqual(calls.length, 0);
  calls.length = 0; Txt.draw(ctx, s, 100, 0, o(999)); eq(texts().map(t => t[0]), ['the ', 'quick', 'brown fox']);
});

test('Txt styles: by name, extended by a draw, and an unknown one says so; layouts are remembered and capped', () => {
  Txt.style('title', { size: 40, weight: 800, align: 'center' });
  calls.length = 0; Txt.draw(ctx, 'AB', 100, 0, 'title'); eq([calls[0].font, calls[0].a[1]], ['800 40px system-ui, sans-serif', 80]);
  calls.length = 0; Txt.draw(ctx, 'AB', 100, 0, { style: 'title', size: 20, color: '#0f0' }); eq([calls[0].font, calls[0].a[1], calls[0].fill], ['800 20px system-ui, sans-serif', 90, '#0f0']);
  assert.throws(() => Txt.draw(ctx, 'x', 0, 0, 'nope'), /unknown style "nope"/); assert.throws(() => Txt.draw(ctx, 'x', 0, 0, { style: 'nope' }), /unknown style/);
  assert.strictEqual(Txt.measure('same', 'title'), Txt.measure('same', 'title'));
  assert.notStrictEqual(Txt.measure('same', 'title'), Txt.measure('same', { style: 'title', size: 41 }));
  const first = Txt.measure('first', 'title'); for (let i = 0; i < Txt.max + 5; i++) Txt.measure('n' + i, 'title');
  assert.ok(Txt._lay.size <= Txt.max); assert.notStrictEqual(Txt.measure('first', 'title'), first);
});

test('Txt.pop: floating text rises, swells, fades and goes; off-screen ones are not drawn', () => {
  Txt.clearPops(); const p = Txt.pop('-25', 100, 200, { color: '#f55', size: 10, life: 1, vy: -50, gravity: 20, vx: 10 });
  eq([p.s, Txt.pops.length, p.o.align, p.o.valign], ['-25', 1, 'center', 'middle']);
  Txt.update(0.5); near(p.x, 105); near(p.y, 200 + (-50 + 10) * 0.5);
  calls.length = 0; Txt.drawPops(ctx); eq([calls.length, calls[0].alpha, calls[0].fill], [1, 1, '#f55']);
  calls.length = 0; Txt.drawPops(ctx, { x0: 500, y0: 0, x1: 900, y1: 900 }); assert.strictEqual(calls.length, 0);
  Txt.update(0.4); calls.length = 0; Txt.drawPops(ctx); near(calls[0].alpha, 0.3, 1e-9); assert.strictEqual(ctx.globalAlpha, 1);
  Txt.pop('+1', 0, 0); Txt.update(0.2); eq(Txt.pops.map(q => q.s), ['+1']);
  Txt.update(5); assert.strictEqual(Txt.pops.length, 0);
  Txt.pop('a', 0, 0, 'title'); Txt.clearPops(); assert.strictEqual(Txt.pops.length, 0);
});

test('Txt.bitmap: glyphs by their place in the string, advance and narrow letters, upper case', () => {
  const img = { width: 40, height: 16 }, f = Txt.bitmap(img, 8, 8, 'ABCDEFGHI.', { widths: { I: 0.5, ' ': 0.5 }, upper: true });
  eq([f.measure('ABC', 16), f.measure('hi i', 8), f.sheet.count], [48, 20, 10]);
  calls.length = 0; Txt.draw(ctx, 'bi.g', 10, 100, { font: f, size: 16, valign: 'middle', outline: '#000' });   // no outline for bitmap fonts
  eq(calls.map(c => [c.k, ...c.a.slice(1)]), [['drawImage', 8, 0, 8, 8, 10, 92, 16, 16], ['drawImage', 24, 8, 8, 8, 26, 92, 16, 16], ['drawImage', 32, 8, 8, 8, 34, 92, 16, 16], ['drawImage', 8, 8, 8, 8, 50, 92, 16, 16]]);
  calls.length = 0; Txt.draw(ctx, 'A?B', 0, 0, { font: f, size: 8 }); eq(calls.map(c => c.a[5]), [0, 16]);   // a character the font lacks leaves a gap
  assert.strictEqual(calls[0].a[0], img);
  calls.length = 0; Txt.draw(ctx, 'A', 0, 0, { font: f, size: 8, color: '#f00' }); assert.notStrictEqual(calls.at(-1).a[0], img);   // tinted: stamped from a coloured copy
  const L = Txt.measure('AB AB AB', { font: f, size: 8, width: 30 }); eq(L.lines.map(l => l.runs[0].text), ['AB', 'AB', 'AB']);
});

// ---- Scenes
test('Scenes transitions: the switch happens under the cover, the top scene waits while it closes, and plain go is as before', () => {
  const log = [], mk = n => ({ enter(a){ log.push(n + ' enter ' + (a ?? '')); }, exit(){ log.push(n + ' exit'); }, pause(){ log.push(n + ' pause'); }, resume(){ log.push(n + ' resume'); }, update(){ log.push(n + ' update'); } });
  Scenes.add('a', mk('a')).add('b', mk('b')).add('c', mk('c'));
  Scenes.go('a', 1); eq(log, ['a enter 1']); assert.strictEqual(Scenes.busy, false);
  Scenes.update(0.1); eq(log.splice(0), ['a enter 1', 'a update']);
  Scenes.go('b', 2, 1); assert.strictEqual(Scenes.busy, true); assert.strictEqual(Scenes.current, 'a');
  Scenes.update(0.4); eq(log, []);                                        // closing: 'a' is frozen
  const cover = () => { calls.length = 0; Scenes.render(ctx); const c = calls.find(q => q.k === 'fillRect'); ctx.globalAlpha = 1; return c ? [c.alpha, c.fill] : null; };   // (this fake canvas has no restore())
  near(cover()[0], 0.8); assert.strictEqual(cover()[1], '#000');
  Scenes.update(0.1); eq(log.splice(0), ['a exit', 'b enter 2']); assert.strictEqual(Scenes.current, 'b'); near(cover()[0], 1);
  Scenes.update(0.25); eq(log.splice(0), ['b update']); near(cover()[0], 0.5);   // opening: the new scene runs
  Scenes.update(0.25); assert.strictEqual(Scenes.busy, false); assert.strictEqual(cover(), null);
  log.length = 0;
  // push and pop, a colour, a cover of your own, and freeze: false
  const ks = []; Scenes.push('c', 3, { fade: 0.2, color: '#fff', freeze: false, draw: (c, k) => ks.push(k) });
  Scenes.update(0.05); eq(log.splice(0), ['b update']); Scenes.render(ctx); near(ks[0], 0.5);
  Scenes.update(0.05); eq(log.splice(0), ['b pause', 'c enter 3', 'c update']); Scenes.update(0.2); assert.strictEqual(Scenes.busy, false);
  log.length = 0; Scenes.pop(0.2); Scenes.update(0.1); eq(log.splice(0), ['c exit', 'b resume']); Scenes.update(0.1); log.length = 0;
  // a second go while the cover is closing wins; one while it opens starts over
  Scenes.go('a', 'x', 1); Scenes.update(0.2); Scenes.go('c', 'y', 1); Scenes.update(0.3); eq(log.splice(0), ['b exit', 'c enter y']);
  Scenes.go('a', 'z', 0.4); Scenes.update(0.2); eq(log.splice(0), ['c exit', 'a enter z']); Scenes.update(0.2); assert.strictEqual(Scenes.busy, false);
  // a plain go while the cover closes wins, and the fade is dropped; a fade asked for while the cover opens closes it again from where it is
  log.length = 0; Scenes.go('b', 'p', 1); Scenes.update(0.2); Scenes.go('c', 'q'); eq(log.splice(0), ['a exit', 'c enter q']); assert.strictEqual(Scenes.busy, false); Scenes.update(1); assert.strictEqual(Scenes.current, 'c');
  Scenes.go('a', 'r', 1); Scenes.update(0.7); near(cover()[0], 0.6); Scenes.go('b', 's', 2); near(cover()[0], 0.6); Scenes.update(0.4); eq(log.filter(l => /enter/.test(l)), ['a enter r', 'b enter s']);
  Scenes.go('a', 'z', 0.4); Scenes.update(0.2); Scenes.update(0.2); Scenes.update(0.2); log.length = 0; Scenes.go('c', 'y');
  // a typo throws at once, before anything fades
  assert.throws(() => Scenes.go('nope', null, 1), /unknown scene "nope"/); assert.strictEqual(Scenes.busy, false);
  // a scene that leaves from inside the switch (enter() calling go) is not cut short
  Scenes.add('hop', { enter(){ Scenes.go('b', 'hopped', 0.2); } }); Scenes.go('hop', null, 0.2); Scenes.update(0.1); assert.strictEqual(Scenes.current, 'hop'); assert.strictEqual(Scenes.busy, true);
  Scenes.update(0.05); assert.strictEqual(Scenes.current, 'b'); assert.strictEqual(Scenes.busy, true); Scenes.update(0.2); assert.strictEqual(Scenes.busy, false);   // already covered, so the second switch needs no second closing
});
