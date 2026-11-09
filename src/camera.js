'use strict';
/* ================================================================
   CAMERA: a 2D view onto the world: follow, framing a group, zoom, rotation, pans and screen shake.
     const cam = new Camera();             // uses the core globals vw, vh, dpr, scale
     cam.update(dt);  cam.apply(ctx);      // once per update; apply sets the canvas transform, draw the world after it
     cam.applyScreen(ctx);                 // back to CSS-pixel space for the HUD
     cam.view                              // { x0, y0, x1, y1 } visible world rect (for culling and Particles.draw), widened while shaking
     cam.inView(x, y, margin);  cam.toWorld(sx, sy);  cam.toScreen(wx, wy);   // screen = CSS pixels; both take an optional object to fill
   x, y is the world point at the centre of the screen. zoom multiplies the core `scale`. rot turns the camera (radians).
   bounds = { x0, y0, x1, y1 } keeps the view inside the world; a world smaller than the view is centred.

   FOLLOW ONE THING
     cam.follow(player, 0.001);            // the number is the share of the gap left after 1 s (0 = locked on)
     cam.follow(player, 0.001, {
       deadzone: { w: 120, h: 80 },        // the target moves freely in a box this big (world units; a number = square) before the camera does
       lookAhead: 0.35, lookMax: 160,      // lead the target by 0.35 s of its velocity, at most 160 world units
       lookLag: 0.02,                      // how fast the lead swings round (share left after 1 s; 0 = at once)
       vel: velComponent,                  // where to read the velocity: { x, y }. Without it: target.vx / vy, else measured from its movement
       offset: { x: 0, y: -60 },           // aim at a point beside the target (above a platformer's hero)
       blend: 0.6, ease: 'inOutCubic',     // glide over from the current view in 0.6 s instead of cutting
     });
     cam.snap();                           // jump to where the follow rests (after a respawn or a teleport)
     cam.follow(null);                     // stop following
   The options are also plain fields (cam.deadzone, cam.lookAhead, cam.lookMax, cam.lookLag, cam.lookVel, cam.offset.x / y):
   an option you leave out keeps its value, except `vel`, which belongs to the target and is forgotten on every follow().

   FRAME A GROUP
     cam.frame(players, 0.01, { margin: 80, minZoom: 0.4, maxZoom: 1 });
   Centres on a list of { x, y, r? } and zooms so that all of them fit with `margin` world units to spare. The list is read
   on every update, so add to it and remove from it freely; an empty list holds the view. zoomLag (default: the lag) smooths
   the zoom. With bounds set it never zooms out past the world. Fields: cam.targets, cam.frameMargin, cam.frameMin, cam.frameMax, cam.zoomLag.

   PANS AND ZOOMS (for cutscenes, rooms and strategy maps)
     cam.moveTo(x, y, 0.8, 'outCubic');    // stop following and glide to a point
     cam.zoomTo(2, 0.5);                   // zoom over 0.5 s
     cam.zoomAt(cam.zoom * 1.1, mx, my);   // zoom keeping the world point under a screen point still (mouse wheel)
     cam.fit({ x0, y0, x1, y1 }, 1, 'inOutCubic', 40);   // move and zoom to show a rect, with a margin
     cam.setBounds(room, 0.5);             // new bounds, sliding into them instead of jumping (room to room)
   Seconds default to 0 (at once). An ease is a function or a name from Ease (default: smoothstep). Each returns a handle with
   cancel() and then(fn) that can be awaited: `await cam.moveTo(boss.x, boss.y, 1); cam.follow(player, 0.001, { blend: 0.5 });`
   A cancelled or replaced move never resolves. zoomTo, zoomAt and fit keep zoom within cam.zoomMin .. cam.zoomMax.

   SHAKE
     cam.addTrauma(0.5);                   // shake: trauma squared x shakeMax pixels, trauma falls by shakeDecay per second
     cam.kick(6);                          // a jolt in pixels that dies away (kickDecay per second); the bigger of two jolts wins
     cam.kick(6, angle);                   // a shove toward `angle` that settles back (recoil, a hit from one side); shoves add up to kickMax
     cam.shakeFreq = 30;                   // wobbles per second: a smooth shake that looks the same at any frame rate (0 = a new random offset each update)
     cam.shakeRot = 0.04;                  // also roll by up to this many radians at full trauma

   LAYERS AND PIXELS
     cam.apply(ctx, 0.5);                  // parallax: a layer that moves at half the camera's speed (0 = fixed, 1 = the world)
     cam.layerView(0.5, rect);             // the visible rect in that layer's coordinates
     cam.pixelSnap = true;                 // round the view to whole device pixels (crisp pixel art; ignored while rotated)
   ================================================================ */
