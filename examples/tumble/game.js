'use strict';
/* Tumble: a small platformer sandbox built on Physics.
   Run with A / D or the arrows, jump with W, Up or Space, click to throw a ball at the pointer. R starts again.
   Shows: a floor made of tiles, crates that stack, a slope (a polygon), one-way platforms you jump up through, a moving
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
let player, tiles, crates, balls, coins, shots, lift, score, total;
cam.bounds = { x0: 0, y0: 0, x1: MAP[0].length * T, y1: MAP.length * T }; cam.shakeMax = 8;

Input.bind('left', ['key:a', 'key:arrowleft']); Input.bind('right', ['key:d', 'key:arrowright']);
Input.bind('jump', ['key:w', 'key:arrowup', 'key: ', 'pad:0']); Input.bind('throw', ['mouse:0', 'pad:2']); Input.bind('reset', ['key:r']);
Input.block(['key: ', 'key:arrowup', 'key:arrowdown', 'key:arrowleft', 'key:arrowright']);
Sound.unlockOnGesture();
Sound.define('thud', S => { S.tone('sine', 120, 50, 0.12, 0.25); S.noise(0.06, 'lowpass', 500, 0.2); }, 0.04);
Sound.define('coin', S => { S.tone('square', 900, 1400, 0.1, 0.08); });
Sound.define('throw', S => { S.noise(0.08, 'highpass', 1500, 0.1); }, 0.05);

function build(){
  world.clear(); fx.clear(); tiles = []; crates = []; balls = []; coins = []; shots = []; score = 0;
  MAP.forEach((row, j) => [...row].forEach((ch, i) => {
    const x = i * T, y = j * T;
    if (ch === '#') tiles.push(world.add({ x, y, w: T, h: T, fixed: true }));
    else if (ch === '=') tiles.push(world.add({ x, y, w: T, h: 10, fixed: true, oneWay: true }));
    else if (ch === '/') tiles.push(world.add({ x, y, pts: [0, T, T, 0, T, T], fixed: true }));   // a slope up to the right
    else if (ch === 'c') crates.push(world.add({ x: x + 4, y: y + 4, w: 32, h: 32, friction: 0.6 }));
    else if (ch === 'o') balls.push(world.add({ x: x + 20, y: y + 20, r: 16, bounce: 0.75, mass: 2 }));
    else if (ch === '*') coins.push(world.add({ x: x + 20, y: y + 20, r: 9, fixed: true, sensor: true, onHit(o){ if (o === player && !this.dead) { this.dead = true; score++; Sound.play('coin'); fx.burst('spark', this.x, this.y, 10, { speed: [60, 220], life: 0.35, size: 2, color: '#fd5' }); } } }));
    else if (ch === 'm' && row[i - 1] !== 'm') tiles.push(lift = world.add({ x, y, w: T * 2, h: 12, fixed: true, vx: 70, x0: x, x1: x + T * 3 }));   // a moving platform
    else if (ch === 'P') player = world.add({ x: x + 8, y: y + 2, w: 24, h: 36, friction: 0, face: 1 });   // no friction, or they would cling to walls
  }));
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
  fx.update(dt); cam.update(dt);
}
function render(c){
  c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#10151f'; c.fillRect(0, 0, cv.width, cv.height);
  cam.apply(c);
  for (const t of tiles) {
    c.fillStyle = t.oneWay ? '#7a6a4a' : t === lift ? '#5b8def' : '#2c3850';
    if (t.pts) { c.beginPath(); c.moveTo(t.x + t.pts[0], t.y + t.pts[1]); for (let i = 2; i < t.pts.length; i += 2) c.lineTo(t.x + t.pts[i], t.y + t.pts[i + 1]); c.fill(); }
    else c.fillRect(t.x, t.y, t.w, t.h);
  }
  for (const k of crates) { c.fillStyle = '#b07a3c'; c.fillRect(k.x, k.y, k.w, k.h); c.strokeStyle = '#6e4a20'; c.lineWidth = 2; c.strokeRect(k.x + 3, k.y + 3, k.w - 6, k.h - 6); }
  for (const b of balls) { c.fillStyle = '#e25d6c'; c.beginPath(); c.arc(b.x, b.y, b.r, 0, TAU); c.fill(); }
  c.fillStyle = '#fd5'; for (const k of coins) if (!k.dead) { c.beginPath(); c.arc(k.x, k.y, k.r * (0.85 + 0.15 * Math.sin(Loop.time * 6 + k.x)), 0, TAU); c.fill(); }
  c.fillStyle = '#fff'; for (const s of shots) { c.beginPath(); c.arc(s.x, s.y, s.r, 0, TAU); c.fill(); }
  c.fillStyle = '#7fe0a0'; c.fillRect(player.x, player.y, player.w, player.h); c.fillStyle = '#10151f'; c.fillRect(player.x + (player.face > 0 ? 15 : 4), player.y + 8, 5, 6);
  fx.draw(c, cam.view);
  cam.applyScreen(c); c.font = '700 16px system-ui, sans-serif'; c.textBaseline = 'top'; c.fillStyle = '#fff';
  c.fillText(`Coins ${score} / ${total}`, 14, 12); c.fillStyle = '#8a93a6'; c.fillText('A / D run · W or Space jump · click to throw · R restart', 14, 34);
}
build();
Loop.start({ step: 1 / 60, autoInput: true, update, render(){ render(ctx); } });
window.__tumble = { world, get player(){ return player; }, get crates(){ return crates; }, get shots(){ return shots; }, get score(){ return score; }, get lift(){ return lift; } };
