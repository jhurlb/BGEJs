'use strict';
/* Delve: a small top-down dungeon built on Tilemap and Txt.
   Move with WASD / arrows / left stick. Collect every gem, then reach the stairs. Ghosts hunt you while they can see you.
   Shows: a Tilemap made from rows of characters and drawn once (prerender), map.move for walls without a physics
   world, map.sees for line of sight, map.path for ghosts that find their way round walls (and avoid mud when they can),
   Txt for the HUD, a typewriter intro with coloured words, floating numbers, and Scenes fading from one to the next. */
VIEW.ref = 560; resize();
const T = 40, LEVEL = [
  '##############################',
  '#P.....#.........#......*....#',
  '#......#..####...#..####.....#',
  '#..*...#..#*.....#.....#..E..#',
  '#......#..#......####..#.....#',
  '####.###..#..~~~~......###.###',
  '#.........#..~~~~..#.........#',
  '#..####...####.....#...*.....#',
  '#..#*.......#......#####..####',
  '#..#....E...#..........#.....#',
  '#..######...#..~~~.....#..*..#',
  '#...........#..~~~..E........#',
  '#.....*.....#............#..X#',
  '##############################',
];
const WALL = 1, MUD = 2;
const map = Tilemap.from(LEVEL, T, { '#': WALL, '~': MUD });
map.def(MUD, { solid: false });   // walked through, but slow: see `mud` below
map.paint = (c, id, x, y, s) => {
  if (id === MUD) { c.fillStyle = '#4a3b2a'; c.fillRect(x, y, s, s); c.fillStyle = '#5a4832'; c.fillRect(x + 6, y + 8, 10, 4); c.fillRect(x + 22, y + 24, 12, 4); return; }
  c.fillStyle = '#39456b'; c.fillRect(x, y, s, s); c.fillStyle = '#4b5a8a'; c.fillRect(x, y, s, 6); c.fillStyle = '#2b3554'; c.fillRect(x, y + s - 4, s, 4);
};
map.prerender = T;
const fx = Particles.basic(new Particles(1000)), cam = new Camera();
cam.bounds = map.bounds; cam.shakeMax = 8; cam.lead = 0.25; cam.leadMax = 60;
const mud = o => map.at(o.x + (o.w || 0) / 2, o.y + (o.h || 0) / 2) === MUD;
const dearMud = id => id === MUD ? 3 : 1;   // for map.path: a muddy tile costs three plain ones
let player, ghosts, gems, exit, score, hp, time;

Input.bind('up', ['key:w', 'key:arrowup']); Input.bind('down', ['key:s', 'key:arrowdown']);
Input.bind('left', ['key:a', 'key:arrowleft']); Input.bind('right', ['key:d', 'key:arrowright']);
Input.bind('start', ['key:enter', 'key: ', 'pad:0', 'mouse:0']);
Input.block(['key: ', 'key:arrowup', 'key:arrowdown', 'key:arrowleft', 'key:arrowright']);
Sound.unlockOnGesture();
Sound.define('gem', S => { S.tone('triangle', 700, 1300, 0.12, 0.12); });
Sound.define('hurt', S => { S.tone('square', 220, 60, 0.3, 0.15); S.noise(0.2, 'lowpass', 700, 0.25); });
Sound.define('open', S => { S.tone('sine', 300, 900, 0.5, 0.15); });
Txt.colors.gem = '#6fe3ff'; Txt.colors.bad = '#ff6b81';
Txt.style('hud', { size: 18, weight: 700, outline: '#0b0e17', rich: true });
Txt.style('big', { size: 54, weight: 800, outline: '#0b0e17', outlineWidth: 8, align: 'center', valign: 'middle' });
Txt.style('float', { size: 16, weight: 800, outline: '#0b0e17' });

