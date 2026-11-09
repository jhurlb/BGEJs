'use strict';
// The physics example in a real browser: it loads, settles, and plays without errors.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { serve } = require('./serve');

let srv, browser;
before(async () => { srv = await serve(); browser = await chromium.launch(); });
after(async () => { await browser.close(); srv.close(); });

test('Tumble: crates rest, the player runs, jumps and throws, and everything stays in the level', async () => {
  const pg = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage(), errors = [];
  pg.on('pageerror', e => errors.push(e.message));
  await pg.goto(`${srv.base}examples/tumble/index.html`);
  await pg.waitForFunction(() => window.__tumble && Loop.time > 1);
  const state = () => pg.evaluate(() => {
    const t = __tumble, p = t.player, all = t.world.bodies;
    return { x: p.x, y: p.y, ground: (p.touch & 8) > 0, score: t.score, shots: t.shots.length,
      moving: Math.max(...t.crates.map(c => Math.hypot(c.vx, c.vy))), inside: all.every(b => b.x > -1 && b.x < 1361 && b.y > -1 && b.y < 601) };
  });
  const a = await state();
  assert.ok(a.ground && a.moving < 1 && a.inside, JSON.stringify(a));   // the stacks came to rest
  await pg.keyboard.down('a'); await pg.waitForFunction(x => __tumble.player.x < x - 15, a.x); await pg.keyboard.up('a');
  await pg.keyboard.down('w'); await pg.waitForFunction(y => __tumble.player.y < y - 40, a.y); await pg.keyboard.up('w');
  await pg.waitForFunction(() => __tumble.player.touch & 8);
  for (let i = 0; i < 5; i++) { await pg.mouse.click(500 + i * 60, 420); await pg.waitForTimeout(60); }   // throw at the crates
  await pg.waitForFunction(() => Loop.time > 4);
  const b = await state();
  assert.strictEqual(b.shots, 5); assert.ok(b.inside, 'something left the level');
  assert.deepStrictEqual(errors, []);
});
