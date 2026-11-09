'use strict';
/* ================================================================
   EVENTS: a tiny publish / subscribe bus so systems can react to each other without calling each other.
     const off = Events.on('kill', e => score += e.points);   // returns an unsubscribe function
     Events.once('bossDown', fn);  Events.emit('kill', { points: 10 });  off();
     Events.off('bossDown', fn);   // works for on() and once() handlers alike
   new Bus() makes a separate bus (one per match, say). Handlers run in the order they were added, and get up to
   three arguments: emit('hit', target, damage). A handler added or removed during an emit takes effect from the
   next emit. emit() allocates nothing.
   ================================================================ */
class Bus {
  constructor(){ this.map = new Map(); }
  // Subscribing and unsubscribing replace the handler array instead of changing it, so an emit that is running
  // keeps walking the array it started with and emit() never has to copy.
  on(name, fn){
    const l = this.map.get(name);
    this.map.set(name, l ? l.concat(fn) : [fn]);
    return () => this.off(name, fn);
  }
  once(name, fn){ const w = (a, b, c) => { this.off(name, w); fn(a, b, c); }; w.fn = fn; return this.on(name, w); }
  off(name, fn){
    const l = this.map.get(name); if (!l) return;
    const i = l.findIndex(h => h === fn || h.fn === fn); if (i < 0) return;
    if (l.length === 1) this.map.delete(name); else { const n = l.slice(); n.splice(i, 1); this.map.set(name, n); }
  }
  emit(name, a, b, c){
    const l = this.map.get(name); if (!l) return;
    for (let i = 0; i < l.length; i++) l[i](a, b, c);
  }
  count(name){ const l = this.map.get(name); return l ? l.length : 0; }
  clear(name){ if (name) this.map.delete(name); else this.map.clear(); }
}
const Events = new Bus();
addEventListener('resize', () => Events.emit('resize', { vw, vh, dpr }));   // after core.js has updated the view size