function build(){
  const P = map.marks.P[0];
  player = { x: P.x - 11, y: P.y - 11, w: 22, h: 22, vx: 0, vy: 0, inv: 0 };
  ghosts = map.marks.E.map(m => ({ x: m.x, y: m.y, r: 11, path: null, i: 0, think: 0, sees: false }));
  gems = map.marks['*'].map(m => ({ x: m.x, y: m.y, r: 8 }));
  exit = map.marks.X[0]; score = 0; hp = 3; time = 0; fx.clear(); Txt.clearPops();
  cam.follow(player, 0.001); cam.snap(); cam.update(0);
}
function update(dt){
  time += dt;
  const m = Input.move({ up: 'up', down: 'down', left: 'left', right: 'right' }), sp = mud(player) ? 80 : 190;
  player.vx = damp(player.vx, m.x * sp, 1e-5, dt); player.vy = damp(player.vy, m.y * sp, 1e-5, dt);
  const hit = map.move(player, player.vx * dt, player.vy * dt);   // walls stop it; the sides that hit come back
  if (hit & 3) player.vx = 0; if (hit & 12) player.vy = 0;
  player.inv -= dt;
  const px = player.x + 11, py = player.y + 11;
  for (const g of ghosts) {
    g.sees = dist2(g.x, g.y, px, py) < 420 * 420 && map.sees(g.x, g.y, px, py);
    if ((g.think -= dt) <= 0 && g.sees) { g.think = 0.3; g.path = map.path(g.x, g.y, px, py, { cost: dearMud }); g.i = 0; }   // out of sight it walks on to where it last saw you
    const wp = g.path && g.path[g.i];
    if (wp) {
      const dx = wp.x - g.x, dy = wp.y - g.y, d = Math.hypot(dx, dy), v = (mud(g) ? 55 : 120) * dt;
      if (d <= v) { g.x = wp.x; g.y = wp.y; g.i++; } else map.move(g, dx / d * v, dy / d * v);
    }
    if (player.inv <= 0 && Collide.circleBox(g.x, g.y, g.r, player)) {
      hp--; player.inv = 1.2; Sound.play('hurt'); cam.addTrauma(0.5); fx.play('hit', px, py);
      Txt.pop('-1', px, py - 16, { style: 'float', color: '#ff6b81', size: 22 });
      const d = Math.hypot(px - g.x, py - g.y) || 1; player.vx = (px - g.x) / d * 420; player.vy = (py - g.y) / d * 420;
      if (hp <= 0) return Scenes.go('over', { won: false }, { fade: 0.8, color: '#400' });
    }
  }
  for (const g of gems) if (!g.dead && Collide.circleBox(g.x, g.y, g.r, player)) {
    g.dead = true; score++; Sound.play('gem'); fx.play('sparkle', g.x, g.y);
    Txt.pop('+1', g.x, g.y - 10, { style: 'float', color: '#6fe3ff' });
    if (score === gems.length) { Sound.play('open'); Txt.pop('The stairs are open!', px, py - 40, { style: 'float', size: 20, life: 2, vy: -20 }); }
  }
  if (score === gems.length && dist2(px, py, exit.x, exit.y) < 20 * 20) return Scenes.go('over', { won: true }, 0.8);
  fx.update(dt); cam.update(dt); Txt.update(dt);
}
function drawWorld(c){
  c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#161b2c'; c.fillRect(0, 0, cv.width, cv.height);
  cam.apply(c); map.draw(c, cam.view);
  const open = score === gems.length;
  c.fillStyle = open ? '#ffd166' : '#4a4f63'; c.fillRect(exit.x - 14, exit.y - 14, 28, 28); c.fillStyle = '#161b2c'; for (let i = 0; i < 3; i++) c.fillRect(exit.x - 10, exit.y - 9 + i * 8, 20 - i * 6, 3);
  c.fillStyle = '#6fe3ff'; for (const g of gems) if (!g.dead) { const b = Math.sin(time * 5 + g.x) * 2; c.beginPath(); c.moveTo(g.x, g.y - 9 + b); c.lineTo(g.x + 7, g.y + b); c.lineTo(g.x, g.y + 9 + b); c.lineTo(g.x - 7, g.y + b); c.fill(); }
  for (const g of ghosts) {   // a ghost that can't see you is faint
    c.globalAlpha = g.sees ? 1 : 0.35; c.fillStyle = '#ff6b81'; c.beginPath(); c.arc(g.x, g.y, g.r, Math.PI, 0); c.lineTo(g.x + g.r, g.y + g.r); c.lineTo(g.x - g.r, g.y + g.r); c.fill();
    c.fillStyle = '#161b2c'; c.fillRect(g.x - 6, g.y - 3, 4, 5); c.fillRect(g.x + 2, g.y - 3, 4, 5);
  }
  c.globalAlpha = player.inv > 0 && Math.floor(time * 16) % 2 ? 0.3 : 1; c.fillStyle = '#9be37a'; c.fillRect(player.x, player.y, player.w, player.h); c.globalAlpha = 1;
  fx.draw(c, cam.view); Txt.drawPops(c, cam.view);
}
Scenes.add('title', {
  enter(){ this.t = 0; build(); },
  update(dt){ this.t += dt; if (Input.hit('start')) Scenes.go('play', null, 0.6); },   // fade out, switch, fade in
  render(c){
    drawWorld(c); cam.applyScreen(c); c.fillStyle = 'rgba(11,14,23,0.75)'; c.fillRect(0, 0, vw, vh);
    Txt.draw(c, 'DELVE', vw / 2, vh * 0.3, 'big');
    Txt.draw(c, 'Collect every {gem}gem{/}, then find the stairs. The {bad}ghosts{/} hunt you while they can see you, and they know the way round walls. {#c9a26b}Mud{/} slows everyone.\n\nPress {#fff}Enter{/} to start.',
      vw / 2, vh * 0.45, { size: 18, color: '#aab3cf', align: 'center', width: Math.min(520, vw - 40), rich: true, reveal: this.t * 45 });
  },
});
Scenes.add('play', { enter(){ build(); }, update,
  render(c){
    drawWorld(c); cam.applyScreen(c);
    Txt.draw(c, `{gem}◆{/} ${score} / ${gems.length}   {bad}${'♥'.repeat(Math.max(0, hp))}{/}`, 14, 12, 'hud');
    Txt.draw(c, fmtTime(time), vw - 14, 12, { style: 'hud', align: 'right' });
  },
});
Scenes.add('over', {
  enter(a){ this.won = a.won; this.t = 0; },
  update(dt){ this.t += dt; if (this.t > 0.8 && Input.hit('start')) Scenes.go('title', null, 0.6); },
  render(c){
    drawWorld(c); cam.applyScreen(c); c.fillStyle = 'rgba(11,14,23,0.75)'; c.fillRect(0, 0, vw, vh);
    Txt.draw(c, this.won ? 'ESCAPED' : 'CAUGHT', vw / 2, vh * 0.4, { style: 'big', color: this.won ? '#ffd166' : '#ff6b81' });
    Txt.draw(c, this.won ? `Out in ${fmtTime(time)}. Press Enter` : 'Press Enter to try again', vw / 2, vh * 0.4 + 60, { size: 18, color: '#aab3cf', align: 'center' });
  },
});
Scenes.go('title');
Loop.start({ step: 1 / 60, autoInput: true, update: dt => Scenes.update(dt), render: () => Scenes.render(ctx) });
window.__delve = { map, get player(){ return player; }, get ghosts(){ return ghosts; }, get gems(){ return gems; }, get exit(){ return exit; }, get score(){ return score; }, get hp(){ return hp; } };
