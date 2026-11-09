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
    cam.x = 300; cam.y = -120; cam.zoom = 1.7; cam.angle = 0.9; cam.update(0);
    const s = cam.toScreen(380, -60); dot(380, -60);
    const turned = lit(s.x, s.y) && !lit(s.x + 20, s.y) && !lit(s.x, s.y - 20);
    cam.angle = 0; cam.update(0); dot(150 + 40, -60 + 30, 0.5);                    // a half-speed layer is centred on half the camera's position
    const layer = lit(vw / 2 + 40 * cam.k, vh / 2 + 30 * cam.k);
    let t = 0; const tick = setInterval(() => { t += 0.05; cam.update(0.05); }, 5);
    await cam.moveTo(500, 0, 0.3, { zoom: 1 }).wait(); clearInterval(tick);        // a cutscene step, awaited
    return { turned, layer, x: cam.x, zoom: cam.zoom, t: Math.round(t * 100) / 100, onScreen: s.x > 0 && s.x < vw && s.y > 0 && s.y < vh };
  });
  assert.deepStrictEqual(r, { turned: true, layer: true, x: 500, zoom: 1, t: 0.3, onScreen: true });
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

test('Txt on a real canvas: letters land where the layout says, aligned, outlined, wrapped; bitmap fonts tint', async () => {
  const pg = await page();
  await pg.goto(`${srv.base}tests/blank.html`);
  const r = await pg.evaluate(() => {
    const wipe = () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height); };
    // how many pixels in a rect are mostly red / green / blue / white
    const count = (x, y, w, h) => { const d = ctx.getImageData(Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h)).data, n = { r: 0, g: 0, b: 0, w: 0 }; for (let i = 0; i < d.length; i += 4) { const R = d[i] > 150, G = d[i + 1] > 150, B = d[i + 2] > 150; if (R && G && B) n.w++; else if (R) n.r++; else if (G) n.g++; else if (B) n.b++; } return n; };
    wipe(); const L = Txt.draw(ctx, 'MMMM', 200, 100, { size: 40, weight: 700, color: '#f00' });
    const left = { inside: count(200, 100, L.w, L.h).r > 300, before: count(100, 100, 98, L.h).r, after: count(202 + L.w, 100, 100, L.h).r, above: count(200, 40, L.w, 58).r, below: count(200, 102 + L.h, L.w, 50).r };
    wipe(); Txt.draw(ctx, 'MMMM', 400, 100, { size: 40, weight: 700, color: '#f00', align: 'right', valign: 'bottom' });
    const right = { inside: count(400 - L.w, 100 - L.h, L.w, L.h).r > 300, after: count(402, 0, 200, 200).r, below: count(200, 102, 300, 80).r };
    wipe(); Txt.draw(ctx, 'MM', 200, 100, { size: 60, weight: 700, color: '#fff', outline: '#0f0', outlineWidth: 10 }); const o = count(180, 80, 200, 120);
    wipe(); const W = Txt.draw(ctx, 'MMMM MMMM {#00f}MMMM', 100, 300, { size: 30, color: '#f00', width: L.w, rich: true });
    const wrap = { lines: W.lines.length, l1: count(100, 300, 400, W.lh).r > 100, l3red: count(100, 300 + 2 * W.lh, 400, W.lh).r, l3blue: count(100, 300 + 2 * W.lh, 400, W.lh).b > 100, wide: W.w <= L.w };
    wipe(); Txt.draw(ctx, 'MMMM', 100, 500, { size: 40, color: '#f00', reveal: 1 }); const one = count(100, 500, 400, 60).r;
    Txt.draw(ctx, 'MMMM', 100, 560, { size: 40, color: '#f00' }); const four = count(100, 560, 400, 60).r;
    // a bitmap font of two 8 x 8 glyphs: A is a full square, B its left half
    const img = document.createElement('canvas'); img.width = 16; img.height = 8; const g = img.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 0, 4, 8);
    const f = Txt.bitmap(img, 8, 8, 'AB'); wipe(); ctx.imageSmoothingEnabled = false;
    Txt.draw(ctx, 'AB', 300, 300, { font: f, size: 16, lineHeight: 1 }); Txt.draw(ctx, 'ab AB', 300, 340, { font: Txt.bitmap(img, 8, 8, 'AB', { upper: true }), size: 16, lineHeight: 1, color: '#00f', align: 'center' });
    const bm = { A: count(300, 300, 16, 16).w, B: count(316, 300, 16, 16).w, tinted: count(260, 340, 80, 16), wide: Txt.measure('AB', { font: f, size: 16 }).w };
    Txt.pop('99', 600, 300, { size: 40, color: '#0f0' }); Txt.update(0.1); Txt.drawPops(ctx); const pop = count(560, 250, 80, 80).g > 50;
    return { left, right, outline: o.g > 200 && o.w > 200, wrap, reveal: one > 50 && four > one * 3, bm, pop };
  });
  assert.deepStrictEqual(r, { left: { inside: true, before: 0, after: 0, above: 0, below: 0 }, right: { inside: true, after: 0, below: 0 }, outline: true,
    wrap: { lines: 3, l1: true, l3red: 0, l3blue: true, wide: true }, reveal: true, bm: { A: 256, B: 128, tinted: { r: 0, g: 0, b: 256 + 128 + 256 + 128, w: 0 }, wide: 32 }, pop: true });
  assert.deepStrictEqual(pg.errors, []);
});

