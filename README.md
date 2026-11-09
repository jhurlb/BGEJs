# BGEjs

A small engine for 2D browser games on the canvas. It's plain JavaScript in classic `<script>` files: no build step, no dependencies, and it runs straight from `file://`. It came out of [Battle Bot Survivors](https://github.com/jhurlb/battle-bot-survivors), which runs on it.

```html
<canvas id="game"></canvas>
<script src="bge.js"></script>   <!-- dist/bge.js: the whole engine in one file -->
<script src="my-game.js"></script>
```

See [`examples/orb-sweep`](examples/orb-sweep) for a complete game in about 150 lines that uses most of the engine.
[`examples/tumble`](examples/tumble) is a small platformer sandbox built on the physics world: crates, slopes, one-way and moving platforms, thrown balls.

## What's in it

| File | Global | What it does |
| --- | --- | --- |
| `core.js` | `cv`, `ctx`, `dpr`, `vw`, `vh`, `scale`, `VIEW`, `resize()` | Canvas setup and resizing; helpers `clamp`, `lerp`, `invLerp`, `remap`, `damp`, `angDiff`, `dist2`, `fmtTime`, `$`, `escapeHtml`, `TAU` |
| `rng.js` | `Rng`, `rand`, `pickW`, `shuffle` | Seedable random numbers (sfc32): `float`, `range`, `int`, `chance`, `pick`, `shuffle`, `weighted`, `gauss`, save and restore state. `Rng.main` for gameplay, `Rng.fx` for looks and sounds so replays stay exact |
| `events.js` | `Events`, `Bus` | Publish / subscribe: `on`, `once`, `off`, `emit` (which allocates nothing) |
| `ecs.js` | `World`, `system`, `runSystems`, `ecsBasics` | Entities, components and ordered systems by phase; cached `list()` queries; deferred destroy |
| `loop.js` | `Loop` | The frame loop: fixed or variable step, `timeScale`, `hitstop`, pause, keeps running in a hidden tab when you ask. `autoInput` makes it look after `Input` so no press is lost or seen twice |
| `time.js` | `Clock`, `Ease` | Timers (`after`, `every`) and tweens with 18 easing curves, all paused and slowed with the game; handles can be awaited |
| `scenes.js` | `Scenes` | A scene stack: `go`, `push`, `pop`, with enter / exit / pause / resume hooks |
| `pool.js` | `Pool` | Object pooling |
| `store.js` | `Store` | Namespaced `localStorage` with defaults and versioned migrations; never throws, and falls back to memory when storage is blocked |
| `collide.js` | `Collide` | Circles, boxes, segments, rays, polygons, overlap separation, pushing a circle out of a wall, bouncing off it, keep-inside-box. For any two shapes (circle, box, convex polygon): `overlap`, a swept `sweep` that nothing tunnels through, `ray`, and `resolve` for a whole collision |
| `physics.js` | `Physics` | A world of bodies that fall, collide, stack, slide and bounce: gravity, mass, friction, bounce, fixed and moving platforms, one-way platforms, sensors, layers, touch flags and hit events, raycasts. Fast things don't tunnel |
| `spatial.js` | `SpatialHash` | Fast "what's near here": exact `within()` for things with a size, rough `query()`, and a `nearest()` whose cost doesn't grow with the search range |
| `particles.js` | `Particles` | Pooled particles in typed arrays: kinds you draw or just describe (shape, size / opacity / colour over life), bursts, emitters that follow objects, named effects, draw layers, culling, blend modes |
| `camera.js` | `Camera` | Follow with smoothing, a deadzone and look-ahead; frame a group and zoom to fit; eased zoom, zoom at the cursor, scripted moves; rotation, world bounds, parallax; trauma shake (smooth, with roll), jolts and directional kicks; screen and world conversion, view rect for culling |
| `input.js` | `Input`, `keys` | Keyboard, pointer, mouse wheel, touch stick, gamepad, and named actions over all of them |
| `ui-nav.js` | `UINav` | Gamepad and arrow-key navigation for DOM menus |
| `audio.js` | `Sound` | Web Audio: synthesized effect recipes with rate limits, sampled sounds, drones |
| `music.js` | `MusicPlayer` | Streamed music playlists with volume, mute, pause / resume, loop points and the "play after first gesture" rule handled |
| `assets.js` | `Assets` | Preload images, sounds, JSON and text with progress |
| `sprites.js` | `Sprites` | Draw once to an offscreen canvas and stamp many times, with a least-recently-used cache; sprite sheets and frame animations for image art |
| `look.js` | `inkOn`, `INK`, `filmFx`, `FILM` | Optional cartoon look: automatic ink outlines on solid fills, plus an old-film overlay |
| `profiler.js` | `Profiler` | Time per system, custom counters and an on-screen overlay |
| `net.js` | `NET`, `netInit`, `netJoin` | Presence-based multiplayer rooms: the claude.ai live room, or a BroadcastChannel between local tabs |

