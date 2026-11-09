'use strict';
/* ================================================================
   CAMERA: a 2D view onto the world with follow, framing, zoom, rotation, scripted moves and screen shake.
     const cam = new Camera();             // uses the core globals vw, vh, dpr, scale
     cam.update(dt);  cam.apply(ctx);      // sets the canvas transform; draw the world after this
     cam.applyScreen(ctx);                 // back to CSS-pixel space for the HUD
     cam.view                              // { x0, y0, x1, y1 } visible world rect (for culling and Particles.draw), widened while shaking
     cam.inView(x, y, margin);  cam.toWorld(sx, sy);  cam.toScreen(wx, wy);   // screen = CSS pixels; pass an object as a last argument to reuse it
   zoom multiplies the core `scale`; angle (radians) turns the view. bounds = { x0, y0, x1, y1 } keeps the view inside the world.

   Following
     cam.follow(player, 0.001);            // track a target; the number is the share of the gap left after 1 s (0 = snap)
     cam.deadzone = { w: 120, h: 80 };     // world units: the target moves freely inside this box and the camera only moves when it leaves
     cam.lead = 0.35;                      // look ahead: aim this many seconds in front of the target (its vx, vy if it has them, else measured)
     cam.leadMax = 240; cam.leadLag = 0.02;   // the furthest it leads, in world units, and how fast the lead swings round (as lag)
     cam.offset = { x: 0, y: -40 };        // aim this far from the target, in world units
     cam.frame([p1, p2, boss], { padding: 80, minZoom: 0.25, maxZoom: 1, lag: 0.01 });   // keep several things in shot: centres on them and
                                           // zooms to fit (their r counts). The list is read every update, so add and remove freely. zoom: false only centres
     cam.snap();                           // jump straight to where the camera is heading (after a teleport or a respawn)

   Zoom and scripted moves
     cam.zoomTo(2, 0.4, Ease.outCubic);    // zoom over 0.4 s (0 = now); following carries on meanwhile
     cam.zoomAt(cam.zoom * 1.1, mx, my);   // zoom now, keeping the world point under a screen point where it is (mouse wheel, pinch)
     cam.moveTo(x, y, 1.2, { ease, zoom: 1.5, hold: true, onDone });   // glide to a point; following waits until it arrives,
     cam.moving;  cam.held;  cam.release();                            // or with hold: true, until release(). follow() and frame() also cancel a move

   Shake
     cam.addTrauma(0.5);                   // trauma squared x shakeMax pixels, trauma falls by shakeDecay per second
     cam.kick(6);                          // a direct jolt in pixels that dies away exponentially (kickDecay per second)
     cam.kick(10, angle);                  // a push in one direction that settles back: recoil, a landing, a hit from the left
     cam.shakeRoll = 0.05;                 // trauma also rolls the view, up to this many radians
     cam.shakeFreq = 30;                   // smooth shake at about this many wobbles a second, the same at any frame rate (0 = a new offset every update)
     cam.shakeScale = 0.5;                 // scales every shake; set it from a "screen shake" or reduced-motion setting (0 = none)
   Shake takes its random numbers from Rng.fx, so it never shifts gameplay randomness.

   Drawing
     cam.apply(ctx, 0.5);                  // parallax: a layer that scrolls at half speed (cam.view is for the main layer only)
     cam.pixelSnap = true;                 // land the view on whole device pixels, for crisp pixel art
   ================================================================ */