class Camera {
  constructor(){
    this.x = 0; this.y = 0; this.zoom = 1; this.rot = 0; this.target = null; this.lag = 0; this.bounds = null;
    this.deadzone = null; this.offset = { x: 0, y: 0 }; this.lookAhead = 0; this.lookMax = 160; this.lookLag = 0.02; this.lookVel = null; this.lx = 0; this.ly = 0;
    this.targets = null; this.frameMargin = 80; this.frameMin = 0.25; this.frameMax = 1; this.zoomLag = 0;
    this.zoomMin = 0.05; this.zoomMax = 20; this.pixelSnap = false;
    this.trauma = 0; this.shakeMax = 16; this.shakeDecay = 1.6; this.shakeFreq = 0; this.shakeRot = 0;
    this.amp = 0; this.kickDecay = 8; this.kickMax = 16; this.jx = 0; this.jy = 0; this.ox = 0; this.oy = 0; this.orot = 0;
    this.view = { x0: 0, y0: 0, x1: 0, y1: 0 };
    this._pan = null; this._zt = null; this._pt = null; this._px = 0; this._py = 0; this._st = 0;
  }
  get k(){ return scale * this.zoom; }   // CSS pixels per world unit

  // ---- what to look at
  follow(t, lag = 0, o){
    if (t !== this.target) { this._pt = null; this.lx = this.ly = 0; }
    this.target = t; this.targets = null; this.lag = lag; this.lookVel = (o && o.vel) || null;
    if (o) {
      if (o.deadzone !== undefined) this.deadzone = typeof o.deadzone === 'number' ? { w: o.deadzone, h: o.deadzone } : o.deadzone;
      if (o.offset) { this.offset.x = o.offset.x || 0; this.offset.y = o.offset.y || 0; }
      if (o.lookAhead !== undefined) this.lookAhead = o.lookAhead;
      if (o.lookMax !== undefined) this.lookMax = o.lookMax;
      if (o.lookLag !== undefined) this.lookLag = o.lookLag;
    }
    if (t && o && o.blend > 0) this._startPan(t.x + this.offset.x, t.y + this.offset.y, o.blend, o.ease);
    else { this._stopPan(); if (t && !lag) { this.x = t.x + this.offset.x; this.y = t.y + this.offset.y; } }
    return this;
  }
  frame(list, lag = 0, o){
    this.targets = list || null; this.target = null; this.lag = lag; this.zoomLag = lag; this._stopPan();
    if (o) {
      if (o.margin !== undefined) this.frameMargin = o.margin;
      if (o.minZoom !== undefined) this.frameMin = o.minZoom;
      if (o.maxZoom !== undefined) this.frameMax = o.maxZoom;
      if (o.zoomLag !== undefined) this.zoomLag = o.zoomLag;
    }
    return this;
  }
  snap(){   // one update with no lag, no dead zone and no time passing
    const lag = this.lag, zl = this.zoomLag, dz = this.deadzone;
    this._stopPan(); this.lag = this.zoomLag = 0; this.deadzone = null;
    this.update(0);
    this.lag = lag; this.zoomLag = zl; this.deadzone = dz;
    return this;
  }