test('Tilemap on a real canvas: tiles from a sheet, prerendered pictures match tile-by-tile drawing and follow set(); a scene fade covers the screen', async () => {
  const pg = await page();
  await pg.goto(`${srv.base}tests/blank.html`);
  const r = await pg.evaluate(() => {
    const px = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3).join();
    const wipe = () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height); };
    const img = document.createElement('canvas'); img.width = 16; img.height = 8; const g = img.getContext('2d'); g.fillStyle = '#f00'; g.fillRect(0, 0, 8, 8); g.fillStyle = '#0f0'; g.fillRect(8, 0, 8, 8);
    const m = Tilemap.from(['12.', '.21', '1.3'], 20, { 1: 1, 2: 2, 3: 3 }, { x: 40, y: 60 }); m.sheet = Sprites.sheet(img, 8, 8); m.def(3, { color: '#00f' });
    const read = () => [[50, 70], [70, 70], [90, 70], [70, 90], [90, 90], [50, 110], [90, 110], [35, 70], [105, 90]].map(p => px(p[0], p[1])).join(' ');
    ctx.imageSmoothingEnabled = false; wipe(); m.draw(ctx); const direct = read();
    m.prerender = 20; wipe(); m.draw(ctx, { x0: 0, y0: 0, x1: 900, y1: 640 }); const stamped = read();
    m.set(2, 0, 2); wipe(); m.draw(ctx); const after = px(90, 70);
    const cam = new Camera(); cam.x = 70; cam.y = 90; cam.zoom = 2; cam.update(0); wipe(); cam.apply(ctx); m.draw(ctx, cam.view); const s = cam.toScreen(50, 70), viaCam = px(Math.round(s.x * dpr), Math.round(s.y * dpr));
    // a fade: green scene to blue scene through white
    Scenes.add('g', { render(c){ c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#0f0'; c.fillRect(0, 0, cv.width, cv.height); } }).add('b', { render(c){ c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#00f'; c.fillRect(0, 0, cv.width, cv.height); } });
    Scenes.go('g'); Scenes.go('b', null, { fade: 1, color: '#fff' }); const fade = [];
    for (const dt of [0, 0.5, 0.5]) { Scenes.update(dt); Scenes.render(ctx); fade.push(px(300, 300)); }
    return { direct, stamped, after, viaCam, fade, alpha: ctx.globalAlpha };
  });
  const want = '255,0,0 0,255,0 0,0,0 0,255,0 255,0,0 255,0,0 0,0,255 0,0,0 0,0,0';
  assert.deepStrictEqual(r, { direct: want, stamped: want, after: '0,255,0', viaCam: '255,0,0', fade: ['0,255,0', '255,255,255', '0,0,255'], alpha: 1 });
  assert.deepStrictEqual(pg.errors, []);
});

test('Delve: the intro types itself out, the title fades to play, walls stop the player, ghosts find their way, gems open the stairs', async () => {
  const pg = await page();
  await pg.goto(`${srv.base}examples/delve/index.html`);
  await pg.waitForFunction(() => window.__delve && Scenes.current === 'title');
  await pg.keyboard.press('Enter');
  await pg.waitForFunction(() => Scenes.busy);   // the fade has begun
  await pg.waitForFunction(() => Scenes.current === 'play' && !Scenes.busy);
  const ways = await pg.evaluate(() => { const d = __delve, p = d.player; return [...d.gems, d.exit, ...d.ghosts].every(g => d.map.path(p.x, p.y, g.x, g.y)); });
  assert.ok(ways, 'every gem, the stairs and every ghost can be reached');
  await pg.keyboard.down('a'); await pg.keyboard.down('w');
  await pg.waitForFunction(() => __delve.player.x === 40 && __delve.player.y === 40);   // pressed into the top-left corner of the first room, exactly
  await pg.waitForTimeout(200); assert.deepStrictEqual(await pg.evaluate(() => [__delve.player.x, __delve.player.y]), [40, 40]);   // and held there
  await pg.keyboard.up('a'); await pg.keyboard.up('w');
  // a ghost with a wall between it and the player walks round it
  const chase = await pg.evaluate(async () => {
    const d = __delve, p = d.player, g = d.ghosts[0]; for (const o of d.ghosts) if (o !== g) o.x = o.y = -999;
    p.x = 5 * 40 + 9; p.y = 3 * 40 + 9; g.x = 8.5 * 40; g.y = 3.5 * 40; g.path = d.map.path(g.x, g.y, p.x + 11, p.y + 11); g.i = 0;   // the other side of the wall at column 7
    const sees = d.map.sees(g.x, g.y, p.x + 11, p.y + 11), steps = g.path.length, hp = d.hp;
    await new Promise(ok => { const t = setInterval(() => { if (d.hp < hp) { clearInterval(t); ok(); } }, 30); });
    return { sees, far: steps > 8, pops: Txt.pops.length > 0 };
  });
  assert.deepStrictEqual(chase, { sees: false, far: true, pops: true });
  const gems = await pg.evaluate(() => { const d = __delve; for (const o of d.ghosts) o.x = o.y = -999; return d.gems.length; });
  for (let i = 0; i < gems; i++) { await pg.evaluate(k => { const d = __delve, g = d.gems[k]; d.player.x = g.x - 11; d.player.y = g.y - 11; }, i); await pg.waitForFunction(k => __delve.gems[k].dead, i); }
  assert.strictEqual(await pg.evaluate(() => __delve.score), gems);
  await pg.evaluate(() => { const d = __delve; d.player.x = d.exit.x - 11; d.player.y = d.exit.y - 11; });
  await pg.waitForFunction(() => Scenes.current === 'over' && !Scenes.busy);
  assert.deepStrictEqual(pg.errors, []);
});
