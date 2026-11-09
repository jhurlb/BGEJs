'use strict';
/* ================================================================
   TIMERS AND TWEENS, driven by a Clock you tick from your update (so they pause and slow down with the game).
     const clock = new Clock();             // or use Clock.main
     clock.after(2, () => spawnBoss());     // once, in 2 s
     const h = clock.every(0.5, () => ...); h.cancel();
     clock.tween(sprite, { x: 300, alpha: 0 }, 0.4, Ease.outCubic).then(() => ...);
     clock.update(dt);                      // call once per update
   tween() animates numeric properties from their current values. It returns a handle with cancel() and then(fn).
   Tweening the same property of the same object again replaces the old tween on that property.
   Handles can be awaited: `await clock.after(1); await clock.tween(o, { x: 9 }, 0.3);` (a cancelled one never resolves).
   every() keeps its rate when the interval is shorter than a frame: it fires as many times as fit in the update.
   Ease has linear and in / out / inOut versions of Quad, Cubic, Sine, Expo and Back, plus outElastic and outBounce.
   ================================================================ */
const Ease = {
  linear: t => t,
  inQuad: t => t * t, outQuad: t => t * (2 - t), inOutQuad: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  inCubic: t => t * t * t, outCubic: t => 1 - (1 - t) ** 3, inOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2,
  inSine: t => 1 - Math.cos(t * Math.PI / 2), outSine: t => Math.sin(t * Math.PI / 2), inOutSine: t => (1 - Math.cos(t * Math.PI)) / 2,
  inBack: t => { const c = 1.70158; return (c + 1) * t * t * t - c * t * t; },
  outBack: t => { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
  inOutBack: t => { const c = 1.70158 * 1.525; return t < 0.5 ? (2 * t) ** 2 * ((c + 1) * 2 * t - c) / 2 : ((2 * t - 2) ** 2 * ((c + 1) * (2 * t - 2) + c) + 2) / 2; },
  outElastic: t => t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1,
  outBounce: t => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; },
  inExpo: t => t === 0 ? 0 : 2 ** (10 * t - 10), outExpo: t => t === 1 ? 1 : 1 - 2 ** (-10 * t),
  inOutExpo: t => t === 0 || t === 1 ? t : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2,
};
class Clock {
  constructor(){ this.t = 0; this.items = []; this.tweens = new Map(); }
  _add(it){ it.cancel = () => { it.dead = true; }; it.then = fn => { const prev = it.done; if (it.ended) fn(); else it.done = prev ? () => { prev(); fn(); } : fn; return it; }; this.items.push(it); return it; }   // then() after the end still runs fn
  _end(it){ it.dead = it.ended = true; it.done && it.done(); }
  after(sec, fn){ return this._add({ at: this.t + sec, fn }); }
  every(sec, fn, times = Infinity){ return this._add({ at: this.t + sec, fn, every: sec, left: times }); }
  tween(obj, props, dur, ease = Ease.outQuad, delay = 0){
    const to = {}; for (const k in props) to[k] = props[k];
    const it = this._add({ obj, from: {}, to, started: false, dur: Math.max(1e-6, dur), start: this.t + delay, ease, tween: true });
    let m = this.tweens.get(obj); if (!m) this.tweens.set(obj, m = {});
    for (const k in props) { if (m[k] && m[k] !== it) delete m[k].to[k]; m[k] = it; }   // newest tween owns each property
    return it;
  }
  cancelAll(obj){ for (const it of this.items) if (!obj || it.obj === obj) it.dead = true; if (obj) this.tweens.delete(obj); else this.tweens.clear(); }
  // Forget a finished tween. The per-object entry goes too once it is empty, so tweened objects can be collected.
  _drop(it){
    const m = this.tweens.get(it.obj); if (!m) return;
    let left = false; for (const p in m) { if (m[p] === it) delete m[p]; else left = true; }
    if (!left) this.tweens.delete(it.obj);
  }
  get count(){ return this.items.length; }
  update(dt){
    this.t += dt;
    const list = this.items; let w = 0;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (!it.dead) {
        if (it.tween) {
          if (this.t >= it.start) {
            const k = Math.min(1, (this.t - it.start) / it.dur), e = it.ease(k);
            if (!it.started) { for (const p in it.to) it.from[p] = it.obj[p]; it.started = true; }   // start values are read when the tween starts, not when it is made
            for (const p in it.to) it.obj[p] = it.from[p] + (it.to[p] - it.from[p]) * e;
            if (k >= 1) this._end(it);
          }
        } else if (it.every === undefined) {
          if (this.t >= it.at) { it.fn && it.fn(); this._end(it); }
        } else {
          // catch up when the interval is shorter than the update; a zero interval fires once per update
          while (!it.dead && this.t >= it.at) {
            it.fn();
            if (it.dead) break;   // cancelled from inside its own callback
            if (--it.left > 0) { it.at += it.every; if (!(it.every > 0)) break; } else this._end(it);
          }
        }
      }
      if (!it.dead) list[w++] = it;
      else if (it.tween) this._drop(it);
    }
    list.length = w;
  }
}
Clock.main = new Clock();
