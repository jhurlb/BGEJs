'use strict';
/* ================================================================
   EVENTS: a tiny publish / subscribe bus so systems can react to each other without calling each other.
     const off = Events.on('kill', e => score += e.points);   // returns an unsubscribe function
     Events.once('bossDown', fn);  Events.emit('kill', { points: 10 });  off();
   new Bus() makes a separate bus (one per match, say). Handlers run in the order they were added.
   ================================================================ */
class Bus {
  constructor(){ this.map = new Map(); }
  on(name, fn){
    let l = this.map.get(name); if (!l) this.map.set(name, l = []);
    l.push(fn);
    return () => this.off(name, fn);
  }
  once(name, fn){ const off = this.on(name, (...a) => { off(); fn(...a); }); return off; }
  off(name, fn){
    const l = this.map.get(name); if (!l) return;
    const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
  }
  emit(name, data){
    const l = this.map.get(name); if (!l || !l.length) return;
    for (const fn of l.slice()) fn(data);   // a copy, so handlers can unsubscribe while running
  }
  clear(name){ if (name) this.map.delete(name); else this.map.clear(); }
}
const Events = new Bus();
addEventListener('resize', () => Events.emit('resize', { vw, vh, dpr }));   // after core.js has updated the view size
