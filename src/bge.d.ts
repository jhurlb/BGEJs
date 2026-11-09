// Type declarations for BGEjs, for autocomplete and hints in an editor. The engine itself is plain JavaScript.
// Put this file beside your game (next to bge.js) and add `/// <reference path="bge.d.ts" />` as the first line of
// your game file, or list it in a jsconfig.json. tests/types.test.js checks every name here against the real engine.

// ---- shared shapes ----
interface BgePoint { x: number; y: number }
/** A world rect by its edges, as `cam.view` and `cam.bounds` use. */
interface BgeRect { x0: number; y0: number; x1: number; y1: number }
/** A circle: x, y is its centre. */
interface BgeCircle { x: number; y: number; r: number }
/** A box: x, y is its top-left corner. */
interface BgeBox { x: number; y: number; w: number; h: number }
/** A convex polygon: pts is [x0, y0, x1, y1, ...] relative to x, y. */
interface BgePoly { x: number; y: number; pts: number[] }
type BgeShape = BgeCircle | BgeBox | BgePoly;
type BgeEase = (t: number) => number;
type BgeCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type BgeImage = HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | ImageBitmap;

// ---- core.js ----
declare const cv: HTMLCanvasElement;
declare const ctx: CanvasRenderingContext2D;
/** Tune the default zoom, then call resize(). */
declare const VIEW: { ref: number; minScale: number; maxScale: number; maxDpr: number };
/** Device pixels per CSS pixel (capped at VIEW.maxDpr). */
declare let dpr: number;
/** The window size in CSS pixels. */
declare let vw: number;
declare let vh: number;
/** World units to CSS pixels for the default camera. */
declare let scale: number;
declare function resize(): void;
declare const TAU: number;
declare function clamp(v: number, a: number, b: number): number;
declare function lerp(a: number, b: number, t: number): number;
declare function invLerp(a: number, b: number, v: number): number;
declare function remap(v: number, a0: number, a1: number, b0: number, b1: number): number;
/** Frame-rate independent smoothing: `rate` is the share of the gap left after one second. */
declare function damp(a: number, b: number, rate: number, dt: number): number;
/** The shortest signed turn from angle a to angle b. */
declare function angDiff(a: number, b: number): number;
declare function dist2(ax: number, ay: number, bx: number, by: number): number;
/** Seconds as "mm:ss". */
declare function fmtTime(s: number): string;
declare function $(id: string): HTMLElement | null;
declare function escapeHtml(s: unknown): string;

// ---- rng.js ----
declare class Rng {
  constructor(seed?: number);
  a: number; b: number; c: number; d: number;
  seed(s: number): void;
  /** A uint32. */
  next(): number;
  /** [0, 1) */
  float(): number;
  /** [a, b) */
  range(a: number, b: number): number;
  /** A whole number in [a, b], both ends included. */
  int(a: number, b: number): number;
  chance(p: number): boolean;
  sign(): 1 | -1;
  angle(): number;
  pick<T>(list: ArrayLike<T>): T;
  gauss(mean?: number, sd?: number): number;
  /** In place. */
  shuffle<T>(a: T[]): T[];
  /** items: [[value, weight], ...] */
  weighted<T>(items: [T, number][]): T;
  state(): number[];
  restore(s: number[]): this;
  /** Gameplay randomness: the stream behind rand, pickW and shuffle. */
  static main: Rng;
  /** Looks and sounds, so they never shift gameplay numbers. */
  static fx: Rng;
  /** Reseed Rng.main. */
  static seed(n: number): void;
}
declare function rand(a: number, b: number): number;
declare function pickW<T>(items: [T, number][]): T;
declare function shuffle<T>(a: T[]): T[];

// ---- events.js ----
declare class Bus {
  map: Map<string, Function[]>;
  /** Returns a function that unsubscribes. */
  on(name: string, fn: (a?: any, b?: any, c?: any) => void): () => void;
  once(name: string, fn: (a?: any, b?: any, c?: any) => void): () => void;
  off(name: string, fn: Function): void;
  emit(name: string, a?: any, b?: any, c?: any): void;
  count(name: string): number;
  clear(name?: string): void;
}
declare const Events: Bus;

