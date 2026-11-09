'use strict';
/* Orb Sweep: a small example built only on BGEjs.
   Drive with WASD / arrows / left stick / touch drag. Space, click or A sends out a pulse that pops nearby orbs.
   Big orbs split. An orb that touches you costs a life. F3 toggles the profiler.
   Shows: Loop (with autoInput), Scenes, Camera, Input actions, the ECS, Particles + an emitter, SpatialHash, Collide, Clock tweens,
   Sound recipes, Store, Events and Rng. */
VIEW.ref = 700; resize();
const save = new Store('orbsweep');
const W = 1600, H = 1600, BOUNDS = { x: 0, y: 0, w: W, h: H };
const fx = Particles.basic(new Particles(3000));
const cam = new Camera(); cam.bounds = { x0: 0, y0: 0, x1: W, y1: H }; cam.shakeMax = 12; cam.shakeFreq = 30; cam.shakeRoll = 0.02; cam.lead = 0.3; cam.leadMax = 110;
const hash = new SpatialHash(80);
const clock = new Clock();
let world, ship, score, lives, pulseCd, best = save.get('best', 0), level, trail;

Input.bind('up', ['key:w', 'key:arrowup']); Input.bind('down', ['key:s', 'key:arrowdown']);
Input.bind('left', ['key:a', 'key:arrowleft']); Input.bind('right', ['key:d', 'key:arrowright']);
Input.bind('pulse', ['key: ', 'pad:0', 'mouse:0']); Input.bind('start', ['key:enter', 'key: ', 'pad:0', 'pad:9', 'mouse:0']);
Input.stickOn(cv, () => Scenes.current === 'play');
Input.block(['key: ', 'key:arrowup', 'key:arrowdown', 'key:arrowleft', 'key:arrowright']);   // no page scrolling when embedded
addEventListener('keydown', e => { if (e.key === 'F3') { Profiler.on = !Profiler.on; e.preventDefault(); } });
Sound.unlockOnGesture();
Sound.define('pulse', S => { S.tone('sine', 300, 900, 0.18, 0.2); S.noise(0.2, 'highpass', 2000, 0.08); }, 0.05);
Sound.define('pop', S => { S.tone('triangle', rand(500, 800), 120, 0.12, 0.15); S.noise(0.1, 'bandpass', 1800, 0.12, 2); }, 0.02);
Sound.define('hurt', S => { S.tone('square', 200, 50, 0.4, 0.2); S.noise(0.4, 'lowpass', 600, 0.4); });

// ---- the ECS: orbs are entities with Pos, Vel and Orb
system('play', 'orbs move', (w, dt) => w.each(['Pos', 'Vel', 'Orb'], (id, p, v, o) => {
  p.x += v.x * dt; p.y += v.y * dt; o.x = p.x; o.y = p.y;
  const hit = Collide.clampToBox(o, BOUNDS); if (hit & 3) v.x = -v.x; if (hit & 12) v.y = -v.y; p.x = o.x; p.y = o.y;
}), 10);
system('play', 'orbs vs ship', w => {
  hash.clear(); for (const o of w.list('Orb')) hash.insert(o);
  if (ship.inv > 0) return;
  const o = hash.within(ship.x, ship.y, ship.r)[0];   // exact: allows for each orb's own radius
  if (o) Events.emit('shipHit', o);
}, 20);
function spawnOrb(x, y, r, vx, vy){
  const o = { x, y, r, id: 0, hue: Rng.main.int(160, 320), dead: false };
  o.id = world.spawn({ Pos: { x, y }, Vel: { x: vx, y: vy }, Orb: o });
  o.scale = 0; clock.tween(o, { scale: 1 }, 0.35, Ease.outBack);
  return o;
}
function popOrb(o){
  o.dead = true; world.destroy(o.id); score += Math.round(60 / o.r * 10);
  fx.burst('glow', o.x, o.y, 14, { speed: [60, 260], life: 0.5, size: o.r * 0.3, color: `hsl(${o.hue},90%,65%)` });
  fx.burst('spark', o.x, o.y, 10, { speed: [200, 500], life: 0.3, size: 2, color: '#fff' });
  Sound.play('pop');
  if (o.r > 18) for (let i = 0; i < 2; i++) { const a = Rng.main.angle(); spawnOrb(o.x, o.y, o.r * 0.6, Math.cos(a) * 140, Math.sin(a) * 140); }
}
function pulse(){
  if (pulseCd > 0) return; pulseCd = 0.6;
  const R = 170; Sound.play('pulse'); cam.addTrauma(0.25);
  fx.burst('dot', ship.x, ship.y, 40, { speed: R * 2.4, life: 0.35, size: 3, color: '#7cf', jitter: 0.1 });
  fx.burst('ring', ship.x, ship.y, 1, { speed: 0, life: 0.35, size: R, color: '#7cf', jitter: 0 });
  for (const o of hash.within(ship.x, ship.y, R, [])) popOrb(o);   // its own array: popOrb spawns, and the shared one may be reused
}
Events.on('shipHit', o => {
  lives--; ship.inv = 1.5; cam.addTrauma(0.8); cam.kick(12, Math.atan2(ship.y - o.y, ship.x - o.x));   // shake, and a shove away from the orb Loop.hitstop(0.12); Sound.play('hurt');
  fx.play('explosion', ship.x, ship.y, { scale: 0.8 });
  popOrb(o);
  if (lives <= 0) clock.after(0.6, () => Scenes.push('over'));
});

