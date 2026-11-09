'use strict';
/* ================================================================
   SPATIAL HASH: find things near a point fast. Rebuild it once per frame from whatever moves:
     const hash = new SpatialHash(64);                  // cell size in world units (about the size of a typical body)
     hash.clear(); for (const e of enemies) hash.insert(e);   // anything with x and y (and r, if it has a size)
     for (const e of hash.within(x, y, r)) ...          // exactly the things whose circle (their own r, or a point) touches this circle
     for (const e of hash.query(x, y, r)) ...           // rough and faster: everything in the cells that touch the circle (check the distance yourself)
     hash.nearest(x, y, maxR, e => !e.dead);            // the closest match within maxR (default: any distance), or null
   query() and within() fill and return one shared array unless you pass your own `out`, so copy it if you keep it
   across another call. Objects with dead === true are skipped. The world has no bounds.
   Things are filed by their centre. within() allows for their size by itself; with query() widen the radius by the
   biggest r you inserted (hash.maxR) or big things near the edge are missed.
   ================================================================ */
class SpatialHash {
  constructor(cell = 64){ this.cell = cell; this.inv = 1 / cell; this.cells = new Map(); this.buf = []; this.used = []; this._reset(); }
  _reset(){ this.maxR = 0; this.x0 = this.y0 = Infinity; this.x1 = this.y1 = -Infinity; }   // biggest r and the range of cells in use
  _key(cx, cy){ return (cx + 32768) * 65536 + (cy + 32768); }
  clear(){ for (const a of this.used) a.length = 0; this.used.length = 0; if (this.cells.size > 8192) this.cells.clear(); this._reset(); }
  insert(o){
    const cx = Math.floor(o.x * this.inv), cy = Math.floor(o.y * this.inv), k = this._key(cx, cy);
    let a = this.cells.get(k); if (!a) this.cells.set(k, a = []);
    if (!a.length) {
      this.used.push(a);
      if (cx < this.x0) this.x0 = cx; if (cx > this.x1) this.x1 = cx; if (cy < this.y0) this.y0 = cy; if (cy > this.y1) this.y1 = cy;
    }
    if (o.r > this.maxR) this.maxR = o.r;
    a.push(o);
  }
  query(x, y, r, out = this.buf){
    out.length = 0;
    const i = this.inv;   // only the cells in use are walked, so a huge radius costs no more than the whole hash
    const x0 = Math.max(this.x0, Math.floor((x - r) * i)), x1 = Math.min(this.x1, Math.floor((x + r) * i)), y0 = Math.max(this.y0, Math.floor((y - r) * i)), y1 = Math.min(this.y1, Math.floor((y + r) * i));
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const a = this.cells.get(this._key(cx, cy)); if (a) for (let j = 0; j < a.length; j++) if (!a[j].dead) out.push(a[j]);
    }
    return out;
  }
  within(x, y, r, out = this.buf){
    this.query(x, y, r + this.maxR, out);
    let w = 0;
    for (let j = 0; j < out.length; j++) { const o = out[j], rr = r + (o.r || 0); if (dist2(x, y, o.x, o.y) < rr * rr) out[w++] = o; }
    out.length = w;
    return out;
  }
  // Searches outwards ring by ring and stops as soon as no farther cell can beat the best so far, so it costs the same
  // however large maxR is. Allocates nothing.
  nearest(x, y, maxR = Infinity, filter = null){
    if (!this.used.length) return null;
    const cell = this.cell, cx = Math.floor(x * this.inv), cy = Math.floor(y * this.inv);
    const kmax = Math.max(cx - this.x0, this.x1 - cx, cy - this.y0, this.y1 - cy);
    this._best = null; this._bd = maxR * maxR;
    for (let k = 0; k <= kmax; k++) {
      if (k > 1) { const reach = (k - 1) * cell; if (reach * reach >= this._bd) break; }
      const ax = Math.max(cx - k, this.x0), bx = Math.min(cx + k, this.x1);
      for (let i = ax; i <= bx; i++) { this._scan(i, cy - k, x, y, filter); if (k) this._scan(i, cy + k, x, y, filter); }
      const ay = Math.max(cy - k + 1, this.y0), by = Math.min(cy + k - 1, this.y1);
      for (let j = ay; j <= by; j++) { this._scan(cx - k, j, x, y, filter); this._scan(cx + k, j, x, y, filter); }
    }
    const best = this._best; this._best = null;
    return best;
  }
  _scan(cx, cy, x, y, filter){
    const a = this.cells.get(this._key(cx, cy)); if (!a) return;
    for (let j = 0; j < a.length; j++) { const o = a[j]; if (o.dead) continue; const d = dist2(x, y, o.x, o.y); if (d < this._bd && (!filter || filter(o))) { this._bd = d; this._best = o; } }
  }
}
