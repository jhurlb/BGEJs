/// <reference path="../dist/bge.d.ts" />
// A game's worth of calls, compiled (never run) by tests/types.test.js: the declarations must accept what the docs show.
const fx = Particles.basic(new Particles(2000));
const cam = new Camera();
const world = new Physics({ gravity: 1500 });
const player = world.add({ x: 40, y: 300, w: 24, h: 36, friction: 0, face: 1 });
const coin = world.add({ x: 340, y: 270, r: 8, fixed: true, sensor: true, onHit(other) { if (other === player) this.dead = true; } });
cam.follow(player, 0.001, { blend: 0.6 }); cam.deadzone = { w: 120, h: 80 }; cam.bounds = { x0: 0, y0: 0, x1: 100, y1: 100 };
cam.moveTo(1, 2, 1.2, { zoom: 1.5, hold: true }).wait().then(() => cam.release());
Input.bind('jump', ['key: ', 'pad:0']); Input.block(['key: ']);
fx.kind('fire', { shape: 'circle', blend: 'lighter', gravity: -120, size: [0.6, 1, 0.2], alpha: [[0, 1], [1, 0]], colors: ['#fff', '#f62'] });
const fire = fx.emitter('fire', { rate: 150, speed: [5, 40], life: [0.5, 1], box: [50, 6] }); fire.follow(player, 0, -4);
Sound.define('thud', S => { S.tone('sine', 120, 50, 0.12, 0.25); S.noise(0.06, 'lowpass', 500, 0.2); }, 0.04);
const save = new Store('game'); const best: number = save.get('best', 0);
const clock = new Clock(); clock.tween(player, { x: 300 }, 0.4, Ease.outCubic).then(() => {});
const hash = new SpatialHash<{ x: number; y: number; r: number }>(64); const near = hash.nearest(0, 0, 100, e => e.r > 2);
const map = Tilemap.from(['###', '#P#', '###'], 40, { '#': 1 });
map.def(2, { oneWay: true, h: 0.25 }).def(3, { pts: [0, 1, 1, 0, 1, 1], body: { friction: 0.1 } });
map.sheet = Sprites.sheet(Assets.get('tiles'), 16, 16); map.prerender = 16; map.addTo(world, { friction: 0.5 });
const start = map.marks.P[0], route = map.path(start.x, start.y, 100, 100, { diagonal: false, cost: id => id === 4 ? 3 : 1 });
const sides: number = map.move(player, player.vx * 0.016, player.vy * 0.016);
Txt.style('title', { size: 48, weight: 800, outline: '#000', align: 'center' });
const font = Txt.bitmap(Assets.get('font'), 8, 8, 'ABC', { upper: true });
Scenes.add('play', {
  update(dt) { if (player.touch & 8 && Input.hit('jump')) player.vy = -640; world.step(dt); fx.update(dt); cam.update(dt); Txt.update(dt); },
  render(c) {
    cam.apply(c); map.draw(c, cam.view); fx.draw(c, cam.view); Txt.drawPops(c, cam.view);
    cam.applyScreen(c); Txt.draw(c, `Best ${best} ${fmtTime(Loop.time)} ${sides} ${near ? near.r : 0} ${route ? route.length : 0}`, vw / 2, 20, 'title');
    Txt.draw(c, 'HI', 4, 4, { font, size: 16, color: '#fd5', reveal: Loop.time * 30, rich: true });
  },
});
Scenes.go('play', { level: 1 }, { fade: 0.5, color: '#fff' });
Loop.start({ step: 1 / 60, autoInput: true, update: dt => Scenes.update(dt), render: () => Scenes.render(ctx) });
Events.on('resize', () => {}); system('update', 'x', (w, dt) => { w.each(['Pos'], (id, p) => { p.x += dt; }); }, 5);
const hitT: number = Collide.sweep(player, 1, 0, coin) + Rng.main.int(1, 6) + rand(0, 1) + clamp(1, 0, 2) + TAU + dpr + scale + vh;
netInit().then(ok => { if (ok) netJoin('room').then(r => safePres(r, { x: hitT })); });