// ---- scenes
Scenes.add('title', {
  opaque: true,
  enter(){ newRun(); },
  update(dt){ clock.update(dt); fx.update(dt); if (Input.hit('start')) Scenes.go('play'); },
  render(c){ drawWorld(c); text(c, 'ORB SWEEP', vh * 0.38, 48, '#fff'); text(c, 'Drive with WASD or a stick · Space / click / A to pulse', vh * 0.5, 16, '#9ab'); text(c, `Best ${best} · press Space to start`, vh * 0.56, 16, '#7cf'); },
});
Scenes.add('play', {
  opaque: true,
  update(dt){
    const m = Input.move({ up: 'up', down: 'down', left: 'left', right: 'right' });
    ship.vx = damp(ship.vx, m.x * 360, 0.0005, dt); ship.vy = damp(ship.vy, m.y * 360, 0.0005, dt);
    ship.x += ship.vx * dt; ship.y += ship.vy * dt; Collide.clampToBox(ship, BOUNDS);
    if (Math.hypot(ship.vx, ship.vy) > 30) ship.ang = Math.atan2(ship.vy, ship.vx);
    trail.on = Math.hypot(ship.vx, ship.vy) > 60;
    ship.inv -= dt; pulseCd -= dt;
    if (Input.hit('pulse')) pulse();
    runSystems('play', world, dt);
    if (!world.count('Orb')) { level++; Sound.play('pulse'); for (let i = 0; i < 3 + level * 2; i++) spawnEdge(); }
    clock.update(dt); fx.update(dt); cam.update(dt);
  },
  render(c){ drawWorld(c); hud(c); },
});
Scenes.add('over', {
  enter(){ if (score > best) { best = score; save.set('best', best); } },
  update(dt){ fx.update(dt); if (Input.hit('start')) { Scenes.go('title'); } },
  render(c){ c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(0, 0, vw, vh); text(c, 'GAME OVER', vh * 0.42, 40, '#fff'); text(c, `Score ${score} · best ${best}`, vh * 0.5, 18, '#7cf'); },
});