// ---- ecs.js ----
declare class World {
  nextId: number; stores: Map<string, Map<number, any>>; alive: Set<number>; dead: number[]; lists: Map<string, any[]>; stale: Set<string>;
  store(name: string): Map<number, any>;
  spawn(comps: Record<string, any>): number;
  add<T>(id: number, name: string, data: T): T | undefined;
  exists(id: number): boolean;
  /** Live entities. */
  readonly size: number;
  get(id: number, name: string): any;
  has(id: number, name: string): boolean;
  remove(id: number, name: string): void;
  count(name: string): number;
  first(name: string): number;
  /** Removed when the phase ends. */
  destroy(id: number): void;
  /** Removed now. */
  kill(id: number): void;
  /** One component kind as a cached array. */
  list(name: string): any[];
  flush(): void;
  clear(): void;
  each(names: string[], fn: (id: number, ...comps: any[]) => void): void;
}
declare const SYSTEMS: Record<string, { name: string; fn: Function; order: number }[]>;
/** Register a system for a phase; lower order runs first. A system that returns false ends the phase. */
declare function system(phase: string, name: string, fn: (world: World, dt: number) => boolean | void, order?: number): void;
declare function runSystems(phase: string, world: World | null | undefined, dt: number): void;
declare function ecsBasics(phase?: string): void;

// ---- loop.js ----
interface BgeLoopOptions {
  update?: ((dt: number) => void) | null;
  render?: ((dt: number, alpha: number) => void) | null;
  /** Fixed step in seconds; null = variable dt. */
  step?: number | null;
  maxDt?: number; maxSteps?: number; timeScale?: number; paused?: boolean; keepAliveHidden?: boolean;
  /** Let the loop call Input.pollPad() and Input.endFrame() at the right moments. */
  autoInput?: boolean;
}
declare const Loop: {
  update: ((dt: number) => void) | null; render: ((dt: number, alpha: number) => void) | null; step: number | null; maxDt: number; maxSteps: number;
  timeScale: number; paused: boolean; keepAliveHidden: boolean; autoInput: boolean;
  /** Simulated seconds. */
  time: number;
  /** Wall seconds since start. */
  realTime: number;
  frame: number; fps: number; running: boolean; updates: number;
  start(opts?: BgeLoopOptions): void;
  stop(): void;
  /** Freeze the simulation (not rendering) for a moment. */
  hitstop(sec: number): void;
  readonly frozen: boolean;
};

// ---- time.js ----
declare const Ease: {
  linear: BgeEase; inQuad: BgeEase; outQuad: BgeEase; inOutQuad: BgeEase; inCubic: BgeEase; outCubic: BgeEase; inOutCubic: BgeEase;
  inSine: BgeEase; outSine: BgeEase; inOutSine: BgeEase; inBack: BgeEase; outBack: BgeEase; inOutBack: BgeEase;
  outElastic: BgeEase; outBounce: BgeEase; inExpo: BgeEase; outExpo: BgeEase; inOutExpo: BgeEase;
};
/** What after, every and tween return. It can be awaited (a cancelled one never resolves). */
interface BgeTimer { cancel(): void; then(fn: () => void): BgeTimer; dead?: boolean; ended?: boolean }
declare class Clock {
  t: number; items: any[]; tweens: Map<object, any>;
  after(sec: number, fn?: () => void): BgeTimer;
  every(sec: number, fn: () => void, times?: number): BgeTimer;
  /** Animate numeric properties from their current values. */
  tween<T extends object>(obj: T, props: { [K in keyof T]?: number }, dur: number, ease?: BgeEase, delay?: number): BgeTimer;
  cancelAll(obj?: object): void;
  readonly count: number;
  update(dt: number): void;
  static main: Clock;
}

// ---- scenes.js ----
interface BgeScene {
  enter?(args?: any): void; exit?(): void; pause?(): void; resume?(): void;
  update?(dt: number): void; render?(c: BgeCtx): void;
  /** Scenes under an opaque one are not drawn. */
  opaque?: boolean;
  [key: string]: any;
}
/** Seconds, or { fade: seconds, color, draw(c, k), freeze }. k goes 0 -> 1 (covered) -> 0. */
type BgeTransition = number | { fade?: number; color?: string; draw?(c: BgeCtx, k: number): void; freeze?: boolean };
declare const Scenes: {
  defs: Map<string, BgeScene>; stack: BgeScene[];
  /** The transition that is running, if any. */
  fade: object | null;
  add(name: string, def: BgeScene): typeof Scenes;
  /** The top scene's name. */
  readonly current: string | null;
  /** True while a transition runs. */
  readonly busy: boolean;
  /** Replace the whole stack. */
  go(name: string, args?: any, transition?: BgeTransition): void;
  push(name: string, args?: any, transition?: BgeTransition): void;
  pop(transition?: BgeTransition): BgeScene | undefined;
  update(dt: number): void;
  render(c: BgeCtx): void;
};

