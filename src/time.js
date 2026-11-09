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
   ================================================================ */
const Ease = {
  linear: t => t,
  inQuad: t => t * t, outQuad: t => t * (2 - t), inOutQuad: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  inCubic: t => t * t * t, outCubic: t => 1 - (1 - t) ** 3, inOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2,
  outBack: t => { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
  outElastic: t => t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1,
  outBounce: t => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; },
  inExpo: t => t === 0 ? 0 : 2 ** (10 * t - 10), outExpo: t => t === 1 ? 1 : 1 - 2 ** (-10 * t),
};
class Clock {
  constructor(){ this.t = 0; this.items = []; this.tweens = new Map(); }
  _add(it){ it.cancel = () => { it.dead = true; }; it.then = fn => { it.done = fn; return it; }; this.items.push(it); return it; }
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
            if (k >= 1) { it.dead = true; it.done && it.done(); }
          }
        } else if (this.t >= it.at) {
          it.fn();
          if (it.every && --it.left > 0) it.at += it.every; else { it.dead = true; it.done && it.done(); }
        }
      }
      if (!it.dead) list[w++] = it;
      else if (it.tween) { const m = this.tweens.get(it.obj); if (m) { for (const p in m) if (m[p] === it) delete m[p]; } }
    }
    list.length = w;
  }
}
Clock.main = new Clock();