function newRun(){
  world = new World(); clock.cancelAll(); fx.clear();
  ship = { x: W / 2, y: H / 2, r: 12, vx: 0, vy: 0, ang: 0, inv: 1 };
  trail = fx.emitter('glow', { rate: 60, speed: [10, 40], life: 0.35, size: 4, color: ['#7cf', '#59f'] }).follow(ship);
  score = 0; lives = 3; pulseCd = 0; level = 1;
  cam.follow(ship, 0.002).snap();
  for (let i = 0; i < 5; i++) spawnEdge();
}
function spawnEdge(){
  const side = Rng.main.int(0, 3), t = Rng.main.float();
  const x = side === 0 ? 30 : side === 1 ? W - 30 : t * W, y = side === 2 ? 30 : side === 3 ? H - 30 : t * H;
  const a = Math.atan2(H / 2 - y, W / 2 - x) + Rng.main.range(-0.6, 0.6), sp = Rng.main.range(60, 110) + level * 10;
  spawnOrb(x, y, Rng.main.pick([16, 26, 34]), Math.cos(a) * sp, Math.sin(a) * sp);
}
function drawWorld(c){
  cam.update(0); cam.apply(c);
  c.fillStyle = '#0d1117'; c.fillRect(cam.view.x0 - 50, cam.view.y0 - 50, cam.view.x1 - cam.view.x0 + 100, cam.view.y1 - cam.view.y0 + 100);
  c.strokeStyle = '#1c2533'; c.lineWidth = 2; c.beginPath();
  for (let x = 0; x <= W; x += 100) { c.moveTo(x, 0); c.lineTo(x, H); } for (let y = 0; y <= H; y += 100) { c.moveTo(0, y); c.lineTo(W, y); } c.stroke();
  c.strokeStyle = '#3a4a63'; c.lineWidth = 4; c.strokeRect(0, 0, W, H);
  for (const o of world.list('Orb')) {
    if (!cam.inView(o.x, o.y, o.r)) continue;
    const sp = Sprites.get(`orb${o.r}:${o.hue}`, o.r * 1.4, Sprites.scaleOf(c), g => {   // drawn once, stamped every frame
      const gr = g.createRadialGradient(-o.r * 0.3, -o.r * 0.3, 1, 0, 0, o.r); gr.addColorStop(0, '#fff'); gr.addColorStop(0.3, `hsl(${o.hue},90%,65%)`); gr.addColorStop(1, `hsl(${o.hue},70%,35%)`);
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, o.r, 0, TAU); g.fill();
    });
    c.save(); c.translate(o.x, o.y); c.scale(o.scale, o.scale); Sprites.stamp(c, sp); c.restore();
  }
  fx.draw(c, cam.view);
  if (ship && (ship.inv <= 0 || (Loop.realTime * 12 | 0) % 2)) {
    c.save(); c.translate(ship.x, ship.y); c.rotate(ship.ang); c.fillStyle = '#e8f6ff';
    c.beginPath(); c.moveTo(16, 0); c.lineTo(-10, 10); c.lineTo(-5, 0); c.lineTo(-10, -10); c.closePath(); c.fill(); c.restore();
  }
  if (pulseCd > 0.3) { c.strokeStyle = `rgba(120,200,255,${(pulseCd - 0.3) * 3})`; c.lineWidth = 3; c.beginPath(); c.arc(ship.x, ship.y, 170 * (1 - (pulseCd - 0.3) / 0.3), 0, TAU); c.stroke(); }
}
function hud(c){
  cam.applyScreen(c); c.font = '700 18px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillStyle = '#fff';
  c.fillText(`Score ${score}`, 16, 14); c.fillText(`${'♥'.repeat(Math.max(0, lives))}`, 16, 38); c.textAlign = 'right'; c.fillText(`Wave ${level}`, vw - 16, 14);
}
function text(c, s, y, size, col){ cam.applyScreen(c); c.font = `800 ${size}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = col; c.fillText(s, vw / 2, y); }

Scenes.go('title');
Loop.start({
  autoInput: true,   // the loop reads the gamepad and clears "pressed this frame" itself
  update(dt){ Scenes.update(dt); },
  render(){ ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, cv.width, cv.height); Scenes.render(ctx); Profiler.count('particles', fx.count); Profiler.count('orbs', world.count('Orb')); Profiler.draw(ctx); Profiler.frame(); },
});
window.__orb = { get world(){ return world; }, get ship(){ return ship; }, get score(){ return score; }, get lives(){ return lives; }, pulse, spawnOrb, popOrb };
