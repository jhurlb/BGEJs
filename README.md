# BGEjs

A small engine for 2D browser games on the canvas. It's plain JavaScript in classic `<script>` files: no build step, no dependencies, and it runs straight from `file://`. It came out of [Battle Bot Survivors](https://github.com/jhurlb/battle-bot-survivors), which runs on it.

```html
<canvas id="game"></canvas>
<script src="bge.js"></script>   <!-- dist/bge.js: the whole engine in one file -->
<script src="my-game.js"></script>
```

See [`examples/orb-sweep`](examples/orb-sweep) for a complete game in about 150 lines that uses most of the engine.

## What's in it

| File | Global | What it does |
| --- | --- | --- |
| `core.js` | `cv`, `ctx`, `dpr`, `vw`, `vh`, `scale`, `VIEW`, `resize()` | Canvas setup and resizing; helpers `clamp`, `lerp`, `invLerp`, `remap`, `damp`, `angDiff`, `dist2`, `fmtTime`, `$`, `escapeHtml`, `TAU` |
| `rng.js` | `Rng`, `rand`, `pickW`, `shuffle` | Seedable random numbers (sfc32): `float`, `range`, `int`, `chance`, `pick`, `shuffle`, `weighted`, `gauss`, save and restore state. `Rng.main` for gameplay, `Rng.fx` for looks and sounds so replays stay exact |
| `events.js` | `Events`, `Bus` | Publish / subscribe: `on`, `once`, `off`, `emit` |
| `ecs.js` | `World`, `system`, `runSystems`, `ecsBasics` | Entities, components and ordered systems by phase; cached `list()` queries; deferred destroy |
| `loop.js` | `Loop` | The frame loop: fixed or variable step, `timeScale`, `hitstop`, pause, keeps running in a hidden tab when you ask |
| `time.js` | `Clock`, `Ease` | Timers (`after`, `every`) and tweens with 14 easing curves, all paused and slowed with the game |
| `scenes.js` | `Scenes` | A scene stack: `go`, `push`, `pop`, with enter / exit / pause / resume hooks |
| `pool.js` | `Pool` | Object pooling |
| `store.js` | `Store` | Namespaced `localStorage` with defaults and versioned migrations; never throws |
| `collide.js` | `Collide` | Circles, boxes, segments, rays, polygons, overlap separation, keep-inside-box |
| `spatial.js` | `SpatialHash` | Fast "what's near here" queries and nearest-match search |
| `particles.js` | `Particles` | Pooled particles in typed arrays: your own kinds, bursts, emitters that follow objects, culling, blend modes |
| `camera.js` | `Camera` | Follow with smoothing, zoom, world bounds, trauma shake and direct `kick()` jolts, screen and world conversion, view rect for culling |
| `input.js` | `Input`, `keys` | Keyboard, pointer, touch stick, gamepad, and named actions over all of them |
| `ui-nav.js` | `UINav` | Gamepad and arrow-key navigation for DOM menus |
| `audio.js` | `Sound` | Web Audio: synthesized effect recipes with rate limits, sampled sounds, drones |
| `music.js` | `MusicPlayer` | Streamed music playlists with volume, mute, pause / resume, loop points and the "play after first gesture" rule handled |
| `assets.js` | `Assets` | Preload images, sounds, JSON and text with progress |
| `sprites.js` | `Sprites` | Draw once to an offscreen canvas and stamp many times, with a least-recently-used cache |
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
    Input.endFrame();
  },
});
```

## Rules the engine follows

- Engine files never read a game's state. Games build on the engine, not the other way round.
- Everything is a global, the way plain `<script>` files share one scope. A file's top-level code only uses files listed above it in `src/index.txt`.
- No allocation in hot paths where it can be avoided: particles live in typed arrays, the spatial hash reuses its cell arrays, and queries fill a shared buffer.
- Anything that touches browser storage or audio is wrapped so a private window or a blocked autoplay can't crash a game.

## Speed

Measured in Node on the same machine, spawning and updating 5,000 particles a frame: the old approach (one ECS entity per particle) took about 2.1 to 2.4 ms a frame, and `Particles` takes about 0.15 ms, 13 to 17 times faster. Particles also produce no garbage, so they don't cause GC pauses.

## Working on the engine

```
npm install
npx playwright install chromium
npm test          # syntax check, bundle freshness check, unit tests (Node) and browser tests (Chromium)
npm run bundle    # rebuild dist/bge.js after changing src/
```

Edit `src/`, never `dist/bge.js`. Add a new file to `src/index.txt` at the point in the order where its dependencies are loaded. GitHub Actions runs `npm test` on every push to main.

## Using it in a game repo

Copy `dist/bge.js` into the game, or copy `src/` if you want separate files while debugging. Battle Bot Survivors keeps a copy of `src/` in its `engine/` folder and records the BGEjs commit it came from in `engine/BGEJS_VERSION`.

## License

Public domain, under the [Unlicense](UNLICENSE).