// ---- pool.js ----
declare class Pool<T = any> {
  constructor(make: () => T, reset?: ((o: T) => void) | null, prefill?: number);
  make: () => T; reset: ((o: T) => void) | null; free: T[];
  get(): T;
  release(o: T): void;
  readonly size: number;
}

// ---- store.js ----
declare class Store {
  constructor(ns: string);
  ns: string; mem: Map<string, string>;
  /** False once a write has failed and values are kept in memory only. */
  persistent: boolean;
  get<T = any>(key: string, def?: T): T;
  /** False when the value could not be written to disk. */
  set(key: string, v: any): boolean;
  update<T = any>(key: string, fn: (cur: T) => T | void, def?: T): T;
  remove(key: string): void;
  keys(): string[];
  clear(): void;
  migrate(version: number, steps?: Record<number, (store: Store) => void>): void;
}

// ---- collide.js ----
declare const Collide: {
  /** The normal of the surface the last test found. */
  nx: number; ny: number;
  circles(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean;
  pointInBox(px: number, py: number, b: BgeBox): boolean;
  boxes(a: BgeBox, b: BgeBox): boolean;
  circleBox(cx: number, cy: number, r: number, b: BgeBox): boolean;
  segT(px: number, py: number, ax: number, ay: number, bx: number, by: number): number;
  segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number;
  segCircle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): boolean;
  /** Distance along a unit direction to the first hit, or -1. */
  rayCircle(ox: number, oy: number, dx: number, dy: number, cx: number, cy: number, r: number): number;
  rayBox(ox: number, oy: number, dx: number, dy: number, b: BgeBox): number;
  /** Where along a-b the two segments cross (0..1), or -1. */
  segments(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number;
  pointInPoly(px: number, py: number, pts: number[]): boolean;
  /** Push two circles apart by mass. Returns how deep they overlapped. */
  separate(a: BgeCircle & { mass?: number; fixed?: boolean }, b: BgeCircle & { mass?: number; fixed?: boolean }): number;
  invMass(o: { mass?: number; fixed?: boolean }): number;
  pushOutOfBox(o: BgeCircle, b: BgeBox): boolean;
  /** Reflect a velocity off Collide.nx / ny. */
  bounce(v: { vx: number; vy: number }, restitution?: number, nx?: number, ny?: number): void;
  /** How deep a is in b (0 = apart); nx / ny is the way to move a to get out. */
  overlap(a: BgeShape, b: BgeShape, tol?: number): number;
  /** a moves by (dx, dy): the share of the move at which it first touches b, or -1. */
  sweep(a: BgeShape, dx: number, dy: number, b: BgeShape): number;
  ray(ox: number, oy: number, dx: number, dy: number, s: BgeShape): number;
  /** A whole collision: push apart by mass and trade momentum. Returns the overlap. */
  resolve(a: BgeShape & BgeBodyProps, b: BgeShape & BgeBodyProps, bounce?: number, friction?: number): number;
  /** Keep a circle or point inside a box. Returns the sides hit: 1 left, 2 right, 4 top, 8 bottom. */
  clampToBox(o: { x: number; y: number; r?: number }, b: BgeBox): number;
};

// ---- spatial.js ----
declare class SpatialHash<T extends { x: number; y: number; r?: number; dead?: boolean } = any> {
  constructor(cell?: number);
  cell: number; inv: number; cells: Map<number, T[]>; buf: T[]; used: T[][];
  /** The biggest r inserted since clear(). */
  maxR: number; x0: number; y0: number; x1: number; y1: number;
  clear(): void;
  insert(o: T): void;
  /** Rough: everything in the cells the circle touches. */
  query(x: number, y: number, r: number, out?: T[]): T[];
  /** Exactly the things whose circle touches this one. */
  within(x: number, y: number, r: number, out?: T[]): T[];
  nearest(x: number, y: number, maxR?: number, filter?: ((o: T) => boolean) | null): T | null;
}

// ---- physics.js ----
interface BgeBodyProps {
  vx?: number; vy?: number;
  /** 1 if left out. Infinity is the same as fixed. */
  mass?: number;
  /** Never pushed, no gravity. With a velocity it is a moving platform. */
  fixed?: boolean;
  bounce?: number; friction?: number; drag?: number; gravityScale?: number;
  /** Touches are reported but nothing is pushed. */
  sensor?: boolean;
  layer?: number; mask?: number;
  /** On a fixed box: landed on from above only. */
  oneWay?: boolean;
  /** true = taken out at the next step. */
  dead?: boolean;
  /** Called once when this starts touching another body. nx, ny points from the other to this one. */
  onHit?(this: any, other: any, nx: number, ny: number, speed: number): void;
  onLeave?(this: any, other: any): void;
  [key: string]: any;
}
/** What Physics.add gives a body. touch: the sides pressed on, 1 left, 2 right, 4 top, 8 bottom. */
interface BgeBody { vx: number; vy: number; touch: number }
interface BgePhysicsOptions { gravity?: number; gravityX?: number; iterations?: number; substeps?: number; cell?: number; slop?: number; friction?: number; bounceMin?: number }
declare class Physics {
  constructor(opts?: BgePhysicsOptions);
  gravity: number; gravityX: number; iterations: number; substeps: number; cell: number; slop: number; friction: number; bounceMin: number;
  onBegin: ((a: any, b: any, nx: number, ny: number, speed: number) => void) | null;
  onEnd: ((a: any, b: any) => void) | null;
  /** Return false to stop a pair meeting at all. */
  filter: ((a: any, b: any) => boolean) | null;
  bodies: any[]; buf: any[];
  /** How far the last raycast went, or -1. */
  dist: number;
  contacts: number;
  add<T extends BgeShape & BgeBodyProps>(o: T): T & BgeBody;
  remove(o: object): void;
  clear(): void;
  /** Four fixed boxes around the outside of an area. */
  walls(b: BgeBox, thickness?: number, opts?: BgeBodyProps | null): (BgeBox & BgeBody)[];
  step(dt: number): void;
  /** The first body along a unit direction, or null. */
  raycast(ox: number, oy: number, dx: number, dy: number, max?: number, filter?: ((b: any) => boolean) | null): any | null;
  /** Every body that overlaps a shape. */
  query(shape: BgeShape, out?: any[]): any[];
  draw(c: BgeCtx, color?: string): void;
}

// ---- particles.js ----
type BgeRange = number | [number, number];
type BgeCurve = number | number[] | [number, number][] | BgeEase;
interface BgeParticleKind {
  shape?: 'circle' | 'square' | 'rect' | 'spark' | 'ring';
  image?: BgeImage; rotate?: boolean;
  size?: BgeCurve; alpha?: BgeCurve; colors?: string[] | [number, string][];
  drag?: number; gravity?: number; wind?: number; blend?: GlobalCompositeOperation | null; layer?: number; cull?: number;
  stretch?: number; width?: number;
  /** a = life left, 1 -> 0. Read s.x[i], s.y[i], s.size[i], s.color[i]... */
  draw?(c: BgeCtx, s: Particles, i: number, a: number): void;
  onDeath?(s: Particles, x: number, y: number, vx: number, vy: number): void;
  [key: string]: any;
}
interface BgeBurst {
  speed?: BgeRange; angle?: number; spread?: number; life?: BgeRange; size?: BgeRange; color?: string | string[]; spin?: BgeRange; rot?: BgeRange;
  jitter?: number; vx?: number; vy?: number; radius?: number; inner?: number; box?: [number, number]; outward?: boolean;
}
interface BgeEmitterOptions extends BgeBurst {
  x?: number; y?: number; rate?: number; interval?: number; count?: number; delay?: number; duration?: number; inherit?: number; maxGap?: number;
  onDone?(e: BgeEmitter): void;
}
interface BgeEmitter {
  kind: string | number; x: number; y: number; rate: number; on: boolean; opts: BgeEmitterOptions; dead: boolean;
  follow(obj: BgePoint, dx?: number, dy?: number): BgeEmitter;
  stop(): void;
  [key: string]: any;
}
declare class Particles {
  constructor(cap?: number, opts?: { overflow?: 'drop' | 'replace' });
  cap: number; n: number; overflow: 'drop' | 'replace';
  x: Float32Array; y: Float32Array; vx: Float32Array; vy: Float32Array; life: Float32Array; max: Float32Array; size: Float32Array; rot: Float32Array; spin: Float32Array;
  k: Uint8Array; born: Uint32Array; color: string[];
  kinds: any[]; ids: Map<string, number>; emitters: BgeEmitter[]; serial: number; effects: Map<string, any[]>;
  /** Define (or redefine) a kind. Returns its id. */
  kind(name: string, def: BgeParticleKind): number;
  kindId(kind: string | number): number;
  readonly count: number;
  readonly full: boolean;
  clear(): void;
  spawn(kind: string | number, x: number, y: number, vx: number, vy: number, life: number, max?: number, color?: string, size?: number, rot?: number, spin?: number): number;
  burst(kind: string | number, x: number, y: number, n: number, o?: BgeBurst): void;
  /** Several bursts under one name: layers are burst options plus { kind, n }. */
  effect(name: string, layers: (BgeBurst & { kind: string; n?: number })[]): this;
  play(name: string, x: number, y: number, p?: { scale?: number; count?: number; angle?: number; spread?: number; color?: string | string[]; vx?: number; vy?: number } | null): void;
  emitter(kind: string | number, o?: BgeEmitterOptions): BgeEmitter;
  update(dt: number): void;
  /** Run the system ahead, so a scene opens with its smoke already risen. */
  warm(seconds: number, step?: number): this;
  draw(c: BgeCtx, view?: BgeRect | null, layer?: number): void;
  /** A curve as a lookup table. */
  static curve(spec: BgeCurve, n?: number): Float32Array | number[];
  /** A colour ramp as a lookup table of CSS colours. */
  static ramp(colors: string[] | [number, string][], n?: number): string[];
  static at<T>(lut: ArrayLike<T>, t: number): T;
  /** A CSS colour as [r, g, b, a]. */
  static rgba(col: string): number[];
  /** A rotated rectangle as the current path. */
  static rect(c: BgeCtx, x: number, y: number, w: number, h: number, r: number): void;
  /** Adds ready-made kinds and effects. */
  static basic(sys: Particles): Particles;
  static shapes: Record<string, (c: BgeCtx, s: Particles, i: number, a: number) => void>;
}

// ---- camera.js ----
interface BgeMoveOptions { ease?: BgeEase; zoom?: number; hold?: boolean; onDone?: (() => void) | null }
declare class Camera {
  x: number; y: number; zoom: number;
  /** Radians. */
  angle: number;
  target: BgePoint | null; lag: number; bounds: BgeRect | null;
  group: BgePoint[] | null; deadzone: { w: number; h: number } | null; offset: BgePoint | null;
  /** Aim this many seconds in front of the target. */
  lead: number; leadMax: number; leadLag: number; leadVel: BgePoint | null;
  held: boolean; pixelSnap: boolean;
  trauma: number; shakeMax: number; shakeDecay: number; shakeRoll: number; shakeFreq: number; shakeScale: number;
  amp: number; kickDecay: number; kickMax: number; ox: number; oy: number; roll: number;
  /** The visible world rect, for culling. */
  view: BgeRect;
  /** lag: the share of the gap left after one second (0 = snap). */
  follow(t: BgePoint | null, lag?: number, o?: { blend?: number; ease?: BgeEase; vel?: BgePoint }): this;
  /** Keep several things in shot. */
  frame(list: (BgePoint & { r?: number })[], o?: { padding?: number; minZoom?: number; maxZoom?: number; lag?: number; zoom?: boolean }): this;
  snap(): this;
  zoomTo(z: number, secs?: number, ease?: BgeEase, onDone?: (() => void) | null): this;
  /** Zoom now, keeping the world point under a screen point where it is. */
  zoomAt(z: number, sx: number, sy: number): this;
  moveTo(x: number, y: number, secs?: number, o?: BgeMoveOptions): this;
  fit(r: BgeRect, secs?: number, o?: BgeMoveOptions & { padding?: number }): this;
  setBounds(b: BgeRect | null, secs?: number, ease?: BgeEase): this;
  /** Resolves at the end of the first update with no move, zoom, blend or slide running. */
  wait(): Promise<void>;
  release(): this;
  readonly moving: boolean;
  addTrauma(a: number): void;
  kick(a: number, angle?: number): void;
  /** CSS pixels per world unit. */
  readonly k: number;
  update(dt: number): void;
  /** Set the canvas transform; draw the world after this. */
  apply(c: BgeCtx, parallax?: number): void;
  /** Back to CSS-pixel space, for the HUD. */
  applyScreen(c: BgeCtx): void;
  layerView(parallax?: number, out?: Partial<BgeRect>): BgeRect;
  inView(x: number, y: number, margin?: number): boolean;
  toWorld(sx: number, sy: number, out?: Partial<BgePoint>): BgePoint;
  toScreen(wx: number, wy: number, out?: Partial<BgePoint>): BgePoint;
  static smooth: BgeEase;
}

// ---- input.js ----
declare const Input: {
  /** Held keys, by lower-case KeyboardEvent.key. */
  keys: Set<string>;
  pointer: { x: number; y: number; down: boolean; button: number; hasMouse: boolean; type: string };
  /** Wheel movement since the last endFrame(). */
  wheel: number;
  stick: { on: boolean; id: number | null; ox: number; oy: number; x: number; y: number };
  pad: { on: boolean; id: string; lx: number; ly: number; rx: number; ry: number; dx: number; dy: number };
  padDead: number;
  actions: Map<string, [string, string][]>;
  ignore(e: Event): boolean;
  /** A key went down since the last endFrame(). */
  pressed(k: string): boolean;
  endFrame(pad?: boolean): void;
  /** Stop these keys doing their browser job: ['key: ', 'key:arrowup']. */
  block(sources: string[]): void;
  mouseDown(button?: number): boolean;
  releaseAll(): void;
  deadzone(v: number): number;
  pollPad(keep?: boolean): typeof Input.pad;
  padDown(i: number): boolean;
  padHit(i: number): boolean;
  padAnyHit(): boolean;
  stickOn(canvas: HTMLElement, allow?: (e: PointerEvent) => boolean): void;
  stickVec(radius?: number, dead?: number): BgePoint;
  /** sources: 'key:a', 'key: ', 'pad:0', 'mouse:0'. */
  bind(name: string, sources: string[]): void;
  unbind(name: string): void;
  /** The action is held. */
  down(name: string): boolean;
  /** The action was pressed this frame. */
  hit(name: string): boolean;
  /** A direction of length <= 1 from four actions, the left stick and the touch stick. */
  move(a?: { up?: string; down?: string; left?: string; right?: string }): BgePoint;
};
declare const keys: Set<string>;

// ---- ui-nav.js ----
declare const UINav: {
  roots: () => Element[];
  onMove: (() => void) | null;
  focusables(): HTMLElement[];
  move(dir: 'u' | 'd' | 'l' | 'r'): void;
};

// ---- audio.js ----
interface BgeDrone { o: OscillatorNode | null; g: GainNode | null; set(freq: number, vol: number): void; stop(): void }
declare const Sound: {
  ac: AudioContext | null; out: GainNode | null; vol: number; noiseBuf: AudioBuffer | null;
  recipes: Map<string, { fn: Function; gap: number }>; last: Map<string, number>; drones: BgeDrone[];
  muted: boolean;
  /** Call from a click or key press (or use unlockOnGesture). */
  init(): boolean;
  unlockOnGesture(): void;
  setVolume(v: number): void;
  /** gap: the least time between two plays. */
  define(name: string, fn: (S: typeof Sound, t: number) => void, gap?: number): void;
  play(name: string): void;
  noise(dur: number, type: BiquadFilterType, freq: number, vol: number, q?: number, delay?: number): void;
  tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay?: number): void;
  load(url: string): Promise<AudioBuffer>;
  playBuffer(buf: AudioBuffer | null | undefined, o?: { vol?: number; rate?: number; loop?: boolean }): AudioBufferSourceNode | null;
  /** A continuous tone; silent until set(). */
  drone(wave?: OscillatorType, freq?: number, cutoff?: number): BgeDrone;
};

