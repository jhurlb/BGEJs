'use strict';
/* ================================================================
   SPRITE CACHE: draw something complex once into an offscreen canvas, then stamp it every frame with drawImage
   (much cheaper than redrawing paths). Entries are kept in least-recently-used order up to `max`.
     const sp = Sprites.get('wedge:red', 24, devicePxPerUnit, c => drawWedge(c));   // draw() gets a context centred on (0, 0)
     Sprites.stamp(ctx, sp, x, y, angle);       // or stamp(ctx, sp) at the current origin
     Sprites.scaleOf(ctx)                       // device pixels per world unit right now, rounded so a few sizes cover every zoom
   R is the drawing's radius in world units; pass the scale you will draw at so it stays sharp: each scale gets its
   own copy, so a sprite is redrawn rather than stretched after a zoom or a resize. Include anything else that
   changes the art in the key, and draw moving parts live on top.

   SPRITE SHEETS: frames cut from one image in a grid, and animations over them.
     const sheet = Sprites.sheet(Assets.get('hero'), 32, 32, { margin: 0, spacing: 0 });   // frame size in image pixels
     sheet.draw(ctx, frame, x, y, { w: 48, angle: 0, flipX: true, alpha: 1, ox: 0.5, oy: 0.5 });   // w / h in world units (default: the frame size)
     const run = sheet.anim([0, 1, 2, 3], 12);          // frames and frames per second; { loop: false, onEnd } to play once
     run.update(dt);  run.draw(ctx, x, y, opts);  run.frame;  run.done;  run.reset();
   Frames are numbered left to right, top to bottom, from 0. ox / oy set the point of the frame placed on (x, y),
   as a share of its size (0.5, 1 = bottom centre, for something standing on the ground).
   ================================================================ */
const Sprites = {
  map: new Map(), max: 800, made: 0,
  get(key, R, ds, draw){
    let sp = this.map.get(key);
    if (sp && sp.ds !== ds) {
      // Drawn for another scale. The plain key always holds the scale asked for last, so the usual case (one scale at a
      // time) builds no string; the other copies wait under key@scale.
      this.map.delete(key); this.map.set(key + '@' + sp.ds, sp);
      const k2 = key + '@' + ds; sp = this.map.get(k2);
      if (sp) { this.map.delete(k2); this.map.set(key, sp); return sp; }
    } else if (sp) { this.map.delete(key); this.map.set(key, sp); return sp; }   // mark as recently used
    const px = Math.ceil(2 * R * ds) + 2, cnv = document.createElement('canvas'); cnv.width = cnv.height = px;
    const c = cnv.getContext('2d'); c.setTransform(ds, 0, 0, ds, px / 2, px / 2); c.lineCap = 'round';
    draw(c);
    sp = { cv: cnv, h: px / 2 / ds, w: px / ds, ds }; this.map.set(key, sp); this.made++;
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
  sheet(img, fw, fh, o = {}){
    const m = o.margin || 0, sp = o.spacing || 0, iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const cols = Math.max(1, Math.floor((iw - 2 * m + sp) / (fw + sp))), rows = Math.max(1, Math.floor((ih - 2 * m + sp) / (fh + sp)));
    const sheet = { img, fw, fh, cols, rows, count: cols * rows,
      draw(c, f, x, y, d){
        const sx = m + (f % cols) * (fw + sp), sy = m + Math.floor(f / cols) * (fh + sp);
        if (!d) { c.drawImage(img, sx, sy, fw, fh, x - fw / 2, y - fh / 2, fw, fh); return; }
        const w = d.w ?? (d.h !== undefined ? d.h * fw / fh : fw), h = d.h ?? w * fh / fw, ox = d.ox ?? 0.5, oy = d.oy ?? 0.5;
        const a = d.alpha, pa = c.globalAlpha; if (a !== undefined) c.globalAlpha = pa * a;
        if (d.angle || d.flipX || d.flipY) {
          c.save(); c.translate(x, y); if (d.angle) c.rotate(d.angle); c.scale(d.flipX ? -1 : 1, d.flipY ? -1 : 1);
          c.drawImage(img, sx, sy, fw, fh, -w * ox, -h * oy, w, h); c.restore();
        } else c.drawImage(img, sx, sy, fw, fh, x - w * ox, y - h * oy, w, h);
        if (a !== undefined) c.globalAlpha = pa;
      },
      anim(frames, fps = 10, ao = {}){
        const an = { frames, fps, loop: ao.loop ?? true, onEnd: ao.onEnd || null, t: 0, i: 0, done: false,
          get frame(){ return an.frames[an.i]; },
          reset(){ an.t = 0; an.i = 0; an.done = false; return an; },
          update(dt){
            if (an.done || !(an.fps > 0)) return an;
            an.t += dt; const n = an.frames.length; let i = Math.floor(an.t * an.fps);
            if (i >= n) { if (an.loop) { an.t -= Math.floor(i / n) * n / an.fps; i %= n; } else { i = n - 1; an.done = true; an.i = i; an.onEnd && an.onEnd(an); return an; } }
            an.i = i; return an;
          },
          draw(c, x, y, d){ sheet.draw(c, an.frames[an.i], x, y, d); } };
        return an;
      } };
    return sheet;
  },
};
