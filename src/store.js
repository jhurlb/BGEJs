'use strict';
/* ================================================================
   SAVED DATA in localStorage, namespaced per game, with versions and migrations. Never throws:
   a private window or blocked storage just means nothing is kept.
     const save = new Store('mygame');
     save.get('settings', { vol: 0.8 });    // the default comes back when nothing is saved or it can't be read
     save.set('settings', { vol: 0.5 });  save.remove('settings');
     save.migrate(2, { 2: data => { ... } });   // runs each step above the saved version once, in order
   Values are JSON. Keys are stored as `${ns}.${key}`.
   ================================================================ */
class Store {
  constructor(ns){ this.ns = ns; }
  _k(key){ return this.ns ? `${this.ns}.${key}` : key; }
  get(key, def = null){
    try { const s = localStorage.getItem(this._k(key)); return s === null ? def : JSON.parse(s); } catch (e) { return def; }
  }
  set(key, v){ try { localStorage.setItem(this._k(key), JSON.stringify(v)); return true; } catch (e) { return false; } }
  remove(key){ try { localStorage.removeItem(this._k(key)); } catch (e) {} }
  // steps: { [version]: fn(store) }. Each runs once, lowest first, for versions above the saved one.
  migrate(version, steps = {}){
    const at = this.get('__version', 0);
    for (const v of Object.keys(steps).map(Number).sort((a, b) => a - b)) if (v > at && v <= version) { try { steps[v](this); } catch (e) {} }
    if (at !== version) this.set('__version', version);
  }
}