// ---- music.js ----
interface BgeTrack { src: string; name?: string }
declare class MusicPlayer {
  constructor(tracks: BgeTrack[], o?: { loop?: boolean; vol?: number; start?: number; loopFrom?: number });
  tracks: BgeTrack[]; idx: number; loopFrom: number; loop: boolean; want: boolean; held: boolean; el: HTMLAudioElement;
  play(i?: number): void;
  pause(): void;
  resume(): void;
  next(): void;
  stop(unload?: boolean): void;
  /** The track's name while it plays, else ''. */
  readonly playing: string;
  volume: number;
  muted: boolean;
}

// ---- assets.js ----
declare const Assets: {
  cache: Map<string, any>;
  /** An image, AudioBuffer, object (JSON) or string. */
  get(name: string): any;
  has(name: string): boolean;
  load(map: Record<string, string>, onProgress?: (done: number, total: number) => void): Promise<typeof Assets>;
};

// ---- sprites.js ----
interface BgeSprite { cv: HTMLCanvasElement; h: number; w: number; ds: number; raw: number }
interface BgeDrawOptions { w?: number; h?: number; angle?: number; flipX?: boolean; flipY?: boolean; alpha?: number; ox?: number; oy?: number }
interface BgeAnim {
  frames: number[]; fps: number; loop: boolean; onEnd: ((a: BgeAnim) => void) | null; t: number; i: number; done: boolean;
  readonly frame: number;
  reset(): BgeAnim;
  update(dt: number): BgeAnim;
  draw(c: BgeCtx, x: number, y: number, d?: BgeDrawOptions): void;
}
interface BgeSheet {
  img: BgeImage; fw: number; fh: number; cols: number; rows: number; count: number;
  draw(c: BgeCtx, frame: number, x: number, y: number, d?: BgeDrawOptions): void;
  anim(frames: number[], fps?: number, o?: { loop?: boolean; onEnd?: (a: BgeAnim) => void }): BgeAnim;
}
declare const Sprites: {
  map: Map<string, BgeSprite>; max: number; made: number;
  /** Draw once into an offscreen canvas (draw gets a context centred on 0, 0), then stamp it. */
  get(key: string, R: number, ds: number, draw: (c: CanvasRenderingContext2D) => void): BgeSprite;
  stamp(c: BgeCtx, sp: BgeSprite, x?: number, y?: number, ang?: number): void;
  scaleOf(c: BgeCtx): number;
  clear(): void;
  /** Frames cut from one image in a grid. */
  sheet(img: BgeImage, fw: number, fh: number, o?: { margin?: number; spacing?: number }): BgeSheet;
};

