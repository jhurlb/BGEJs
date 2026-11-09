# Changelog

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
