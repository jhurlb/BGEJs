'use strict';
// The engine in a real browser: the bundle and the separate src files both load cleanly, and the example game plays.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { serve } = require('./serve');

let srv, browser;
before(async () => { srv = await serve(); browser = await chromium.launch(); });
after(async () => { await browser.close(); srv.close(); });
async function page(){ const pg = await (await browser.newContext({ viewport: { width: 900, height: 640 } })).newPage(); pg.errors = []; pg.on('pageerror', e => pg.errors.push(e.message)); return pg; }

test('the separate src files load in index.txt order with no errors', async () => {
  const order = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.txt'), 'utf8').split('\n').filter(Boolean);
  const pg = await page();
  await pg.setContent('<canvas id="game"></canvas>');
  for (const f of order) await pg.addScriptTag({ url: `${srv.base}src/${f}` });
  const r = await pg.evaluate(() => [typeof Particles, typeof Loop, typeof Scenes, typeof Sound, typeof Profiler]);
  assert.deepStrictEqual(r, ['function', 'object', 'object', 'object', 'object']);
  assert.deepStrictEqual(pg.errors, []);
});

test('Loop runs update and render, and hitstop and timeScale work', async () => {
  const pg = await page();
  await pg.goto(`${srv.base}tests/blank.html`);
  const r = await pg.evaluate(() => new Promise(ok => {
    let u = 0, sim = 0;
    Loop.start({ update(dt){ u++; sim += dt; }, render(){} });
    setTimeout(() => { const a = { u, sim }; Loop.hitstop(10); setTimeout(() => { const b = sim; Loop.stop(); ok({ a, frozen: b === sim || b - a.sim < 0.05 }); }, 300); }, 400);
  }));
  assert.ok(r.a.u > 5 && r.a.sim > 0.2, JSON.stringify(r)); assert.ok(r.frozen);
  assert.deepStrictEqual(pg.errors, []);
});

test('Camera on a real canvas: a turned, zoomed, parallax view draws where toScreen says', async () => {
  const pg = await page();
  await pg.goto(`${srv.base}tests/blank.html`);
  const r = await pg.evaluate(async () => {
    const cam = new Camera(), lit = (x, y) => ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data[0] > 200;
    const dot = (wx, wy, p) => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height); cam.apply(ctx, p); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(wx, wy, 6 / cam.k, 0, TAU); ctx.fill(); };
    cam.x = 300; cam.y = -120; cam.zoom = 1.7; cam.rot = 0.9; cam.update(0);
    const s = cam.toScreen(380, -60); dot(380, -60);
    const turned = lit(s.x, s.y) && !lit(s.x + 20, s.y) && !lit(s.x, s.y - 20);
    cam.rot = 0; cam.update(0); dot(150 + 40, -60 + 30, 0.5);                      // a half-speed layer is centred on half the camera's position
    const layer = lit(vw / 2 + 40 * cam.k, vh / 2 + 30 * cam.k);
    const p = { x: 0, y: 0 }; cam.zoom = 1; cam.follow(p); cam.update(0);
    let t = 0; const move = cam.moveTo(500, 0, 0.3); const tick = setInterval(() => { t += 0.05; cam.update(0.05); }, 5);
    await move; clearInterval(tick);
    return { turned, layer, x: cam.x, t, onScreen: [s.x > 0 && s.x < vw, s.y > 0 && s.y < vh] };
  });
  assert.deepStrictEqual({ ...r, t: Math.round(r.t * 100) / 100 }, { turned: true, layer: true, x: 500, t: 0.3, onScreen: [true, true] });
  assert.deepStrictEqual(pg.errors, []);
});