// ---- tilemap.js ----
interface BgeTileDef {
  /** false = walked through. */
  solid?: boolean;
  /** A platform landed on from above. h: its thickness as a share of a tile. */
  oneWay?: boolean; h?: number;
  /** A convex polygon in shares of a tile, for Physics. */
  pts?: number[];
  color?: string; frame?: number; frames?: number[]; fps?: number;
  draw?(c: BgeCtx, x: number, y: number, size: number, cx: number, cy: number, id: number): void;
  /** Extra properties for its Physics body. */
  body?: BgeBodyProps;
  [key: string]: any;
}
interface BgeTileLayer { name: string; data: Uint16Array; visible: boolean; alpha: number; chunks: Map<number, any> }
interface BgeTileMark { x: number; y: number; cx: number; cy: number }
type BgeLayerRef = string | number | BgeTileLayer;
declare class Tilemap {
  constructor(cols: number, rows: number, tile?: number, o?: { x?: number; y?: number; layer?: string });
  cols: number; rows: number;
  /** The size of a tile in world units. */
  tile: number;
  x: number; y: number;
  layers: BgeTileLayer[]; defs: (BgeTileDef | undefined)[];
  /** Where the characters that are not tiles were, from Tilemap.from. */
  marks: Record<string, BgeTileMark[]>;
  /** Object layers of a Tiled map, by layer name. */
  objects: Record<string, any[]>;
  sheet: BgeSheet | null; firstId: number;
  paint: ((c: BgeCtx, id: number, x: number, y: number, size: number, cx: number, cy: number) => void) | null;
  color: string;
  /** Pixels per tile for cached pictures of the map; 0 = draw every tile every frame. */
  prerender: number;
  smooth: boolean; time: number;
  /** The layer that collides: a name or a number. */
  collide: string | number;
  /** true = everything outside the map is solid. */
  edge: boolean;
  /** The tile the last raycast hit. */
  hit: { cx: number; cy: number; id: number };
  dist: number;
  /** The Physics bodies made by addTo. */
  bodies: any[];
  readonly w: number;
  readonly h: number;
  /** Fits cam.bounds. */
  readonly bounds: BgeRect;
  /** World x to column. */
  cx(x: number): number;
  cy(y: number): number;
  /** Get or add a layer. */
  layer(name: string): BgeTileLayer;
  get(cx: number, cy: number, layer?: BgeLayerRef): number;
  /** The tile at a world position. */
  at(x: number, y: number, layer?: BgeLayerRef): number;
  set(cx: number, cy: number, id: number, layer?: BgeLayerRef): this;
  fill(cx: number, cy: number, w: number, h: number, id: number, layer?: BgeLayerRef): this;
  def(id: number): BgeTileDef | undefined;
  def(id: number, props: BgeTileDef): this;
  solid(id: number): boolean;
  /** Is this world point in a wall. */
  blocked(x: number, y: number): boolean;
  update(dt: number): void;
  /** Forget the prerendered pictures. */
  redraw(): this;
  draw(c: BgeCtx, view?: BgeRect | null, layer?: BgeLayerRef): void;
  drawTile(c: BgeCtx, id: number, x: number, y: number, size: number, cx: number, cy: number): void;
  /** Move a box or circle and stop at the walls. Returns the sides that hit: 1 left, 2 right, 4 top, 8 bottom. */
  move(o: BgeBox | BgeCircle, dx: number, dy: number, through?: boolean): number;
  /** The walls as fixed Physics bodies. */
  addTo(world: Physics, opts?: BgeBodyProps | null): any[];
  removeFrom(): this;
  /** Distance along a unit direction to the first wall, or -1. */
  raycast(ox: number, oy: number, dx: number, dy: number, max?: number): number;
  sees(ax: number, ay: number, bx: number, by: number): boolean;
  /** The centres of the tiles to pass through, or null when there is no way. */
  path(ax: number, ay: number, bx: number, by: number, o?: { diagonal?: boolean; max?: number; cost?(id: number, cx: number, cy: number): number }): BgePoint[] | null;
  /** From rows of characters. legend: { '#': 1 }. Other characters land in map.marks. */
  static from(lines: string[], tile?: number, legend?: Record<string, number>, o?: { x?: number; y?: number; layer?: string }): Tilemap;
  /** From a map exported by Tiled as JSON. */
  static tiled(json: any, o?: { tile?: number; x?: number; y?: number; collide?: string | number }): Tilemap;
}

