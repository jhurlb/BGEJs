'use strict';
/* ================================================================
   SCENES: a stack of game states (title, play, pause...). The top scene gets update(); every scene in the stack
   is drawn bottom to top unless one above it is `opaque`.
     Scenes.add('title', { enter(args){}, exit(){}, update(dt){}, render(c){}, opaque: true });
     Scenes.go('play', { level: 1 });    // replace the whole stack
     Scenes.push('pause');  Scenes.pop();  // overlays
     Scenes.update(dt);  Scenes.render(ctx);   // from your Loop
   Scenes.current is the top scene's name. Hooks are optional. pause(), resume() run on the scene under a push / pop.
   ================================================================ */
const Scenes = {
  defs: new Map(), stack: [],
  add(name, def){ this.defs.set(name, { name, ...def }); return this; },
  get current(){ const s = this.stack[this.stack.length - 1]; return s ? s.name : null; },
  _get(name){ const d = this.defs.get(name); if (!d) throw new Error(`Scenes: unknown scene "${name}"`); return d; },
  // The name is checked first, so a typo throws before any scene has been exited or paused.
  go(name, args){ const d = this._get(name); while (this.stack.length) this.stack.pop().exit?.(); this.stack.push(d); d.enter?.(args); },
  push(name, args){ const d = this._get(name); this.stack[this.stack.length - 1]?.pause?.(); this.stack.push(d); d.enter?.(args); },
  pop(){ const d = this.stack.pop(); d?.exit?.(); this.stack[this.stack.length - 1]?.resume?.(); return d; },
  update(dt){ const top = this.stack[this.stack.length - 1]; top?.update?.(dt); },
  render(c){
    let from = 0;
    for (let i = this.stack.length - 1; i >= 0; i--) if (this.stack[i].opaque) { from = i; break; }
    for (let i = from; i < this.stack.length; i++) this.stack[i].render?.(c);
  },
};