Each file starts with a comment that shows its whole API with examples.

## A minimal game

```js
const fx = Particles.basic(new Particles(2000));
const cam = new Camera();
const player = { x: 0, y: 0 };
cam.follow(player, 0.01);
Input.bind('up', ['key:w']); Input.bind('down', ['key:s']); Input.bind('left', ['key:a']); Input.bind('right', ['key:d']);
Input.bind('boom', ['key: ', 'pad:0']);

Loop.start({
  autoInput: true,   // the loop reads the gamepad and clears "pressed this frame" for you
  update(dt){
    const m = Input.move({ up: 'up', down: 'down', left: 'left', right: 'right' });
    player.x += m.x * 300 * dt; player.y += m.y * 300 * dt;
    if (Input.hit('boom')) { fx.burst('spark', player.x, player.y, 30, { speed: [100, 400], life: 0.4, color: '#fd0' }); cam.addTrauma(0.4); }
    fx.update(dt); cam.update(dt);
  },
  render(){
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#111'; ctx.fillRect(0, 0, cv.width, cv.height);
    cam.apply(ctx);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(player.x, player.y, 12, 0, TAU); ctx.fill();
    fx.draw(ctx, cam.view);
  },
});
```

## Particles

A kind can be described instead of drawn. Size, opacity and colour change over each particle's life, from birth to death:

```js
fx.kind('fire', {
  shape: 'circle', blend: 'lighter', gravity: -120, drag: 0.95,
  size:   [0.6, 1, 0.2],                      // x the particle's own size
  alpha:  [0, 0.7, 0.5, 0],                   // fade in, then out
  colors: ['#fff', '#fd5', '#f62', '#611'],   // white hot to dark red
});
const fire = fx.emitter('fire', { x: 0, y: 0, rate: 150, speed: [5, 40], life: [0.5, 1], size: [5, 10], box: [50, 6] });
fx.warm(2);                                   // already burning when the scene opens

fx.play('explosion', x, y);                   // a ready-made effect: smoke, flash, shock ring, embers and sparks
fx.play('hit', x, y, { angle, spread: 1.5 }); // aimed
fx.effect('pickup', [{ kind: 'ring', n: 1, speed: 0, size: 30, life: 0.3, jitter: 0 }, { kind: 'glow', n: 12, speed: [40, 120] }]);   // your own
```

Shapes are `circle`, `square`, `rect`, `spark`, `ring`, or an `image` to stamp. Curves take evenly spaced stops, timed stops (`[[0, 1], [0.8, 1], [1, 0]]`) or a function of age. They are turned into lookup tables when the kind is made, so nothing is computed or allocated per particle. Bursts can start in a disc, a ring or a box and fly `outward`; emitters can pulse (`interval`, `count`), wait (`delay`), end themselves (`duration`, `onDone`) and pass on their own motion (`inherit`); a kind's `onDeath` hook chains effects (a rocket that bursts); `layer` lets smoke draw under the actors and sparks over them. The full list is in the comment at the top of `src/particles.js`.

## Camera

```js
cam.follow(player, 0.001);                    // smooth follow: 0.1% of the gap is left after a second
cam.deadzone = { w: 120, h: 80 };             // the player moves freely inside this box before the camera does
cam.lead = 0.35;                              // look ahead: aim 0.35 s in front of where the player is going
cam.bounds = { x0: 0, y0: 0, x1: W, y1: H };  // never show past the edge of the world

cam.frame([p1, p2, boss], { padding: 80 });   // or keep several things in shot: centres on them and zooms out to fit
cam.zoomTo(2, 0.4, Ease.outCubic);            // eased zoom
cam.zoomAt(cam.zoom * 1.1, mouseX, mouseY);   // wheel zoom that keeps the point under the cursor still
cam.moveTo(door.x, door.y, 1.2, { zoom: 1.5, hold: true, onDone: openDoor });   // a cutscene pan; cam.release() hands back to follow
await cam.fit(arena, 1, { padding: 40, hold: true }).wait();   // or await it: show a whole rect, then carry on
cam.follow(player, 0.001, { blend: 0.6 });    // glide back to the player instead of cutting
cam.setBounds(nextRoom, 0.5);                 // slide into the next room's bounds

cam.addTrauma(0.5);                           // shake that builds with each hit and dies away
cam.kick(10, angle);                          // a push in one direction: recoil, a landing
cam.shakeFreq = 30; cam.shakeRoll = 0.03;     // smooth shake that looks the same at any frame rate, with a little roll
cam.shakeScale = settings.shake;              // one number for a "screen shake" option (0 = off)

cam.apply(ctx, 0.5);                          // a background layer at half scroll speed
drawHills(cam.layerView(0.5));                // and the part of that layer on screen, for culling it
```

