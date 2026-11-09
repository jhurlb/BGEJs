'use strict';
/* ================================================================
   SPATIAL HASH: find things near a point fast. Rebuild it once per frame from whatever moves:
     const hash = new SpatialHash(64);                  // cell size in world units (about the size of a typical body)
     hash.clear(); for (const e of enemies) hash.insert(e);   // anything with x and y
     for (const e of hash.query(x, y, r)) ...           // everything in the cells that touch the circle (check the distance yourself)
     hash.nearest(x, y, maxR, e => !e.dead);            // the closest match within maxR, or null
   query() fills and returns one shared array unless you pass your own `out`, so copy it if you keep it
   across another query. Objects with dead === true are skipped. The world has no bounds.
   ================================================================ */
class SpatialHash {
  constructor(cell = 64){ this.cell = cell; this.inv = 1 / cell; this.cells = new Map(); this.buf = []; this.used = []; }
  _key(cx, cy){ return (cx + 32768) * 65536 + (cy + 32768); }
  clear(){ for (const a of this.used) a.length = 0; this.used.length = 0; if (this.cells.size > 8192) this.cells.clear(); }
  insert(o){
    const k = this._key(Math.floor(o.x * this.inv), Math.floor(o.y * this.inv));
    let a = this.cells.get(k); if (!a) this.cells.set(k, a = []);
    if (!a.length) this.used.push(a);
    a.push(o);
  }
  query(x, y, r, out = this.buf){
    out.length = 0;
    const i = this.inv, x0 = Math.floor((x - r) * i), x1 = Math.floor((x + r) * i), y0 = Math.floor((y - r) * i), y1 = Math.floor((y + r) * i);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const a = this.cells.get(this._key(cx, cy)); if (a) for (const o of a) if (!o.dead) out.push(o);
    }
    return out;
  }
  nearest(x, y, maxR, filter = null){
    let best = null, bd = maxR * maxR;
    for (const o of this.query(x, y, maxR, [])) { const d = dist2(x, y, o.x, o.y); if (d < bd && (!filter || filter(o))) { bd = d; best = o; } }
    return best;
  }
}