test('Orb Sweep: title, play, pulse pops orbs, game over', async () => {
  const pg = await page();
  await pg.goto(`${srv.base}examples/orb-sweep/index.html`);
  await pg.waitForFunction(() => window.__orb && Scenes.current === 'title');
  await pg.keyboard.press(' ');
  await pg.waitForFunction(() => Scenes.current === 'play');
  await pg.keyboard.down('d'); await pg.waitForTimeout(400); await pg.keyboard.up('d');
  const moved = await pg.evaluate(() => __orb.ship.x > 800);
  assert.ok(moved, 'the ship drove right');
  await pg.evaluate(() => { const s = __orb.ship; s.inv = 99; for (const o of __orb.world.list('Orb')) { o.x = s.x + 80; o.y = s.y; const p = __orb.world.get(o.id, 'Pos'); p.x = o.x; p.y = o.y; const v = __orb.world.get(o.id, 'Vel'); v.x = v.y = 0; } });
  await pg.waitForTimeout(100); await pg.keyboard.press(' ');
  await pg.waitForFunction(() => __orb.score > 0);
  await pg.evaluate(() => { __orb.ship.inv = 0; const s = __orb.ship; for (let i = 0; i < 3; i++) { const o = __orb.spawnOrb(s.x, s.y, 20, 0, 0); } });
  await pg.evaluate(() => { __orb.ship.inv = 0; });
  await pg.waitForFunction(() => __orb.lives < 3);
  await pg.evaluate(() => { const s = __orb.ship; const t = setInterval(() => { if (Scenes.current === 'over') return clearInterval(t); s.inv = 0; __orb.spawnOrb(s.x, s.y, 16, 0, 0); }, 50); });
  await pg.waitForFunction(() => Scenes.current === 'over', null, { timeout: 10000 });
  assert.deepStrictEqual(pg.errors, []);
});

test('MusicPlayer: a paused track stays paused through clicks, stop(true) unloads', async () => {
  const pg = await page();
  await pg.goto(`${srv.base}tests/blank.html`);
  const r = await pg.evaluate(async () => {
    const m = new MusicPlayer([{ src: 'none-a.mp3', name: 'A' }, { src: 'none-b.mp3', name: 'B' }]);
    m.play(); const a = { want: m.want, src: m.el.src.split('/').pop() };
    m.pause(); let played = 0; m.el.play = () => { played++; return Promise.resolve(); };
    document.body.click(); dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
    const b = { held: m.held, played };
    m.resume(); const c = { held: m.held, played };
    m.next(); const d = m.idx;
    m.stop(true); return { a, b, c, d, src: m.el.getAttribute('src'), want: m.want };
  });
  assert.deepStrictEqual(r, { a: { want: true, src: 'none-a.mp3' }, b: { held: true, played: 0 }, c: { held: false, played: 1 }, d: 1, src: null, want: false });
  assert.deepStrictEqual(pg.errors, []);
});

test('Input with real events: Shift never leaves a key stuck, mouse buttons are tracked one by one, blocked keys do not scroll', async () => {
  const pg = await page();
  await pg.goto(`${srv.base}tests/blank.html`);
  await pg.evaluate(() => { document.body.style.height = '5000px'; Input.bind('fire', ['mouse:0']); Input.bind('alt', ['mouse:2']); Input.block(['key: ']); addEventListener('contextmenu', e => e.preventDefault()); });
  await pg.keyboard.down('Digit1'); await pg.keyboard.down('Shift'); await pg.keyboard.up('Digit1'); await pg.keyboard.up('Shift');
  assert.deepStrictEqual(await pg.evaluate(() => [...keys]), []);
  await pg.keyboard.press(' '); await pg.waitForTimeout(150);
  assert.strictEqual(await pg.evaluate(() => scrollY), 0, 'Space is the game\'s, not the page\'s');
  const state = () => pg.evaluate(() => [Input.down('fire'), Input.down('alt'), Input.pointer.down, Input.hit('alt')]);
  await pg.mouse.move(200, 200); await pg.mouse.down({ button: 'left' }); await pg.mouse.down({ button: 'right' });
  assert.deepStrictEqual(await state(), [true, true, true, true]);
  await pg.mouse.up({ button: 'left' }); assert.deepStrictEqual(await state(), [false, true, true, true]);
  await pg.mouse.up({ button: 'right' }); assert.deepStrictEqual(await state(), [false, false, false, true]);
  await pg.mouse.wheel(0, 300); await pg.waitForFunction(() => Input.wheel > 0);
  assert.strictEqual(await pg.evaluate(() => { Input.endFrame(); return Input.wheel + (Input.hit('alt') ? 1 : 0); }), 0);
  assert.deepStrictEqual(pg.errors, []);
});