`follow()` and `frame()` take over from whatever the camera was doing; `snap()` jumps to where it is heading, for a respawn or a teleport. `cam.angle` turns the view, and conversions, bounds and the view rect all account for it. The full list is in the comment at the top of `src/camera.js`.

## Rules the engine follows

- Engine files never read a game's state. Games build on the engine, not the other way round.
- Everything is a global, the way plain `<script>` files share one scope. A file's top-level code only uses files listed above it in `src/index.txt`.
- No allocation in hot paths where it can be avoided: particles live in typed arrays, the spatial hash reuses its cell arrays, queries fill a shared buffer, and emitting an event copies nothing.
- New engine features go on the existing globals (`Collide.rayBox`, `Sprites.sheet`) rather than adding new ones, because every global is a name a game can no longer use for itself. A new kind of thing that holds its own state gets one global, as `Physics` did.
- Anything that touches browser storage or audio is wrapped so a private window or a blocked autoplay can't crash a game.

## Physics

A body is your own object in one of three shapes. The world moves it and tells you what it touches:

```js
const world = new Physics({ gravity: 1500 });            // leave gravity out for a top-down game
world.add({ x: 0, y: 400, w: 800, h: 40, fixed: true });                 // a floor. Tiles side by side work too: seams don't catch
world.add({ x: 300, y: 300, w: 120, h: 10, fixed: true, oneWay: true }); // jump up through it, land on it
world.add({ x: 500, y: 360, pts: [0, 40, 80, 0, 80, 40], fixed: true }); // a slope: any convex polygon
const lift = world.add({ x: 600, y: 300, w: 80, h: 12, fixed: true, vx: 60 });   // fixed + a velocity = a moving platform
const player = world.add({ x: 40, y: 300, w: 24, h: 36, friction: 0 });
const crate = world.add({ x: 200, y: 360, w: 32, h: 32, mass: 2 });
const coin = world.add({ x: 340, y: 270, r: 8, fixed: true, sensor: true, onHit(other){ if (other === player) this.dead = true; } });

function update(dt){
  player.vx = Input.move({ left: 'left', right: 'right' }).x * 260;
  if (player.touch & 8 && Input.hit('jump')) player.vy = -640;          // touch: 1 left, 2 right, 4 top, 8 bottom
  if (Input.hit('fire')) world.add({ x: player.x + 30, y: player.y + 10, r: 4, vx: 3000, bounce: 0.5 });   // 50 units a step, and it still hits
  world.step(dt);
}
world.onBegin = (a, b, nx, ny, speed) => { if (speed > 300) Sound.play('thud'); };
```

Everything about a body (`vx`, `vy`, `mass`, `bounce`, `friction`, `drag`, `gravityScale`, `layer` / `mask`, `sensor`) is a plain property you can change at any time. `world.raycast` and `world.query` find bodies along a line or inside a shape. Bodies don't rotate, and there are no joints: this is physics for platformers, top-down games and things that bounce, kept small. The same tests the world uses are there for games that would rather move things themselves: `Collide.overlap(a, b)`, `Collide.sweep(a, dx, dy, b)` and `Collide.resolve(a, b, bounce, friction)`.

## Speed

Measured in Node on the same machine, spawning and updating 5,000 particles a frame: the old approach (one ECS entity per particle) took about 2.1 to 2.4 ms a frame, and `Particles` takes about 0.15 ms, 13 to 17 times faster. Particles also produce no garbage, so they don't cause GC pauses. With `overflow: 'replace'` a full system finds its oldest particle in constant time: at 8,192 particles with 300 new ones a frame, a frame takes about 0.4 ms, where the search 0.3 did took 2.2 ms.

`SpatialHash.nearest` searches outwards cell by cell and stops when nothing farther can win. With 2,000 things on a 4,000 x 4,000 map, 2,000 searches take about 3 ms whatever the range; scanning every cell in range, as 0.2 did, took 9 ms at a range of 200, 84 ms at 1,000 and 950 ms across the whole map.

`Physics.step` in Node: 500 circles crowding towards one point (about 900 contacts) take about 0.4 ms a step, 2,000 circles (4,000 contacts) about 3 ms, and a settled pile of 600 boxes and balls about 0.8 ms.

## Working on the engine

```
npm install
npx playwright install chromium
npm test          # syntax check, bundle freshness check, unit tests (Node) and browser tests (Chromium)
npm run bundle    # rebuild dist/bge.js after changing src/
```

Edit `src/`, never `dist/bge.js`. Add a new file to `src/index.txt` at the point in the order where its dependencies are loaded. GitHub Actions runs `npm test` on every push to main and on every pull request. Changes are listed in [`CHANGELOG.md`](CHANGELOG.md).

## Using it in a game repo

Copy `dist/bge.js` into the game, or copy `src/` if you want separate files while debugging. Battle Bot Survivors keeps a copy of `src/` in its `engine/` folder and records the BGEjs commit it came from in `engine/BGEJS_VERSION`.

## License

Public domain, under the [Unlicense](UNLICENSE).