// ---- text.js ----
interface BgeBitmapFont {
  id: number; sheet: BgeSheet; map: Map<string, number>; chars: string;
  measure(t: string, size: number): number;
  draw(c: BgeCtx, t: string, x: number, y: number, size: number, color?: string): void;
}
interface BgeTextStyle {
  size?: number; font?: string | BgeBitmapFont; weight?: number | string; italic?: boolean;
  color?: string; alpha?: number;
  align?: 'left' | 'center' | 'right'; valign?: 'top' | 'middle' | 'bottom';
  /** Wrap at this width. */
  width?: number; lineHeight?: number;
  outline?: string; outlineWidth?: number; shadow?: string; shadowX?: number; shadowY?: number;
  angle?: number; scale?: number;
  /** Only the first so many characters. */
  reveal?: number;
  /** Read colour tags: '{#fd5}gold{/}'. */
  rich?: boolean;
  /** A named style to build on. */
  style?: string;
}
interface BgeTextLayout { w: number; h: number; lh: number; chars: number; css: string; lines: { w: number; runs: { text: string; color: string | null; x: number; w: number }[] }[] }
interface BgeTextPop { s: string; x: number; y: number; vx: number; vy: number; gravity: number; t: number; life: number; grow: number; o: BgeTextStyle }
declare const Txt: {
  /** The font family used when a style names none. */
  font: string;
  styles: Map<string, BgeTextStyle>;
  /** Names for rich text: Txt.colors.gold = '#fd5', then '{gold}...{/}'. */
  colors: Record<string, string>;
  pops: BgeTextPop[];
  /** How many layouts are remembered. */
  max: number;
  style(name: string, o: BgeTextStyle): typeof Txt;
  measure(s: unknown, o?: BgeTextStyle | string, c?: BgeCtx): BgeTextLayout;
  draw(c: BgeCtx, s: unknown, x: number, y: number, o?: BgeTextStyle | string): BgeTextLayout;
  /** A font from a grid image: glyphs in the order of `chars`. */
  bitmap(img: BgeImage, fw: number, fh: number, chars: string, o?: { margin?: number; spacing?: number; advance?: number; widths?: Record<string, number>; upper?: boolean }): BgeBitmapFont;
  /** Floating text that rises and fades. */
  pop(s: unknown, x: number, y: number, o?: (BgeTextStyle & { life?: number; vx?: number; vy?: number; gravity?: number; grow?: number }) | string): BgeTextPop;
  update(dt: number): void;
  drawPops(c: BgeCtx, view?: BgeRect | null, margin?: number): void;
  clearPops(): void;
};