class Camera {
  constructor(){
    this.x = 0; this.y = 0; this.zoom = 1; this.angle = 0; this.target = null; this.lag = 0; this.bounds = null;
    this.group = null; this.deadzone = null; this.offset = null; this.lead = 0; this.leadMax = 240; this.leadLag = 0.02; this.held = false; this.pixelSnap = false;
    this.trauma = 0; this.shakeMax = 16; this.shakeDecay = 1.6; this.shakeRoll = 0; this.shakeFreq = 0; this.shakeScale = 1;
    this.amp = 0; this.kickDecay = 8; this.kickMax = 16; this.ox = 0; this.oy = 0; this.roll = 0;
    this.view = { x0: 0, y0: 0, x1: 0, y1: 0 };
    this._fit = null; this._mv = null; this._zt = null; this._gx = 0; this._gy = 0; this._gz = 1;
    this._lx = 0; this._ly = 0; this._px = 0; this._py = 0; this._seen = false; this._kx = 0; this._ky = 0; this._n = [0, 0, 0, 0, 0, 0]; this._np = 1;
  }
  follow(t, lag = 0){
    this.target = t; this.lag = lag; this.group = this._fit = this._mv = null; this.held = false; this._lead0();
    if (t && !lag) { this.x = t.x; this.y = t.y; }
    return this;
  }
  frame(list, o = {}){
    this.group = list; this.target = this._mv = null; this.held = false; this.lag = o.lag ?? 0.01; this._lead0();
    this._fit = o.zoom === false ? null : { pad: o.padding ?? 80, min: o.minZoom ?? 0.25, max: o.maxZoom ?? 1, lag: o.zoomLag ?? this.lag };
    return this;
  }
  snap(){
    this._mv = null; this._lead0();
    if (this._aim()) { const o = this.offset; this.x = this._gx + (o ? o.x : 0); this.y = this._gy + (o ? o.y : 0); if (this._fit) { this.zoom = this._gz; this._zt = null; } }
    return this;
  }
  zoomTo(z, secs = 0, ease = Camera.smooth, onDone = null){
    if (secs > 0) this._zt = { z0: this.zoom, z1: z, t: 0, d: secs, ease, onDone }; else { this.zoom = z; this._zt = null; if (onDone) onDone(this); }
    return this;
  }
  zoomAt(z, sx, sy){
    const a = this.toWorld(sx, sy, Camera._p); const wx = a.x, wy = a.y; this.zoom = z; this._zt = null;
    const b = this.toWorld(sx, sy, Camera._p); this.x += wx - b.x; this.y += wy - b.y;
    return this;
  }
  moveTo(x, y, secs = 0.5, o = {}){
    this._mv = { x0: this.x, y0: this.y, x1: x, y1: y, t: 0, d: secs, ease: o.ease || Camera.smooth, hold: !!o.hold, onDone: o.onDone || null };
    if (o.zoom != null) this.zoomTo(o.zoom, secs, this._mv.ease);
    return this;
  }
  release(){ this._mv = null; this.held = false; this._lead0(); return this; }
  get moving(){ return !!this._mv; }
  addTrauma(a){ this.trauma = Math.min(1, this.trauma + a); }
  kick(a, angle){
    if (angle == null) { this.amp = Math.min(this.kickMax, Math.max(this.amp, a)); return; }
    let x = this._kx + Math.cos(angle) * a, y = this._ky + Math.sin(angle) * a; const l = Math.hypot(x, y);
    if (l > this.kickMax) { x *= this.kickMax / l; y *= this.kickMax / l; }
    this._kx = x; this._ky = y;
  }
  get k(){ return scale * this.zoom; }   // CSS pixels per world unit
  _lead0(){ this._lx = this._ly = 0; this._seen = false; }
  // Where the camera wants to be: the target, or the middle of the group (and the zoom that fits it). False when there is nothing to follow.
  _aim(){
    const g = this.group, t = this.target;
    if (!g) { if (!t) return false; this._gx = t.x; this._gy = t.y; return true; }
    if (!g.length) return false;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < g.length; i++) { const o = g[i], r = o.r || 0; if (o.x - r < x0) x0 = o.x - r; if (o.x + r > x1) x1 = o.x + r; if (o.y - r < y0) y0 = o.y - r; if (o.y + r > y1) y1 = o.y + r; }
    this._gx = (x0 + x1) / 2; this._gy = (y0 + y1) / 2;
    const f = this._fit; if (f) this._gz = clamp(Math.min(vw / (x1 - x0 + f.pad * 2), vh / (y1 - y0 + f.pad * 2)) / scale, f.min, f.max);
    return true;
  }
  update(dt){
    const m = this._mv, zt = this._zt;
    if (m) {
      m.t = m.d > 0 ? Math.min(1, m.t + dt / m.d) : 1; const e = m.ease(m.t);
      this.x = lerp(m.x0, m.x1, e); this.y = lerp(m.y0, m.y1, e);
      if (m.t >= 1) { this._mv = null; this.held = m.hold; this._lead0(); }
    } else if (!this.held && this._aim()) {
      let gx = this._gx, gy = this._gy;
      if (this.lead) {
        const t = this.target, own = t && typeof t.vx === 'number' && typeof t.vy === 'number';
        if (own || (dt > 0 && this._seen)) {
          let lx = (own ? t.vx : (gx - this._px) / dt) * this.lead, ly = (own ? t.vy : (gy - this._py) / dt) * this.lead; const l = Math.hypot(lx, ly);
          if (l > this.leadMax) { lx *= this.leadMax / l; ly *= this.leadMax / l; }
          this._lx = damp(this._lx, lx, this.leadLag, dt); this._ly = damp(this._ly, ly, this.leadLag, dt);
        }
        if (dt > 0) { this._px = gx; this._py = gy; this._seen = true; }
        gx += this._lx; gy += this._ly;
      } else if (this._lx || this._ly) this._lead0();
      const o = this.offset, z = this.deadzone;
      if (o) { gx += o.x; gy += o.y; }
      if (z) {   // only the part of the gap that sticks out of the box counts
        const dx = gx - this.x, dy = gy - this.y, hx = z.w / 2, hy = z.h / 2;
        gx = this.x + (dx > hx ? dx - hx : dx < -hx ? dx + hx : 0); gy = this.y + (dy > hy ? dy - hy : dy < -hy ? dy + hy : 0);
      }
      if (this.lag) { this.x = damp(this.x, gx, this.lag, dt); this.y = damp(this.y, gy, this.lag, dt); } else { this.x = gx; this.y = gy; }
      const f = this._fit; if (f && !zt) this.zoom = f.lag ? damp(this.zoom, this._gz, f.lag, dt) : this._gz;
    }
    if (zt) {   // zoom moves by ratio, so each moment of the zoom looks as fast as the last
      zt.t = Math.min(1, zt.t + dt / zt.d); this.zoom = zt.z0 * Math.pow(zt.z1 / zt.z0, zt.ease(zt.t));
      if (zt.t >= 1 && this._zt === zt) this._zt = null;
    }
    // Half the view in world units; a turned view covers a wider upright box.
    const k = this.k, co = Math.abs(Math.cos(this.angle)), si = Math.abs(Math.sin(this.angle)), w2 = vw / 2 / k, h2 = vh / 2 / k;
    const hw = w2 * co + h2 * si, hh = w2 * si + h2 * co, b = this.bounds;
    if (b) {
      this.x = b.x1 - b.x0 < hw * 2 ? (b.x0 + b.x1) / 2 : clamp(this.x, b.x0 + hw, b.x1 - hw);
      this.y = b.y1 - b.y0 < hh * 2 ? (b.y0 + b.y1) / 2 : clamp(this.y, b.y0 + hh, b.y1 - hh);
    }
    this.trauma = Math.max(0, this.trauma - this.shakeDecay * dt);
    const kd = Math.exp(-this.kickDecay * dt);
    this.amp *= kd; if (this.amp < 0.01) this.amp = 0;
    this._kx *= kd; this._ky *= kd; if (Math.abs(this._kx) < 0.01 && Math.abs(this._ky) < 0.01) this._kx = this._ky = 0;
    const q = this.shakeScale, tt = this.trauma * this.trauma, s = (tt * this.shakeMax + this.amp) * q, rmax = tt * this.shakeRoll * q;
    let nx = 0, ny = 0, nr = 0;
    if (s || rmax) {
      const R = Rng.fx, n = this._n;
      if (this.shakeFreq > 0) {   // smooth noise: glide between random points, a new one every 1 / shakeFreq seconds
        this._np += dt * this.shakeFreq; if (this._np > 2) this._np = 1 + this._np % 1;
        if (this._np >= 1) { this._np -= 1; for (let i = 0; i < 6; i += 2) { n[i] = n[i + 1]; n[i + 1] = R.range(-1, 1); } }
        const e = Camera.smooth(this._np); nx = lerp(n[0], n[1], e); ny = lerp(n[2], n[3], e); nr = lerp(n[4], n[5], e);
      } else { nx = R.range(-1, 1); ny = R.range(-1, 1); nr = R.range(-1, 1); }
    }
    this.ox = nx * s + this._kx * q; this.oy = ny * s + this._ky * q; this.roll = nr * rmax;
    // The shake can show this much more world on any side: the offset, plus how far a roll swings the corners.
    const v = this.view, pad = (s + Math.hypot(this._kx, this._ky) * q) / k + rmax * Math.hypot(w2, h2);
    v.x0 = this.x - hw - pad; v.x1 = this.x + hw + pad; v.y0 = this.y - hh - pad; v.y1 = this.y + hh + pad;
    if (m && !this._mv && m.onDone) m.onDone(this);
    if (zt && zt.t >= 1 && zt.onDone) zt.onDone(this);
  }
  apply(c, parallax = 1){
    const k = this.k * dpr, a = -(this.angle + this.roll), co = Math.cos(a) * k, si = Math.sin(a) * k, x = this.x * parallax, y = this.y * parallax;
    let e = dpr * (vw / 2 + this.ox) - (co * x - si * y), f = dpr * (vh / 2 + this.oy) - (si * x + co * y);
    if (this.pixelSnap) { e = Math.round(e); f = Math.round(f); }
    c.setTransform(co, si, -si, co, e, f);
  }
  applyScreen(c){ c.setTransform(dpr, 0, 0, dpr, 0, 0); }
  inView(x, y, m = 0){ const v = this.view; return x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m; }
  toWorld(sx, sy, out = {}){
    const u = (sx - vw / 2) / this.k, v = (sy - vh / 2) / this.k, co = Math.cos(this.angle), si = Math.sin(this.angle);
    out.x = this.x + u * co - v * si; out.y = this.y + u * si + v * co; return out;
  }
  toScreen(wx, wy, out = {}){
    const dx = wx - this.x, dy = wy - this.y, co = Math.cos(this.angle), si = Math.sin(this.angle);
    out.x = vw / 2 + (dx * co + dy * si) * this.k; out.y = vh / 2 + (dy * co - dx * si) * this.k; return out;
  }
}
Camera.smooth = t => t * t * (3 - 2 * t);   // the default ease for zoomTo and moveTo
Camera._p = { x: 0, y: 0 };