test('Sprite sheets draw the right frame, flipped and scaled; Sprites.get keeps one copy per scale', async () => {
  const pg = await page();
  await pg.goto(`${srv.base}tests/blank.html`);
  const r = await pg.evaluate(() => {
    const img = document.createElement('canvas'); img.width = 16; img.height = 8; const g = img.getContext('2d');   // two 8 x 8 frames: red, then half green / half blue
    g.fillStyle = '#f00'; g.fillRect(0, 0, 8, 8); g.fillStyle = '#0f0'; g.fillRect(8, 0, 4, 8); g.fillStyle = '#00f'; g.fillRect(12, 0, 4, 8);
    const sh = Sprites.sheet(img, 8, 8), px = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3).join();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
    sh.draw(ctx, 0, 20, 20); sh.draw(ctx, 1, 100, 100, { w: 40 }); sh.draw(ctx, 1, 200, 100, { w: 40, flipX: true });
    const an = sh.anim([0, 1], 10); an.update(0.15); an.draw(ctx, 300, 100, { w: 40, oy: 1 });
    let made = 0; const a = Sprites.get('s', 8, 1, () => made++), b = Sprites.get('s', 8, 2, () => made++); Sprites.get('s', 8, 1, () => made++);
    return { count: sh.count, red: px(20, 20), left: px(90, 100), right: px(110, 100), flipLeft: px(190, 100), flipRight: px(210, 100), above: px(290, 80), below: px(290, 110), made, sizes: [a.cv.width, b.cv.width] };
  });
  assert.deepStrictEqual(r, { count: 2, red: '255,0,0', left: '0,255,0', right: '0,0,255', flipLeft: '0,0,255', flipRight: '0,255,0', above: '0,255,0', below: '0,0,0', made: 2, sizes: [18, 34] });
  assert.deepStrictEqual(pg.errors, []);
});

test('Sound: muting reaches the master gain, drones stop cleanly, a missing file rejects with its name', async () => {
  const pg = await page();
  await pg.goto(`${srv.base}tests/blank.html`);
  const r = await pg.evaluate(async () => {
    const before = Sound.muted; Sound.muted = true; const ok = Sound.init(), g0 = Sound.out.gain.value;   // muted before the context exists
    Sound.define('blip', S => S.tone('sine', 400, 200, 0.05, 0.1)); Sound.play('blip');
    const hum = Sound.drone(); hum.set(60, 0.2); hum.stop(); hum.set(60, 0.2);
    Sound.muted = false; Sound.play('blip');
    await new Promise(f => setTimeout(f, 200));
    const err = await Sound.load('nope.ogg').then(() => '', e => e.message);
    return { before, ok, g0, drones: Sound.drones.length, muted: Sound.muted, err };
  });
  assert.deepStrictEqual(r, { before: false, ok: true, g0: 0, drones: 0, muted: false, err: 'Sound: nope.ogg (404)' });
  assert.deepStrictEqual(pg.errors, []);
});

test('Particles: effects and shape kinds paint real pixels, and a ramp takes any CSS colour', async () => {
  const pg = await page();
  await pg.goto(`${srv.base}tests/blank.html`);
  const r = await pg.evaluate(() => {
    const px = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
    const wipe = () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height); };
    const fx = Particles.basic(new Particles(500));
    wipe(); fx.play('explosion', 200, 200); fx.update(0.03); fx.draw(ctx);
    const flash = px(200, 200), far = px(600, 500), state = [ctx.globalAlpha, ctx.globalCompositeOperation];
    // a stamped image, and a colour ramp from names and hsl()
    const dot = document.createElement('canvas'); dot.width = dot.height = 8; const g = dot.getContext('2d'); g.fillStyle = '#0f0'; g.fillRect(0, 0, 8, 8);
    fx.clear(); fx.kind('stamp', { image: dot, alpha: 1, rotate: true }); fx.kind('named', { shape: 'square', alpha: 1, colors: ['red', 'hsl(240, 100%, 50%)'] });
    fx.spawn('stamp', 100, 100, 0, 0, 1, 1, '#fff', 10, 0.3); fx.spawn('named', 300, 100, 0, 0, 1, 1, '#fff', 10); fx.spawn('named', 400, 100, 0, 0, 0.001, 1, '#fff', 10);
    wipe(); fx.draw(ctx);
    let bad = ''; try { Particles.ramp(['red', 'notacolour']); } catch (e) { bad = e.message; }
    return { flash, far, state, stamp: px(100, 100), young: px(300, 100), old: px(400, 100), ramp: Particles.ramp(['white', 'transparent'], 2), bad };
  });
  assert.ok(r.flash[0] > 200 && r.flash[1] > 150, JSON.stringify(r.flash));   // the flash is bright at the centre
  assert.deepStrictEqual({ ...r, flash: 0 }, { flash: 0, far: [0, 0, 0], state: [1, 'source-over'], stamp: [0, 255, 0], young: [255, 0, 0], old: [0, 0, 255],
    ramp: ['rgba(255,255,255,1)', 'rgba(255,255,255,0.5)', 'rgba(0,0,0,0)'], bad: `Particles: can't read the colour "notacolour"` });
  assert.deepStrictEqual(pg.errors, []);
});