// ---- look.js ----
declare const INK: string;
/** Set to 1 around what should get an ink outline. */
declare let inkOn: number;
declare let inkW: number;
declare const FILM: { vigColor: string; vigAlpha: number; flicker: number; scratchOdds: number; dustOdds: number; [key: string]: any };
declare function filmFx(): void;

// ---- profiler.js ----
declare const Profiler: {
  on: boolean; t: Map<string, number>; open: Map<string, number>; counts: Map<string, number>; frameMs: number; fps: number;
  begin(name: string): void;
  end(name: string): void;
  count(name: string, n: number): void;
  frame(): void;
  report(): { name: string; ms: number }[];
  draw(c: BgeCtx, top?: number): void;
};

// ---- net.js ----
interface BgePeer { peer: string; isMe: boolean; sameTab: boolean; presence: Record<string, any> }
interface BgeRoom { presence(patch: Record<string, any>): Promise<void>; peers(): BgePeer[]; leave(): Promise<void>; [key: string]: any }
declare const NET: { kind: 'room' | 'local' | 'none' | null; api: any; lobby: BgeRoom | null; channel: string };
declare function localNet(): { lobby: BgeRoom; join(name: string): Promise<BgeRoom> };
/** Pick a transport. Resolves false when none is available. */
declare function netInit(): Promise<boolean>;
declare function netJoin(name: string): Promise<BgeRoom>;
declare function safePres(room: BgeRoom, obj: Record<string, any>): void;
