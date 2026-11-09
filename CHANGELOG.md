# Changelog

## 0.5.0

The camera. Everything that worked in 0.4 works the same: `follow(target, lag)`, `bounds`, `zoom`, `addTrauma`, `kick(pixels)`, `view`, `apply` and the conversions need no changes, and a camera that sets none of the new options moves and shakes exactly as before.

### Added

- **Dead zone**: `cam.follow(player, 0.001, { deadzone: { w: 120, h: 80 } })`. The target moves freely inside a box in the middle of the view, and the camera only moves when the target pushes an edge, so small movements no longer drag the whole screen about.
- **Look-ahead**: `{ lookAhead: 0.35 }` leads the target by that many seconds of its velocity, up to `lookMax` world units, and swings round smoothly (`lookLag`). The velocity comes from `vel` (any `{ x, y }`, such as an ECS `Vel`), else the target's `vx / vy`, else from how the target moves.
- **`offset`** aims beside the target, **`blend`** glides to a new target instead of cutting to it, and **`cam.snap()`** jumps to where the follow rests (it replaces `cam.x = t.x; cam.y = t.y` after a respawn).
- **Framing a group**: `cam.frame(list, lag, { margin, minZoom, maxZoom, zoomLag })` centres on a list of `{ x, y, r? }` and zooms so they all fit. The list is read every update. With bounds set it never zooms out past the world.
- **Pans and zooms over time**: `moveTo(x, y, seconds, ease)`, `zoomTo(zoom, seconds, ease)`, `fit(rect, seconds, ease, margin)`, and `setBounds(bounds, seconds)` to slide from room to room. Each returns a handle with `cancel()` and `then()`, so a cutscene can `await` them. A zoom moves by ratio, so it looks even from start to end.
- **`zoomAt(zoom, screenX, screenY)`** zooms with the world point under the cursor held still, for mouse-wheel zoom on a map.
- **Rotation**: `cam.rot` in radians. `apply`, `toWorld`, `toScreen`, the `view` rect, the bounds and group framing all allow for it.
- **Smooth shake**: `cam.shakeFreq = 30` shakes along a smooth path at that many wobbles a second, the same at 60 and 240 frames a second. The default (0) is a fresh random offset every update, as before, which gets finer and harsher as the frame rate rises.
- **Rolling shake**: `cam.shakeRot` rolls the view by up to that many radians at full trauma.
- **Directed kick**: `cam.kick(pixels, angle)` shoves the camera one way and lets it settle back (recoil, a hit from one side). Shoves add up, to `kickMax`.
- **Parallax**: `cam.apply(ctx, 0.5)` draws a layer that moves at half the camera's speed, and `cam.layerView(0.5)` is the rect of that layer on screen.
- `cam.pixelSnap` rounds the view to whole device pixels for crisp pixel art. `toWorld` and `toScreen` take an optional object to fill, so a per-frame call need not allocate. `zoomMin` / `zoomMax` limit `zoomTo`, `zoomAt` and `fit`.
- Orb Sweep uses look-ahead, the smooth rolling shake and a directed kick when the ship is hit.

### Changes to check when upgrading

- `Camera` has new fields: `rot`, `deadzone`, `offset`, `lookAhead`, `lookMax`, `lookLag`, `lookVel`, `lx`, `ly`, `targets`, `frameMargin`, `frameMin`, `frameMax`, `zoomLag`, `zoomMin`, `zoomMax`, `pixelSnap`, `shakeFreq`, `shakeRot`, `jx`, `jy`, `orot`. A game that hung a property of its own with one of those names on a camera should rename it.
- `follow()` and `frame()` each end the other, and `moveTo()` and `fit()` end both.

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
