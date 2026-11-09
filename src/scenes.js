'use strict';
/* ================================================================
   SCENES: a stack of game states (title, play, pause...). The top scene gets update(); every scene in the stack
   is drawn bottom to top unless one above it is `opaque`.
     Scenes.add('title', { enter(args){}, exit(){}, update(dt){}, render(c){}, opaque: true });
     Scenes.go('play', { level: 1 });    // replace the whole stack
     Scenes.push('pause');  Scenes.pop();  // overlays
     Scenes.update(dt);  Scenes.render(ctx);   // from your Loop
   Scenes.current is the top scene's name. Hooks are optional. pause(), resume() run on the scene under a push / pop.

   TRANSITIONS: a last argument to go, push or pop fades the screen out, switches behind the cover, and fades back in.
     Scenes.go('play', { level: 2 }, 0.5);                    // half a second through black
     Scenes.go('title', null, { fade: 0.8, color: '#fff' });  // through white
     Scenes.pop({ fade: 0.6, draw(c, k){ ... } });            // your own cover: k goes 0 -> 1 (covered, the switch happens) -> 0
   It is driven by Scenes.update(dt) and drawn by Scenes.render(ctx), over every scene. The scene on top is not updated
   while the cover closes, so nothing is pressed twice (freeze: false keeps it running). Scenes.busy is true meanwhile.
   A second go / push / pop with a transition while the cover is still closing replaces the first.
   ================================================================ */
const Scenes = {
  defs: new Map(), stack: [], fade: null,
  add(name, def){ this.defs.set(name, { name, ...def }); return this; },
  get current(){ const s = this.stack[this.stack.length - 1]; return s ? s.name : null; },
  _get(name){ const d = this.defs.get(name); if (!d) throw new Error(`Scenes: unknown scene "${name}"`); return d; },
  // The name is checked first, so a typo throws before any scene has been exited or paused.
  go(name, args, tr){ const d = this._get(name); if (tr) return this._via(tr, () => this.go(name, args)); while (this.stack.length) this.stack.pop().exit?.(); this.stack.push(d); d.enter?.(args); },
  push(name, args, tr){ const d = this._get(name); if (tr) return this._via(tr, () => this.push(name, args)); this.stack[this.stack.length - 1]?.pause?.(); this.stack.push(d); d.enter?.(args); },
  pop(tr){ if (tr) return this._via(tr, () => this.pop()); const d = this.stack.pop(); d?.exit?.(); this.stack[this.stack.length - 1]?.resume?.(); return d; },
  get busy(){ return !!this.fade; },
  _via(o, act){
    if (typeof o === 'number') o = { fade: o };
    const f = this.fade;
    if (f && f.act) { f.act = act; return; }   // still closing: switch to the newer place instead
    this.fade = { t: 0, dur: Math.max(1e-6, o.fade ?? 0.4), color: o.color || '#000', draw: o.draw || null, freeze: o.freeze !== false, act };
  },
  update(dt){
    const f = this.fade;
    if (f) {
      const closing = !!f.act; f.t += dt;
      if (closing && f.t >= f.dur / 2) { const act = f.act; f.act = null; act(); }
      if (f.t >= f.dur && this.fade === f) this.fade = null;
      if (closing && f.freeze) return;
    }
    const top = this.stack[this.stack.length - 1]; top?.update?.(dt);
  },
  render(c){
    let from = 0;
    for (let i = this.stack.length - 1; i >= 0; i--) if (this.stack[i].opaque) { from = i; break; }
    for (let i = from; i < this.stack.length; i++) this.stack[i].render?.(c);
    const f = this.fade;
    if (f) {
      const k = clamp(1 - Math.abs(1 - 2 * f.t / f.dur), 0, 1), cn = c.canvas || cv;
      if (f.draw) f.draw(c, k);
      else { c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = k; c.fillStyle = f.color; c.fillRect(0, 0, cn.width, cn.height); c.restore(); }
    }
  },
};
