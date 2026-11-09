'use strict';
/* ================================================================
   SPRITE CACHE: draw something complex once into an offscreen canvas, then stamp it every frame with drawImage
   (much cheaper than redrawing paths). Entries are kept in least-recently-used order up to `max`.
     const sp = Sprites.get('wedge:red', 24, devicePxPerUnit, c => drawWedge(c));   // draw() gets a context centred on (0, 0)
     Sprites.stamp(ctx, sp, x, y, angle);       // or stamp(ctx, sp) at the current origin
     Sprites.scaleOf(ctx)                       // device pixels per world unit right now, rounded so a few sizes cover every zoom
   R is the drawing's radius in world units; pass the scale you will draw at so it stays sharp. Include anything
   that changes the art in the key, and draw moving parts live on top.
   ================================================================ */
const Sprites = {
  map: new Map(), max: 800, made: 0,
  get(key, R, ds, draw){
    let sp = this.map.get(key);
    if (sp) { this.map.delete(key); this.map.set(key, sp); return sp; }   // mark as recently used
    const px = Math.ceil(2 * R * ds) + 2, cnv = document.createElement('canvas'); cnv.width = cnv.height = px;
    const c = cnv.getContext('2d'); c.setTransform(ds, 0, 0, ds, px / 2, px / 2); c.lineCap = 'round';
    draw(c);
    sp = { cv: cnv, h: px / 2 / ds, w: px / ds }; this.map.set(key, sp); this.made++;
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);   // drop the least recently used
    return sp;
  },
  stamp(c, sp, x, y, ang){
    if (x === undefined) { c.drawImage(sp.cv, -sp.h, -sp.h, sp.w, sp.w); return; }
    if (!ang) { c.drawImage(sp.cv, x - sp.h, y - sp.h, sp.w, sp.w); return; }
    c.save(); c.translate(x, y); c.rotate(ang); c.drawImage(sp.cv, -sp.h, -sp.h, sp.w, sp.w); c.restore();
  },
  scaleOf(c){ const m = c.getTransform(), d = Math.hypot(m.a, m.b) * 1.04; return 2 ** (Math.round(Math.log2(d) * 16) / 16); },
  clear(){ this.map.clear(); },
};
