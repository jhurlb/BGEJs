'use strict';
/* ================================================================
   SAVED DATA in localStorage, namespaced per game, with versions and migrations. Never throws:
   in a private window or with storage blocked or full, values are kept in memory for the session instead
   (so a settings screen still works), and store.persistent turns false.
     const save = new Store('mygame');
     save.get('settings', { vol: 0.8 });    // the default comes back when nothing is saved or it can't be read
     save.set('settings', { vol: 0.5 });  save.remove('settings');
     save.update('stats', s => { s.runs++; return s; }, { runs: 0 });   // read, change, write
     save.keys();  save.clear();            // only this namespace
     save.migrate(2, { 2: data => { ... } });   // runs each step above the saved version once, in order
   Values are JSON. Keys are stored as `${ns}.${key}`. set() returns false when the value could not be written to disk.
   ================================================================ */
class Store {
  constructor(ns){ this.ns = ns; this.mem = new Map(); this.persistent = true; }
  _k(key){ return this.ns ? `${this.ns}.${key}` : key; }
  get(key, def = null){
    const k = this._k(key);
    if (this.mem.has(k)) { try { return JSON.parse(this.mem.get(k)); } catch (e) { return def; } }
    try { const s = localStorage.getItem(k); return s === null ? def : JSON.parse(s); } catch (e) { return def; }
  }
  set(key, v){
    const k = this._k(key); let s;
    try { s = JSON.stringify(v); } catch (e) { return false; }   // a cycle or a BigInt
    if (s === undefined) return false;
    try { localStorage.setItem(k, s); this.mem.delete(k); return true; } catch (e) { this.mem.set(k, s); this.persistent = false; return false; }
  }
  update(key, fn, def = null){ const v = fn(this.get(key, def)); this.set(key, v); return v; }
  remove(key){ const k = this._k(key); this.mem.delete(k); try { localStorage.removeItem(k); } catch (e) {} }
  // The keys saved under this namespace (without the prefix).
  keys(){
    const pre = this.ns ? `${this.ns}.` : '', out = new Set();
    for (const k of this.mem.keys()) out.add(k.slice(pre.length));
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k !== null && k.startsWith(pre)) out.add(k.slice(pre.length)); } } catch (e) {}
    return [...out];
  }
  clear(){ for (const k of this.keys()) this.remove(k); }
  // steps: { [version]: fn(store) }. Each runs once, lowest first, for versions above the saved one.
  migrate(version, steps = {}){
    const at = this.get('__version', 0);
    for (const v of Object.keys(steps).map(Number).sort((a, b) => a - b)) if (v > at && v <= version) { try { steps[v](this); } catch (e) {} }
    if (at !== version) this.set('__version', version);
  }
}
