'use strict';
/* Tumble: a small platformer sandbox built on Physics.
   Run with A / D or the arrows, jump with W, Up or Space, click to throw a ball at the pointer. R starts again.
   Shows: a level drawn as a Tilemap and handed to the world with map.addTo, crates that stack, a slope (a polygon), one-way platforms you jump up through, a moving
   platform that carries you, coins (sensors), thrown balls far too fast to catch between frames that still hit what is
   in the way, and onHit / world.onBegin driving particles and sound. */
VIEW.ref = 620; resize();
const T = 40, MAP = [
  '##################################',
  '#................................#',
  '#...........................*....#',
  '#.........*................===...#',
  '#........===.....................#',
  '#....................*...........#',
  '#..............cc................#',
  '#..*...........cc.......o.......*#',
  '#.===.........====.....====...####',
  '#.............................#..#',
  '#......c..................c../#..#',
  '#..P..ccc....../#mm......cc./##..#',
  '#################....#############',
  '#...............#....#...........#',
  '##################################',
];
const fx = Particles.basic(new Particles(1500)), cam = new Camera(), world = new Physics({ gravity: 1500 });
// '#' a block, '=' a one-way platform, '/' a slope up to the right. Every other character is a mark: where to put a thing.
const map = Tilemap.from(MAP, T, { '#': 1, '=': 2, '/': 3 });
map.def(1, { color: '#2c3850' }).def(2, { oneWay: true, h: 0.25, draw(c, x, y){ c.fillStyle = '#7a6a4a'; c.fillRect(x, y, T, 10); } })
  .def(3, { pts: [0, 1, 1, 0, 1, 1], draw(c, x, y){ c.fillStyle = '#2c3850'; c.beginPath(); c.moveTo(x, y + T); c.lineTo(x + T, y); c.lineTo(x + T, y + T); c.fill(); } });
map.prerender = T;   // the level is drawn once and stamped
let player, crates, balls, coins, shots, lift, score, total;
cam.bounds = { x0: 0, y0: 0, x1: MAP[0].length * T, y1: MAP.length * T }; cam.shakeMax = 8;

Input.bind('left', ['key:a', 'key:arrowleft']); Input.bind('right', ['key:d', 'key:arrowright']);
Input.bind('jump', ['key:w', 'key:arrowup', 'key: ', 'pad:0']); Input.bind('throw', ['mouse:0', 'pad:2']); Input.bind('reset', ['key:r']);
Input.block(['key: ', 'key:arrowup', 'key:arrowdown', 'key:arrowleft', 'key:arrowright']);
Sound.unlockOnGesture();
Sound.define('thud', S => { S.tone('sine', 120, 50, 0.12, 0.25); S.noise(0.06, 'lowpass', 500, 0.2); }, 0.04);
Sound.define('coin', S => { S.tone('square', 900, 1400, 0.1, 0.08); });
Sound.define('throw', S => { S.noise(0.08, 'highpass', 1500, 0.1); }, 0.05);

function build(){
  world.clear(); fx.clear(); score = 0;
  map.addTo(world);   // the blocks joined into a few big boxes, the one-way runs, and a polygon for each slope
  const at = ch => map.marks[ch] || [];   // each mark is the centre of its tile
  crates = at('c').map(m => world.add({ x: m.x - 16, y: m.y - 16, w: 32, h: 32, friction: 0.6 }));
  balls = at('o').map(m => world.add({ x: m.x, y: m.y, r: 16, bounce: 0.75, mass: 2 }));
  coins = at('*').map(m => world.add({ x: m.x, y: m.y, r: 9, fixed: true, sensor: true, onHit(o){ if (o === player && !this.dead) { this.dead = true; score++; Sound.play('coin'); Txt.pop('+1', this.x, this.y - 10, { color: '#fd5', size: 16, weight: 700, outline: '#10151f' }); fx.burst('spark', this.x, this.y, 10, { speed: [60, 220], life: 0.35, size: 2, color: '#fd5' }); } } }));
  const l = at('m')[0]; lift = world.add({ x: l.x - T / 2, y: l.y - T / 2, w: T * 2, h: 12, fixed: true, vx: 70, x0: l.x - T / 2, x1: l.x + T * 2.5 });   // a moving platform
  const p = at('P')[0]; player = world.add({ x: p.x - 12, y: p.y - 18, w: 24, h: 36, friction: 0, face: 1 });   // no friction, or they would cling to walls
  shots = []; Txt.clearPops();
  total = coins.length; cam.follow(player, 0.001); cam.x = player.x; cam.y = player.y;
}
// Anything that lands hard makes dust and a thud, louder the harder it lands.
world.onBegin = (a, b, nx, ny, speed) => {
  if (speed < 260 || a.sensor || b.sensor) return;
  const o = a.fixed ? b : a, x = o.r ? o.x - nx * o.r * (o === a ? 1 : -1) : o.x + o.w / 2, y = o.r ? o.y - ny * o.r * (o === a ? 1 : -1) : o.y + (ny * (o === a ? 1 : -1) < 0 ? o.h : 0);
  fx.burst('smoke', x, y, Math.min(8, speed / 150 | 0), { speed: [10, 60], life: 0.5, size: 5, color: '#8a93a6' });
  Sound.play('thud'); if (o === player) cam.kick(Math.min(6, speed / 200));
};

