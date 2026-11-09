# Changelog

## 0.8.0

Tile maps, text, and types for your editor. Everything that worked in 0.7 works the same.

### Added

- **`Tilemap`: levels as grids of tiles** (new file `tilemap.js`). Make one from rows of characters (`Tilemap.from(['###', '#P#'], 40, { '#': 1 })`, where characters that are not tiles become `map.marks`: where to put the player, the coins), by hand (`new Tilemap(cols, rows, size)`, `set`, `fill`), or from a map saved by the Tiled editor (`Tilemap.tiled(json)`: tile layers, object layers, custom tile properties, animations).
  - **Drawing.** `map.draw(ctx, cam.view)` draws only the tiles on screen, from a sprite sheet (`map.sheet`), a function of your own (`map.paint`), or plain colours. Layers draw together or one at a time, so actors can go between a back and a front. `map.prerender = 16` draws the level once into cached pictures and stamps those: far fewer draw calls, and no hairlines between tiles when the camera sits at a fraction of a pixel. `set()` repaints only the picture it touched.
  - **Colliding without a physics world.** `map.move(box, dx, dy)` moves a box or circle and stops it at the walls, returning the sides that hit (1 left, 2 right, 4 top, 8 bottom, as `touch` and `clampToBox` do). It checks every tile the leading edge crosses, so no speed skips a wall. One-way platforms are landed on from above.
  - **With Physics.** `map.addTo(world)` hands the walls to a `Physics` world as fixed bodies, joined into as few boxes as will do (Tumble's 150 or so tiles become 23 bodies), with one-way runs and a polygon for each slope tile.
  - **Rays and paths.** `map.raycast(ox, oy, dx, dy, max)` gives the distance to the first wall, the tile in `map.hit` and the normal in `Collide.nx / ny`; `map.sees(ax, ay, bx, by)` is line of sight. `map.path(ax, ay, bx, by)` is A* round the walls, with diagonals that never cut a corner, a `cost` function for ground that is dearer to cross, and a cap on the work so a far goal cannot stall a frame.
  - `map.def(id, { solid, oneWay, pts, color, frame, frames, fps, draw, body })` says what a tile is. With nothing said, every tile but 0 is a solid block.
- **`Txt`: text on the canvas** (new file `text.js`; `Text` already belongs to the browser). `Txt.draw(ctx, 'Score 120', x, y, { size, color, outline, shadow, align, valign, width, angle, scale })` with wrapping at a width and alignment on both axes. A layout is worked out once and remembered, so the same line drawn every frame measures nothing.
  - **Coloured words**: `{ rich: true }` reads `'Take the {#fd5}gold key{/}'`, with names of your own in `Txt.colors`.
  - **Typewriter**: `reveal: n` shows the first n characters, with every word already where it will end up, so nothing jumps as a line fills.
  - **Named styles**: `Txt.style('hud', { ... })`, then `Txt.draw(ctx, s, x, y, 'hud')` or `{ style: 'hud', size: 30 }`.
  - **Bitmap fonts** for pixel art: `Txt.bitmap(image, 8, 8, 'ABC...')`, tinted to any colour, with narrow letters and an upper-case-only option.
  - **Floating numbers**: `Txt.pop('-25', x, y, { color })` rises, swells and fades by itself; `Txt.update(dt)` and `Txt.drawPops(ctx, cam.view)` run them.
- **Scenes fade.** `Scenes.go('play', args, 0.5)` fades out, switches behind the cover and fades back in; `push` and `pop` take the same last argument, as seconds or `{ fade, color, draw(c, k), freeze }`. The scene on top is not updated while the cover closes, so a press cannot land twice. `Scenes.busy` says a fade is running.
- **Type declarations: `dist/bge.d.ts`.** Every global in the engine, for autocomplete and hints in editors that read TypeScript (VS Code does). Copy it beside `bge.js` and start your game file with `/// <reference path="bge.d.ts" />`. The engine is still plain JavaScript with no build step. A test compares the declarations with the running engine name by name, in both directions, and compiles a sample game against them, so they cannot fall behind.
- `examples/delve`: a top-down dungeon on a tile map, with ghosts that see and path-find, a typed-out intro and scenes that fade.
- Tumble builds its level with `Tilemap` and `map.addTo(world)`, and draws its HUD and coin pops with `Txt`.

### Changes to check when upgrading

- `Tilemap` and `Txt` are new global names.
- `Scenes` has a new property `fade` and a getter `busy`; `go` and `push` take a third argument and `pop` a first. A scene named in a fading `go` is still checked at once, so a typo throws before anything fades.
- `npm run bundle` now also writes `dist/bge.d.ts`, and `npm test` needs the `typescript` dev dependency (only the tests use it).

## 0.7.0

Physics. Nothing that existed has changed its behaviour, apart from the one fix below.

### Added

- **`Physics`: a world of bodies** (new file `physics.js`). `world.add()` takes your own objects, as circles `{ x, y, r }`, boxes `{ x, y, w, h }` or convex polygons `{ x, y, pts }`, and `world.step(dt)` moves them: gravity, mass, `bounce`, `friction`, `drag`, things that rest in stacks, `fixed` walls, fixed bodies with a velocity as moving platforms that carry their riders, `oneWay` platforms, `sensor` bodies that report touches without pushing, and `layer` / `mask` to choose who meets whom. Bodies do not rotate.
- **Nothing tunnels through a wall.** Every pair is tested along the whole of its movement, not only where it ends up, so a bullet moving many times its own size per step still hits a wall one unit thick, and a small fast sensor still reports the enemy it flew through.
- **Floors and walls built from tiles are smooth.** Something sliding along a row of boxes does not catch on the seams between them, the usual trouble with tile maps.
- **What touched what.** After each step a body's `touch` holds the sides being pressed on (1 left, 2 right, 4 top, 8 bottom, as `Collide.clampToBox` returns), so `player.touch & 8` is "standing on something". A body's own `onHit(other, nx, ny, speed)` and `onLeave(other)`, and `world.onBegin` / `world.onEnd`, are called once when a touch starts and once when it ends, after the step, so handlers may add and remove bodies.
- `world.raycast(ox, oy, dx, dy, max, filter)`, `world.query(shape)`, `world.walls(box)`, `world.filter`, `world.draw(ctx)` for seeing the shapes while building a level, and `substeps` / `iterations` to trade speed for exactness.
- **`Collide` for any two shapes**, where a shape is a circle, a box or a convex polygon (wound either way):
  - `Collide.overlap(a, b)`: how deep they overlap, with the shortest way out in `Collide.nx / ny`.
  - `Collide.sweep(a, dx, dy, b)`: when a moving shape first touches another, as a share of the move, with the surface normal. Exact for every pair of shapes.
  - `Collide.ray(ox, oy, dx, dy, shape)`: a ray against any shape, always with the normal (`rayCircle` alone leaves none).
  - `Collide.resolve(a, b, bounce, friction)`: a whole collision in one call, for games that move things themselves: pushes the two apart by mass and exchanges momentum.
- `examples/tumble`: a small platformer sandbox on the physics world.

### Fixed

- **`Collide.separate` with `mass: Infinity` turned the other body's position into `NaN`.** An infinite mass, or `fixed: true`, now means "never moved", here and in everything above.

### Changes to check when upgrading

- `Physics` is a new global name.
- `Collide.separate` leaves an object with `fixed: true` where it is. It used to treat it like any other.

## 0.6.0

More camera. Everything in 0.5 works the same, with one change to framing noted below.

### Added

- **Blended follow.** `cam.follow(boss, 0.001, { blend: 0.6 })` glides over to a new target in 0.6 s instead of cutting, and keeps tracking it on the way, so it lands on a target that moved. `ease` picks the curve.
- **Room to room.** `cam.setBounds(room, 0.5)` swaps the bounds and slides the view into them instead of jumping.
- **`cam.fit(rect, seconds, { padding, ease, hold, onDone })`**: a `moveTo` that ends with the rect filling the view, at any `angle`.
- **`cam.wait()`** is a promise for the end of the first update with no move, zoom, blend or slide running, so a cutscene can be written in order: `await cam.moveTo(x, y, 1, { hold: true }).wait();`
- **Look-ahead from a separate velocity.** `cam.follow(pos, lag, { vel })` reads the lead's velocity from any `{ x, y }`, such as an ECS `Vel`, when the target itself is only a position. It lasts until the next `follow()`; `cam.leadVel` is the field.
- **`cam.layerView(0.5)`** is the rect a parallax layer shows, for culling what is drawn with `cam.apply(ctx, 0.5)`.
- Orb Sweep shoves the camera away from the orb that hits the ship.

### Changes to check when upgrading

- `frame()` with `bounds` set zooms out no farther than it takes to show the whole world (or stops at `maxZoom`, when that is closer). Before, a group spread wider than the world shrank the world to a patch in the middle of the screen.
- The camera has a new property `leadVel` and new methods `fit`, `setBounds`, `wait` and `layerView`. `follow()` takes a third argument.
- While a blend or a bounds slide runs, `cam.x, y` are the gliding view and a value written to them lasts only until the next update. Use `snap()` first, or `moveTo`.

## 0.5.0

The camera. Everything that worked in 0.4 works the same: `follow`, `addTrauma`, `kick`, `bounds`, `view` and the conversions need no changes.

### Added

- **Deadzone.** `cam.deadzone = { w, h }` (world units): the target moves freely inside the box and the camera only moves when it leaves, so small movements no longer drag the whole screen.
- **Look-ahead.** `cam.lead = 0.35` aims that many seconds in front of the target, using its `vx, vy` if it has them and its measured movement if not. `leadMax` caps the distance and `leadLag` sets how fast the lead swings round when the target turns. `cam.offset = { x, y }` shifts the aim point.
- **Group framing.** `cam.frame([p1, p2, boss], { padding, minZoom, maxZoom, lag })` centres on several things and zooms to keep them all in shot (their `r` counts). The list is read every update. `zoom: false` only centres.
- **Zoom.** `cam.zoomTo(z, seconds, ease)` eases by ratio, so the zoom looks as fast at the end as at the start. `cam.zoomAt(z, sx, sy)` zooms and keeps the world point under a screen point where it is, for a mouse wheel or a pinch.
- **Scripted moves.** `cam.moveTo(x, y, seconds, { ease, zoom, hold, onDone })` glides to a point; following waits until it arrives, or with `hold: true` until `cam.release()`. `cam.moving` and `cam.held` say where it is.
- `cam.snap()` jumps to where the camera is heading (a respawn, a teleport), ignoring lag and the deadzone. During a `moveTo` it finishes the move.
- **Rotation.** `cam.angle` turns the view. `toWorld`, `toScreen`, `bounds` and `view` all account for it.
- **Directional kicks.** `cam.kick(10, angle)` pushes the view one way and lets it settle back, for recoil or a landing. `kick(a)` with no angle is the random jolt it was.
- **Shake options.** `shakeFreq` (wobbles a second) makes the shake smooth and the same at any frame rate; `shakeRoll` adds a roll of up to that many radians; `shakeScale` scales all shake, for a "screen shake" setting or reduced motion.
- `cam.apply(ctx, 0.5)` draws a parallax layer at half scroll speed. `cam.pixelSnap = true` lands the view on whole device pixels.
- `toWorld(sx, sy, out)` and `toScreen(wx, wy, out)` fill an object you pass instead of making one.

### Changes to check when upgrading

- Shake takes its random numbers from `Rng.fx` instead of `Math.random`, so `camera.js` now needs `rng.js` loaded before it (it is, in `dist/bge.js` and in the order of `src/index.txt`).
- `follow()` now also cancels a `moveTo` and ends a `frame()`.
- The camera has new properties. A game that stored its own `angle`, `group`, `lead`, `offset`, `deadzone`, `held` or `roll` on a camera should rename them.

## 0.4.0

Particles. Everything that worked in 0.3 works the same: existing kinds, `spawn`, `burst` and `emitter` calls need no changes.

### Added

- **Kinds you describe instead of draw.** `fx.kind('fire', { shape: 'circle', size: [1, 1.4, 0], alpha: [0, 1, 1, 0], colors: ['#fff', '#fd0', '#f40'] })`. Shapes: `circle`, `square`, `rect`, `spark`, `ring`, or `image:` a canvas or image to stamp. A kind with its own `draw()` works as before.
- **Size, opacity and colour over a particle's life.** A curve is a number, evenly spaced stops, timed stops (`[[0, 1], [0.8, 1], [1, 0]]`) or a function of age. Curves and colour ramps become lookup tables when the kind is made, so drawing computes and allocates nothing per particle. A `draw()` of your own can use them through `Particles.curve`, `Particles.ramp` and `Particles.at`; `Particles.rgba` parses a colour.
- **Effects**: several bursts under one name. `fx.effect(name, layers)` defines one and `fx.play(name, x, y, { scale, count, angle, spread, color, vx, vy })` fires it.
- **More ready-made pieces in `Particles.basic`**: kinds `ring` (a shock wave), `flash` and `ember`, and effects `explosion`, `hit`, `puff` and `sparkle`.
- **Burst options**: `inner` (with `radius`: spawn in a ring), `box: [w, h]`, and `outward: true` (fly away from the centre).
- **Emitter options**: `interval` + `count` (pulses instead of a steady rate), `delay`, `duration` with `onDone`, and `inherit` (a share of the emitter's own velocity goes to its particles).
- **Kind options**: `wind` (sideways pull, as `gravity` is the vertical one), `layer` with `fx.draw(ctx, view, layer)` to draw some kinds under the actors and others over them, and `onDeath(s, x, y, vx, vy)` to chain effects.
- `fx.warm(seconds)` runs the system ahead, so a scene can open with its smoke already risen.

### Faster

- `overflow: 'replace'` finds the oldest particle in constant time instead of searching every particle for each one spawned. A full system of 8,192 with 300 spawned a frame went from 2.2 ms to 0.4 ms a frame; 2,048 with 100 a frame from 0.29 ms to 0.11 ms.

### Changes to check when upgrading

- A kind definition's `size`, `alpha`, `colors`, `shape`, `image`, `wind`, `layer` and `onDeath` now mean something. A kind that happened to carry a property with one of those names for its own `draw()` should rename it.
- `Particles.basic` now also defines kinds `ring`, `flash` and `ember`. A kind of your own with one of those names should be defined after `basic()`, not before, or `basic()` replaces it.
- `burst()` takes its random numbers from `Rng.fx` in a different order, so a game that seeds `Rng.fx` to get the same sparks every run will get different ones.
- The private `Particles._swap` is gone (`_kill` replaces it).

## 0.3.0

### Fixed

- **Input: keys could stick down.** A key released under another name than it was pressed with (hold `1`, press Shift, release: the browser reports `!`) stayed in `keys` for good. Key-ups are now matched by physical key as well. On macOS, keys released while Cmd is held send no key-up; releasing Cmd now releases them.
- **Input: one finger's release let go of every finger.** Lifting a second finger cleared `pointer.down`, and a cancelled touch never released at all. A second mouse button pressed while the first was held was not seen (browsers report it as a move, not a press), so `mouse:2` never fired during a left-button hold. Each pointer and button is now tracked on its own.
- **Input: typing in a `<textarea>` or an editable element drove the game.** Only `<input>` was left alone before.
- **Loop: a hitstop froze the whole frame it ended in.** Only the frozen part of the frame is lost now, so a 20 ms hitstop takes 20 ms rather than up to a frame more.
- **Clock: `every()` fired at most once per update.** An interval shorter than the frame ran slow (`every(0.01)` gave 60 a second at 60 fps, not 100). It now fires as often as fits.
- **Clock kept every object it had ever tweened**, so none of them could be garbage collected. Finished tweens are forgotten.
- **Particles: `spawn()` with an unknown kind threw after taking a slot**, leaving a stale particle behind. A kind with no `draw` now fails in `kind()`, not later inside `draw()`.
- **ECS: `World.add()` on a destroyed entity left a component with no entity**, which queries then kept returning for ever. It now does nothing and returns `undefined`.
- **Scenes: `go()` or `push()` with an unknown name** threw after the current scenes had already been exited or paused. The name is checked first.
- **Sprites: a cached sprite was stretched after a zoom or a resize** unless the game put the scale in the key itself. `Sprites.get` now keeps one copy per scale, rounding the scale up to one of 16 sizes per doubling so a smooth zoom makes a handful of copies.
- **Sound: `muted = true` did not silence sounds already playing**, and drones only noticed at their next `set()`. It now acts on the master gain. `Sound.load` reports a missing file by name instead of failing inside the decoder.
- **Camera: the `view` rect ignored screen shake**, so culled things could pop at the screen edge during a shake.
- **Orb Sweep never read the gamepad** (nothing called `Input.pollPad()`), although it lists pad controls.

### Added

- `Loop.start({ autoInput: true })`: the loop calls `Input.pollPad()` and `Input.endFrame()` itself, after each update rather than each frame. With a fixed step on a fast display some frames run no update, and clearing presses in `render` loses them; this way each press reaches exactly one update. Presses also wait out a hitstop. While paused or at `timeScale` 0 they are cleared after `render`, so a menu drawn from `render` sees each press once. `Loop.updates` is the number of updates in the current frame.
- `Input.block([...])` stops chosen keys scrolling the page; `Input.wheel`; `Input.mouseDown(button)`; `Input.unbind`; `Input.releaseAll()`.
- `SpatialHash.within(x, y, r)`: exactly the things whose own circle touches the query circle, so callers no longer pad the radius and re-check distances. `hash.maxR` is the largest radius inserted.
- `Collide.rayBox`, `Collide.segments`, `Collide.pushOutOfBox` and `Collide.bounce`, with the surface normal in `Collide.nx / ny`.
- `Sprites.sheet(image, frameW, frameH)`: frames from a grid image, with `draw()` (size, rotation, flips, alpha, anchor) and `anim()` frame animations.
- `Store.update`, `Store.keys`, `Store.clear`, and a memory fallback: when storage is blocked or full, values last for the session and `store.persistent` is `false`. `clear()` keeps the migration version and does nothing on a store with no namespace.
- `Ease`: `inSine`, `outSine`, `inOutSine`, `inBack`, `inOutBack`, `inOutExpo`. Timer and tween handles can be awaited.
- `Bus.emit` passes up to three arguments; `off()` also removes a `once()` handler; `Bus.count(name)`.
- `World.exists(id)`, `World.size`, `World.clear()`. A drone has `stop()`.
- A moving particle emitter spreads its particles along the path it travelled, so a fast trail is a line rather than a clump per frame. A jump of more than `emitter.maxGap` (200) counts as a teleport.

### Faster

- `SpatialHash.nearest` searches outwards and stops as soon as nothing farther can win, and allocates nothing. It used to scan every cell within `maxR`. `maxR` is now optional.
- `SpatialHash.query` only walks cells that are in use, so a huge radius is safe.
- `Bus.emit` no longer copies the handler list on every call.

### Changes to check when upgrading

- Gamepad sticks have a round dead zone instead of one per axis, and the right stick (`pad.rx / ry`) now has one too.
- `Particles.kind()` throws when `draw` is missing.
- `World.add()` on an entity that no longer exists does nothing.
- `Bus` handlers get three arguments at most (`once()` handlers used to get them all, `on()` handlers one).
- `netJoin()` before `netInit()` rejects instead of throwing.

## 0.2.1

- `Particles.burst` draws from `Rng.fx`, so effects never shift gameplay randomness.

## 0.2.0

- `Camera.kick`, `Rng.fx`, `MusicPlayer` pause / resume.

## 0.1.0

- The engine from Battle Bot Survivors, made reusable.