  // ---- pans and zooms
  moveTo(x, y, sec = 0, ease){ this.target = this.targets = null; return this._startPan(x, y, sec, ease); }
  setBounds(b, sec = 0, ease){ this.bounds = b; return sec > 0 ? this._startPan(this.x, this.y, sec, ease) : Camera._handle(true); }
  zoomTo(z, sec = 0, ease){ return this._zoom(z, sec, ease, false, 0, 0); }
  zoomAt(z, sx, sy, sec = 0, ease){ return this._zoom(z, sec, ease, true, sx, sy); }
  fit(r, sec = 0, ease, margin = 0){
    this._zoom(Math.min(vw / (r.x1 - r.x0 + margin * 2), vh / (r.y1 - r.y0 + margin * 2)) / scale, sec, ease, false, 0, 0);
    return this.moveTo((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, sec, ease);
  }
  // While a pan runs, the follow carries on unseen in gx, gy and x, y glides from where it was to there.
  _startPan(gx, gy, sec, ease){
    this._stopPan();
    if (!(sec > 0)) { this.x = gx; this.y = gy; return Camera._handle(true); }
    return (this._pan = { fx: this.x, fy: this.y, gx, gy, t: 0, dur: sec, ease: Camera._ease(ease), h: Camera._handle(false) }).h;
  }
  _stopPan(){ if (this._pan) { this._pan.h.dead = true; this._pan = null; } }
  _zoom(to, sec, ease, at, sx, sy){
    if (this._zt) { this._zt.h.dead = true; this._zt = null; }
    to = clamp(to, this.zoomMin, this.zoomMax);
    const z = { from: this.zoom, to, t: 0, dur: sec, ease: Camera._ease(ease), at, sx, sy, wx: 0, wy: 0, h: Camera._handle(!(sec > 0)) };
    if (at) { const w = this.toWorld(sx, sy); z.wx = w.x; z.wy = w.y; }
    if (sec > 0) this._zt = z; else this._setZoom(to, z);
    return z.h;
  }
  _setZoom(v, z){
    this.zoom = v;
    if (z.at) {   // put the world point back under the screen point
      const k = this.k, ux = (z.sx - vw / 2) / k, uy = (z.sy - vh / 2) / k, c = Math.cos(this.rot), s = Math.sin(this.rot);
      this.x = z.wx - (ux * c - uy * s); this.y = z.wy - (ux * s + uy * c);
    }
  }
  static _handle(ended){
    const h = { dead: ended, ended, done: null,
      cancel(){ h.dead = true; },
      then(fn){ if (h.ended) fn(); else { const prev = h.done; h.done = prev ? () => { prev(); fn(); } : fn; } return h; } };
    return h;
  }
  static _end(h){ h.dead = h.ended = true; h.done && h.done(); }
  static _ease(e){ return typeof e === 'function' ? e : (e && typeof Ease !== 'undefined' && Ease[e]) || Camera._smooth; }
  static _smooth(t){ return t * t * (3 - 2 * t); }
  // Smooth noise in -1 .. 1: random values at whole numbers of t, eased between.
  static _hash(n){ n = (n + 0x9e3779b9) | 0; n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); return ((n ^ (n >>> 15)) >>> 0) / 2147483648 - 1; }
  static _noise(t, seed){ const i = Math.floor(t), f = t - i, a = Camera._hash(i + seed); return a + (Camera._hash(i + seed + 1) - a) * f * f * (3 - 2 * f); }

  // ---- shake
  addTrauma(a){ this.trauma = Math.min(1, this.trauma + a); }
  kick(a, ang){
    if (ang === undefined) { this.amp = Math.min(this.kickMax, Math.max(this.amp, a)); return; }
    this.jx += Math.cos(ang) * a; this.jy += Math.sin(ang) * a;
    const m = Math.hypot(this.jx, this.jy); if (m > this.kickMax) { this.jx *= this.kickMax / m; this.jy *= this.kickMax / m; }
  }

