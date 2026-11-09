'use strict';
/* ================================================================
   ASSETS: load images, sounds, JSON and text up front, with progress, then fetch them by name.
     await Assets.load({ hero: 'img/hero.png', hit: 'sfx/hit.ogg', level1: 'data/level1.json' }, (done, total) => bar(done / total));
     Assets.get('hero')          // HTMLImageElement, AudioBuffer (decoded with engine/audio.js), object or string
   Types come from the extension: png jpg jpeg gif webp svg -> image; mp3 ogg wav m4a -> sound; json; anything else -> text.
   A failed file rejects load() with its name; the others still finish.
   ================================================================ */
const Assets = {
  cache: new Map(),
  get(name){ return this.cache.get(name); },
  has(name){ return this.cache.has(name); },
  _one(url){
    const ext = url.split('?')[0].split('.').pop().toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error(url)); im.src = url; });
    if (['mp3', 'ogg', 'wav', 'm4a'].includes(ext)) return Sound.load(url);
    return fetch(url).then(r => { if (!r.ok) throw new Error(url); return ext === 'json' ? r.json() : r.text(); });
  },
  async load(map, onProgress){
    const names = Object.keys(map); let done = 0; const errors = [];
    await Promise.all(names.map(n => this._one(map[n]).then(v => { this.cache.set(n, v); }, () => errors.push(n)).finally(() => onProgress && onProgress(++done, names.length))));
    if (errors.length) throw new Error(`Assets failed: ${errors.join(', ')}`);
    return this;
  },
};