function update(dt){
  if (Input.hit('reset')) build();
  const m = Input.move({ left: 'left', right: 'right' }), ground = player.touch & 8;
  player.vx = damp(player.vx, m.x * 260, ground ? 1e-6 : 1e-3, dt); if (m.x) player.face = Math.sign(m.x);
  if (ground && Input.hit('jump')) player.vy = -640;
  if (!Input.down('jump') && player.vy < -200) player.vy = -200;   // let go early for a short hop
  if (Input.hit('throw')) {
    const p = cam.toWorld(Input.pointer.x, Input.pointer.y), cx = player.x + 12, cy = player.y + 10, d = Math.hypot(p.x - cx, p.y - cy) || 1;
    shots.push(world.add({ x: cx + (p.x - cx) / d * 22, y: cy + (p.y - cy) / d * 22, r: 5, vx: (p.x - cx) / d * 2600, vy: (p.y - cy) / d * 2600, bounce: 0.5, mass: 1.5, age: 0 }));   // 43 units a step: more than a tile
    Sound.play('throw');
  }
  for (const s of shots) if ((s.age += dt) > 5) s.dead = true;
  shots = shots.filter(s => !s.dead);
  if (lift.x > lift.x1) lift.vx = -70; else if (lift.x < lift.x0) lift.vx = 70;
  world.step(dt);
  if (player.y > MAP.length * T + 200) build();
  fx.update(dt); cam.update(dt); Txt.update(dt);
}
function render(c){
  c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#10151f'; c.fillRect(0, 0, cv.width, cv.height);
  cam.apply(c);
  map.draw(c, cam.view);
  c.fillStyle = '#5b8def'; c.fillRect(lift.x, lift.y, lift.w, lift.h);
  for (const k of crates) { c.fillStyle = '#b07a3c'; c.fillRect(k.x, k.y, k.w, k.h); c.strokeStyle = '#6e4a20'; c.lineWidth = 2; c.strokeRect(k.x + 3, k.y + 3, k.w - 6, k.h - 6); }
  for (const b of balls) { c.fillStyle = '#e25d6c'; c.beginPath(); c.arc(b.x, b.y, b.r, 0, TAU); c.fill(); }
  c.fillStyle = '#fd5'; for (const k of coins) if (!k.dead) { c.beginPath(); c.arc(k.x, k.y, k.r * (0.85 + 0.15 * Math.sin(Loop.time * 6 + k.x)), 0, TAU); c.fill(); }
  c.fillStyle = '#fff'; for (const s of shots) { c.beginPath(); c.arc(s.x, s.y, s.r, 0, TAU); c.fill(); }
  c.fillStyle = '#7fe0a0'; c.fillRect(player.x, player.y, player.w, player.h); c.fillStyle = '#10151f'; c.fillRect(player.x + (player.face > 0 ? 15 : 4), player.y + 8, 5, 6);
  fx.draw(c, cam.view); Txt.drawPops(c, cam.view);
  cam.applyScreen(c);
  Txt.draw(c, `Coins {#fd5}${score}{/} / ${total}\n{#8a93a6}A / D run · W or Space jump · click to throw · R restart`, 14, 12, { size: 16, weight: 700, rich: true, lineHeight: 1.4 });
}
build();
Loop.start({ step: 1 / 60, autoInput: true, update, render(){ render(ctx); } });
window.__tumble = { world, map, get player(){ return player; }, get crates(){ return crates; }, get shots(){ return shots; }, get score(){ return score; }, get lift(){ return lift; } };