  update(dt){
    let endZ = null, endP = null;   // handles that finish in this update resolve at its end, when the camera is consistent
    const z = this._zt;
    if (z) {
      if (z.h.dead) this._zt = null;
      else {
        z.t += dt; const done = z.t >= z.dur;
        this._setZoom(done ? z.to : z.from * Math.pow(z.to / z.from, z.ease(z.t / z.dur)), z);   // by ratio, so a zoom looks even all the way
        if (done) { this._zt = null; endZ = z.h; }
      }
    }
    let pan = this._pan; if (pan && pan.h.dead) pan = this._pan = null;
    const cr = Math.cos(this.rot), sr = Math.sin(this.rot), b = this.bounds, t = this.target, g = this.targets;
    let x = pan ? pan.gx : this.x, y = pan ? pan.gy : this.y, fx = 0, fy = 0, has = false;
    if (g) {
      // the group's box along the camera's own axes, so it also fits when the camera is turned
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (let i = 0; i < g.length; i++) {
        const o = g[i], r = o.r || 0, u = o.x * cr + o.y * sr, v = o.y * cr - o.x * sr;
        if (u - r < u0) u0 = u - r; if (u + r > u1) u1 = u + r; if (v - r < v0) v0 = v - r; if (v + r > v1) v1 = v + r;
      }
      if (g.length) {
        const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, m = this.frameMargin * 2;
        fx = cu * cr - cv * sr; fy = cu * sr + cv * cr; has = true;
        let zf = clamp(Math.min(vw / (u1 - u0 + m), vh / (v1 - v0 + m)) / scale, this.frameMin, this.frameMax);
        if (b) zf = Math.max(zf, Math.min(this.frameMax, Math.max(vw / (b.x1 - b.x0), vh / (b.y1 - b.y0)) / scale));
        this.zoom = this.zoomLag ? damp(this.zoom, zf, this.zoomLag, dt) : zf;
      }
    } else if (t) {
      if (this.lookAhead) {
        const lv = this.lookVel; let vx = 0, vy = 0, known = true;
        if (lv) { vx = lv.x; vy = lv.y; }
        else if (typeof t.vx === 'number') { vx = t.vx; vy = t.vy || 0; }
        else if (dt > 0 && this._pt === t) { vx = (t.x - this._px) / dt; vy = (t.y - this._py) / dt; }
        else known = false;   // nothing to measure yet: keep the lead as it is
        if (known) {
          let ax = vx * this.lookAhead, ay = vy * this.lookAhead; const m = Math.hypot(ax, ay);
          if (m > this.lookMax) { ax *= this.lookMax / m; ay *= this.lookMax / m; }
          if (this.lookLag) { this.lx = damp(this.lx, ax, this.lookLag, dt); this.ly = damp(this.ly, ay, this.lookLag, dt); } else { this.lx = ax; this.ly = ay; }
        }
        if (dt > 0 || this._pt !== t) { this._pt = t; this._px = t.x; this._py = t.y; }
      } else this.lx = this.ly = 0;
      fx = t.x + this.offset.x + this.lx; fy = t.y + this.offset.y + this.ly; has = true;
    }
    if (has) {
      const dz = this.deadzone;
      if (dz) { fx = clamp(x, fx - dz.w / 2, fx + dz.w / 2); fy = clamp(y, fy - dz.h / 2, fy + dz.h / 2); }   // the nearest place that has the target in the box
      if (this.lag) { x = damp(x, fx, this.lag, dt); y = damp(y, fy, this.lag, dt); } else { x = fx; y = fy; }
    }
    // half the view in world units; a turned camera sees a wider box
    const k = this.k, hw0 = vw / 2 / k, hh0 = vh / 2 / k, ac = Math.abs(cr), as = Math.abs(sr), hw = hw0 * ac + hh0 * as, hh = hw0 * as + hh0 * ac;
    if (b) {
      x = b.x1 - b.x0 < hw * 2 ? (b.x0 + b.x1) / 2 : clamp(x, b.x0 + hw, b.x1 - hw);
      y = b.y1 - b.y0 < hh * 2 ? (b.y0 + b.y1) / 2 : clamp(y, b.y0 + hh, b.y1 - hh);
    }
    if (pan) {
      pan.gx = x; pan.gy = y; pan.t += dt;
      if (pan.t >= pan.dur) { this.x = x; this.y = y; this._pan = null; endP = pan.h; }
      else { const e = pan.ease(pan.t / pan.dur); this.x = lerp(pan.fx, x, e); this.y = lerp(pan.fy, y, e); }
    } else { this.x = x; this.y = y; }

    this.trauma = Math.max(0, this.trauma - this.shakeDecay * dt);
    const kd = Math.exp(-this.kickDecay * dt);
    this.amp *= kd; if (this.amp < 0.01) this.amp = 0;
    this.jx *= kd; this.jy *= kd; if (this.jx * this.jx + this.jy * this.jy < 1e-4) this.jx = this.jy = 0;
    const tr = this.trauma * this.trauma, s = tr * this.shakeMax + this.amp, sRot = tr * this.shakeRot;
    let nx = 0, ny = 0, nr = 0;
    if (this.shakeFreq) {
      if (s || sRot) { this._st += dt * this.shakeFreq; nx = Camera._noise(this._st, 0); ny = Camera._noise(this._st, 71); nr = Camera._noise(this._st, 173); }
    } else {
      if (s) { nx = Math.random() * 2 - 1; ny = Math.random() * 2 - 1; }
      if (sRot) nr = Math.random() * 2 - 1;
    }
    this.ox = nx * s - this.jx; this.oy = ny * s - this.jy; this.orot = nr * sRot;
    let vhw = hw, vhh = hh;
    if (this.orot) { const a = this.rot + this.orot, c = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a)); vhw = hw0 * c + hh0 * sn; vhh = hw0 * sn + hh0 * c; }
    const v = this.view, pad = (s + Math.hypot(this.jx, this.jy)) / k;   // the shake can show this much more world on any side
    v.x0 = this.x - vhw - pad; v.x1 = this.x + vhw + pad; v.y0 = this.y - vhh - pad; v.y1 = this.y + vhh + pad;
    if (endZ) Camera._end(endZ);
    if (endP) Camera._end(endP);
  }

  // ---- drawing and coordinates
  apply(c, p = 1){
    const k = this.k * dpr, r = this.rot + this.orot, x = this.x * p, y = this.y * p;
    let e = dpr * (vw / 2 + this.ox), f = dpr * (vh / 2 + this.oy);
    if (!r) {
      e -= x * k; f -= y * k; if (this.pixelSnap) { e = Math.round(e); f = Math.round(f); }
      c.setTransform(k, 0, 0, k, e, f); return;
    }
    const cs = Math.cos(r) * k, sn = Math.sin(r) * k;
    c.setTransform(cs, -sn, sn, cs, e - (x * cs + y * sn), f - (y * cs - x * sn));
  }
  applyScreen(c){ c.setTransform(dpr, 0, 0, dpr, 0, 0); }
  layerView(p, out = {}){
    const v = this.view, hw = (v.x1 - v.x0) / 2, hh = (v.y1 - v.y0) / 2, x = this.x * p, y = this.y * p;
    out.x0 = x - hw; out.y0 = y - hh; out.x1 = x + hw; out.y1 = y + hh; return out;
  }
  inView(x, y, m = 0){ const v = this.view; return x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m; }
  toWorld(sx, sy, out = {}){
    const k = this.k, ux = (sx - vw / 2) / k, uy = (sy - vh / 2) / k, r = this.rot;
    if (!r) { out.x = this.x + ux; out.y = this.y + uy; return out; }
    const c = Math.cos(r), s = Math.sin(r);
    out.x = this.x + ux * c - uy * s; out.y = this.y + ux * s + uy * c; return out;
  }
  toScreen(wx, wy, out = {}){
    const k = this.k, dx = wx - this.x, dy = wy - this.y, r = this.rot;
    if (!r) { out.x = vw / 2 + dx * k; out.y = vh / 2 + dy * k; return out; }
    const c = Math.cos(r), s = Math.sin(r);
    out.x = vw / 2 + (dx * c + dy * s) * k; out.y = vh / 2 + (dy * c - dx * s) * k; return out;
  }
}
