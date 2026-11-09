'use strict';
/* ================================================================
   CAMERA: a 2D view onto the world with follow, zoom and trauma-based screen shake.
     const cam = new Camera();             // uses the core globals vw, vh, dpr, scale
     cam.follow(player, 0.001);            // track a target; the number is the share of the gap left after 1 s (0 = snap)
     cam.addTrauma(0.5);                   // smooth shake: trauma squared x shakeMax, trauma falls by shakeDecay per second
     cam.kick(6);                          // or a direct jolt in pixels that dies away exponentially (kickDecay per second)
     cam.update(dt);  cam.apply(ctx);      // sets the canvas transform; draw the world after this
     cam.view                              // { x0, y0, x1, y1 } visible world rect (for culling and Particles.draw)
     cam.inView(x, y, margin);  cam.toWorld(sx, sy);  cam.toScreen(wx, wy);   // screen = CSS pixels
     cam.applyScreen(ctx);                 // back to CSS-pixel space for the HUD
   zoom multiplies the core `scale`. bounds = { x0, y0, x1, y1 } keeps the view inside the world.
   ================================================================ */
class Camera {
  constructor(){
    this.x = 0; this.y = 0; this.zoom = 1; this.target = null; this.lag = 0; this.bounds = null;
    this.trauma = 0; this.shakeMax = 16; this.shakeDecay = 1.6; this.amp = 0; this.kickDecay = 8; this.kickMax = 16; this.ox = 0; this.oy = 0;
    this.view = { x0: 0, y0: 0, x1: 0, y1: 0 };
  }
  follow(t, lag = 0){ this.target = t; this.lag = lag; if (t && !lag) { this.x = t.x; this.y = t.y; } return this; }
  addTrauma(a){ this.trauma = Math.min(1, this.trauma + a); }
  kick(a){ this.amp = Math.min(this.kickMax, Math.max(this.amp, a)); }
  get k(){ return scale * this.zoom; }   // CSS pixels per world unit
  update(dt){
    const t = this.target;
    if (t) { if (this.lag) { this.x = damp(this.x, t.x, this.lag, dt); this.y = damp(this.y, t.y, this.lag, dt); } else { this.x = t.x; this.y = t.y; } }
    const hw = vw / 2 / this.k, hh = vh / 2 / this.k, b = this.bounds;
    if (b) {
      this.x = b.x1 - b.x0 < hw * 2 ? (b.x0 + b.x1) / 2 : clamp(this.x, b.x0 + hw, b.x1 - hw);
      this.y = b.y1 - b.y0 < hh * 2 ? (b.y0 + b.y1) / 2 : clamp(this.y, b.y0 + hh, b.y1 - hh);
    }
    this.trauma = Math.max(0, this.trauma - this.shakeDecay * dt);
    this.amp *= Math.exp(-this.kickDecay * dt); if (this.amp < 0.01) this.amp = 0;
    const s = this.trauma * this.trauma * this.shakeMax + this.amp;
    this.ox = s ? (Math.random() * 2 - 1) * s : 0; this.oy = s ? (Math.random() * 2 - 1) * s : 0;
    const v = this.view; v.x0 = this.x - hw; v.x1 = this.x + hw; v.y0 = this.y - hh; v.y1 = this.y + hh;
  }
  apply(c){
    const k = this.k * dpr;
    c.setTransform(k, 0, 0, k, dpr * (vw / 2 + this.ox) - this.x * k, dpr * (vh / 2 + this.oy) - this.y * k);
  }
  applyScreen(c){ c.setTransform(dpr, 0, 0, dpr, 0, 0); }
  inView(x, y, m = 0){ const v = this.view; return x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m; }
  toWorld(sx, sy){ return { x: this.x + (sx - vw / 2) / this.k, y: this.y + (sy - vh / 2) / this.k }; }
  toScreen(wx, wy){ return { x: vw / 2 + (wx - this.x) * this.k, y: vh / 2 + (wy - this.y) * this.k }; }
}
