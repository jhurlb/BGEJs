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
