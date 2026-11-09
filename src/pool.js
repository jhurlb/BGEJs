'use strict';
/* ================================================================
   OBJECT POOL: reuse short-lived objects instead of allocating them every frame (less garbage, fewer GC stutters).
     const shots = new Pool(() => ({ x: 0, y: 0, vx: 0, vy: 0 }), o => { o.hit = null; }, 256);
     const s = shots.get();  ...  shots.release(s);
   make() builds a fresh object, reset(o) clears one as it goes back, `prefill` builds that many up front.
   ================================================================ */
class Pool {
  constructor(make, reset = null, prefill = 0){ this.make = make; this.reset = reset; this.free = []; for (let i = 0; i < prefill; i++) this.free.push(make()); }
  get(){ return this.free.length ? this.free.pop() : this.make(); }
  release(o){ if (this.reset) this.reset(o); this.free.push(o); }
  get size(){ return this.free.length; }
}
