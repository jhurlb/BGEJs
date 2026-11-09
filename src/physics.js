'use strict';
/* ================================================================
   PHYSICS: a world of circles, boxes and convex polygons that fall, collide, stack, slide and bounce, and never pass
   through a wall however fast they go. Nothing rotates, which is what most 2D games want.
     const world = new Physics({ gravity: 900 });                // y points down; 0 (the default) for a top-down game
     const ball = world.add({ x: 100, y: 0, r: 12, bounce: 0.6 });
     world.add({ x: 0, y: 400, w: 800, h: 40, fixed: true });    // a floor
     world.step(dt);                                             // once per update; then draw your things where they are

   A body is your own plain object in one of the Collide shapes: { x, y, r }, { x, y, w, h } (x, y the top-left corner)
   or { x, y, pts } (a convex polygon). add() gives it vx, vy and touch if it lacks them and returns it. The world reads
   these from it on every step, so change them whenever you like:
     vx, vy         velocity. Set it to move a thing; the world changes it when things collide
     mass           1 if left out. Heavy things shove light ones. Infinity is the same as fixed
     fixed          true = never pushed and no gravity: walls, floors. Give a fixed body a velocity and it is a moving
                    platform that carries what stands on it
     bounce         0 = lands dead (the default), 1 = loses nothing. The bouncier of the two bodies decides
     friction       grip along a surface, 0 = ice. world.friction (0.3) if left out. Give a player 0 or they cling to walls
     drag           the share of speed lost per second to air, roughly (0 = none)
     gravityScale   1 if left out; 0 floats
     sensor         true = touches are reported but nothing is pushed: pickups, bullets, trigger areas
     layer, mask    bit masks. Two bodies meet only if each one's layer is in the other's mask. layer 1, mask all if left out.
                    layer 0 meets nothing
     oneWay         on a fixed box: things land on its top but pass through from below and from the sides
     dead           true = taken out at the next step (as SpatialHash treats it). To bring one back, clear dead and add() it again
   and after each step it tells you:
     touch          the sides being pressed on, as in Collide.clampToBox: 1 left, 2 right, 4 top, 8 bottom.
                    if (player.touch & 8 && Input.hit('jump')) player.vy = -500;
     onHit(other, nx, ny, speed)   if you give a body this function: called once when it starts touching another.
                    nx, ny points from the other body to this one; speed is how fast they closed
     onLeave(other)                called when they part
   world.onBegin(a, b, nx, ny, speed) and world.onEnd(a, b) hear about every pair. All of these are called at the end
   of step(), so they may add and remove bodies. world.filter(a, b) returning false stops a pair meeting at all.

     world.raycast(ox, oy, dx, dy, max, filter)   the first body along a unit direction, or null. world.dist is how far,
                                                  Collide.nx / ny the surface normal
     world.query(shape, out)       every body that overlaps a shape, e.g. { x, y, r } for a blast
     world.walls(box)              four fixed boxes around the outside of an area
     world.remove(body), world.clear(), world.bodies, world.draw(ctx) to see the shapes while you build

   HOW IT WORKS, as far as it matters to a game. Each step finds the pairs that could meet (a grid, so thousands of
   bodies are fine), then for each pair asks Collide whether they overlap or will touch during the step (a swept test,
   so a bullet can't skip over a thin wall or a small enemy). Contacts are solved together several times
   (world.iterations), which is what lets stacks rest. A body knocked onto a new course in the middle of a step is
   checked again against fixed bodies, so nothing leaves a level; against other moving bodies it is checked at the
   next step, and pushed back out if it has ended up inside one. Two fixed bodies never collide. A floor built from
   tiles is smooth: seams between boxes don't catch. For a simulation that plays back the same every time, call step()
   with a fixed dt (Loop's `step`). Sensors feel gravity like anything else: give a bullet gravityScale 0.
   ================================================================ */
class Physics {
  constructor(opts = {}){
    this.gravity = 0; this.gravityX = 0;
    this.iterations = 8;     // solver passes per step: more = stiffer stacks
    this.substeps = 1;       // split each step() into this many smaller ones: more = more exact, at that many times the cost
    this.cell = 64;          // grid cell size: about the size of a typical body
    this.slop = 0.2;         // how far resting bodies may sink into each other (world units); stops jitter
    this.friction = 0.3;     // for bodies with no friction of their own
    this.bounceMin = 30;     // slower impacts than this don't bounce, so things come to rest
    this.onBegin = this.onEnd = this.filter = null;
    Object.assign(this, opts);
    this.bodies = []; this.buf = []; this.dist = -1; this.contacts = 0;
    this._cells = new Map(); this._used = []; this._ux = []; this._uy = [];
    this._pairs = new Map(); this._live = []; this._free = []; this._con = []; this._ev = []; this._begun = []; this._fixed = []; this._tf = null;
    this._stamp = 0; this._id = 1; this._nc = 0; this._sx = 0; this._sy = 0;
  }
  add(o){
    if (o._pid && o._in === this) return o;
    o.vx = o.vx || 0; o.vy = o.vy || 0; o.touch = 0; o._pid = this._id++; o._in = this; o._im = 0; o._x0 = o._y0 = o._x1 = o._y1 = o._mx = o._my = 0;
    this.bodies.push(o);
    return o;
  }
  remove(o){ const B = this.bodies, i = B.indexOf(o); if (i >= 0) { B[i] = B[B.length - 1]; B.pop(); o._pid = 0; } }
  clear(){
    for (const b of this.bodies) b._pid = 0;
    for (const c of this._live) { c.a = c.b = null; this._free.push(c); }
    this.bodies.length = this._live.length = this._ev.length = this.contacts = 0; this._pairs.clear();
  }
  walls(b, t = 200, opts = null){
    const m = (x, y, w, h) => this.add(Object.assign({ x, y, w, h, fixed: true }, opts));
    return [m(b.x - t, b.y - t, t, b.h + t * 2), m(b.x + b.w, b.y - t, t, b.h + t * 2), m(b.x - t, b.y - t, b.w + t * 2, t), m(b.x - t, b.y + b.h, b.w + t * 2, t)];
  }
  step(dt){
    if (!(dt > 0)) return;
    const B = this.bodies, ev = this._ev;
    for (let i = B.length - 1; i >= 0; i--) { const b = B[i]; if (b.dead === true) { B[i] = B[B.length - 1]; B.pop(); b._pid = 0; } else b.touch = 0; }
    if (this._id > 6e7) this._renumber();
    const n = Math.max(1, this.substeps | 0);
    for (let i = 0; i < n; i++) this._sub(dt / n);
    try {
      for (let i = 0; i < ev.length; i += 6) {
        const a = ev[i + 1], b = ev[i + 2];
        if (ev[i]) {
          const nx = ev[i + 3], ny = ev[i + 4], sp = ev[i + 5];
          if (this.onBegin) this.onBegin(a, b, nx, ny, sp);
          if (a.onHit) a.onHit(b, nx, ny, sp);
          if (b.onHit) b.onHit(a, 0 - nx, 0 - ny, sp);
        } else {
          if (this.onEnd) this.onEnd(a, b);
          if (a.onLeave) a.onLeave(b);
          if (b.onLeave) b.onLeave(a);
        }
      }
    } finally { ev.length = 0; }
  }
  raycast(ox, oy, dx, dy, max = Infinity, filter = null){
    const C = Collide, B = this.bodies; let best = null, bt = max, bx = 0, by = 0;
    for (let i = 0; i < B.length; i++) {
      const b = B[i]; if (b.dead === true) continue;
      const t = C.ray(ox, oy, dx, dy, b), nx = C.nx, ny = C.ny;
      if (t >= 0 && t < bt && (!filter || filter(b))) { best = b; bt = t; bx = nx; by = ny; }
    }
    C.nx = bx; C.ny = by; this.dist = best ? bt : -1;
    return best;
  }
  query(s, out = this.buf){
    const B = this.bodies; out.length = 0;
    for (let i = 0; i < B.length; i++) { const b = B[i]; if (b !== s && b.dead !== true && Collide.overlap(s, b)) out.push(b); }
    return out;
  }
  draw(c, color = '#4f8'){
    c.save(); c.strokeStyle = color; c.lineWidth = 1; c.beginPath();
    for (const b of this.bodies) {
      if (b.r !== undefined) { c.moveTo(b.x + b.r, b.y); c.arc(b.x, b.y, b.r, 0, TAU); }
      else if (b.pts) { for (let i = 0; i < b.pts.length; i += 2) c[i ? 'lineTo' : 'moveTo'](b.x + b.pts[i], b.y + b.pts[i + 1]); c.closePath(); }
      else c.rect(b.x, b.y, b.w, b.h);
    }
    c.stroke(); c.restore();
  }

  // ---- one step
  _sub(h){
    const C = Collide, B = this.bodies, inv = 1 / this.cell, gx = this.gravityX * h, gy = this.gravity * h, pad = this.slop * 2, stamp = ++this._stamp;
    const used = this._used, ux = this._ux, uy = this._uy, con = this._con, live = this._live, ev = this._ev, fixed = this._fixed, begun = this._begun;
    // 1. gravity and drag, then where each body could be during this step
    for (let i = 0; i < used.length; i++) used[i].length = 0;
    used.length = ux.length = uy.length = fixed.length = 0; if (this._cells.size > 8192) this._cells.clear();
    let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
    for (let i = 0; i < B.length; i++) {
      const b = B[i], im = b._im = C.invMass(b);
      if (im) {
        const g = b.gravityScale === undefined ? 1 : b.gravityScale; b.vx += gx * g; b.vy += gy * g;
        if (b.drag) { const k = Math.exp(-b.drag * h); b.vx *= k; b.vy *= k; }
      }
      let x0, y0, x1, y1;
      if (b.r !== undefined) { x0 = b.x - b.r; y0 = b.y - b.r; x1 = b.x + b.r; y1 = b.y + b.r; }
      else if (b.pts) { const p = b.pts; x0 = y0 = Infinity; x1 = y1 = -Infinity; for (let k = 0; k < p.length; k += 2) { const x = p[k] + b.x, y = p[k + 1] + b.y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      else { x0 = b.x; y0 = b.y; x1 = b.x + b.w; y1 = b.y + b.h; }
      const mx = b._mx = b.vx * h, my = b._my = b.vy * h;
      b._x0 = (mx < 0 ? x0 + mx : x0) - pad; b._x1 = (mx > 0 ? x1 + mx : x1) + pad; b._y0 = (my < 0 ? y0 + my : y0) - pad; b._y1 = (my > 0 ? y1 + my : y1) + pad;
      if (im) {   // things that can be pushed go in the grid first; fixed things only matter where those are
        const sx = Math.floor(b._x0 * inv), sy = Math.floor(b._y0 * inv), ex = Math.floor(b._x1 * inv), ey = Math.floor(b._y1 * inv);
        if (!((ex - sx + 1) * (ey - sy + 1) <= 16384)) continue;   // a broken position or speed (NaN, Infinity): leave it out
        if (sx < gx0) gx0 = sx; if (sy < gy0) gy0 = sy; if (ex > gx1) gx1 = ex; if (ey > gy1) gy1 = ey;
        this._file(b, sx, sy, ex, ey);
      }
    }
    for (let i = 0; i < B.length; i++) {
      const b = B[i]; if (b._im) continue;
      fixed.push(b);
      const sx = Math.max(gx0, Math.floor(b._x0 * inv)), sy = Math.max(gy0, Math.floor(b._y0 * inv)), ex = Math.min(gx1, Math.floor(b._x1 * inv)), ey = Math.min(gy1, Math.floor(b._y1 * inv));
      if (sx <= ex && sy <= ey) this._file(b, sx, sy, ex, ey);
    }
    // 2. pairs that share a cell. A pair that shares several is taken in the one that holds the corner of their overlap
    this._nc = 0;
    for (let u = 0; u < used.length; u++) {
      const a = used[u], cx = ux[u], cy = uy[u];
      for (let i = 0; i < a.length; i++) {
        const p = a[i];
        for (let j = i + 1; j < a.length; j++) {
          const q = a[j];
          if ((!p._im && !q._im) || p._x0 >= q._x1 || q._x0 >= p._x1 || p._y0 >= q._y1 || q._y0 >= p._y1) continue;
          if (Math.floor((p._x0 > q._x0 ? p._x0 : q._x0) * inv) !== cx || Math.floor((p._y0 > q._y0 ? p._y0 : q._y0) * inv) !== cy) continue;
          if (!((p.layer === undefined ? 1 : p.layer) & (q.mask === undefined ? -1 : q.mask)) || !((q.layer === undefined ? 1 : q.layer) & (p.mask === undefined ? -1 : p.mask))) continue;
          if (this.filter && !this.filter(p, q)) continue;
          if (p._pid < q._pid) this._narrow(p, q, h, stamp); else this._narrow(q, p, h, stamp);
        }
      }
    }
    const nc = this.contacts = this._nc;
    // 3. solve the contacts together: start from last step's answer, then refine
    for (let i = 0; i < nc; i++) {
      const c = con[i]; if (!c.jn && !c.jt) continue;
      const a = c.a, b = c.b, px = c.nx * c.jn - c.ny * c.jt, py = c.ny * c.jn + c.nx * c.jt;
      a.vx += px * a._im; a.vy += py * a._im; b.vx -= px * b._im; b.vy -= py * b._im;
    }
    for (let it = 0, ch = 1; it < this.iterations && ch > 1e-12; it++) {
      ch = 0;   // how much this pass changed anything: a pile at rest is done after one
      for (let i = 0; i < nc; i++) {
        const c = con[i], a = c.a, b = c.b, nx = c.nx, ny = c.ny, ia = a._im, ib = b._im;
        const jn = Math.max(0, c.jn + (c.bias - ((a.vx - b.vx) * nx + (a.vy - b.vy) * ny)) * c.k), j = jn - c.jn; c.jn = jn;
        if (j) { a.vx += nx * j * ia; a.vy += ny * j * ia; b.vx -= nx * j * ib; b.vy -= ny * j * ib; ch += j * j * c.k * c.k; }
        if (c.mu || c.jt) {
          const max = c.mu * jn, jt = clamp(c.jt + ((a.vx - b.vx) * ny - (a.vy - b.vy) * nx) * c.k, -max, max), f = jt - c.jt; c.jt = jt;
          if (f) { a.vx -= ny * f * ia; a.vy += nx * f * ia; b.vx += ny * f * ib; b.vy -= nx * f * ib; ch += f * f * c.k * c.k; }
        }
      }
    }
    // 4. move. A body the contacts have sent somewhere it was not heading is checked once more against the fixed
    // bodies on its new path, and stops where it would go through one (keeping its speed for the next step)
    for (let i = 0; i < B.length; i++) {
      const b = B[i]; if (!b._im) continue;
      let mx = b.vx * h, my = b.vy * h;
      if ((mx !== b._mx || my !== b._my) && mx * mx + my * my > pad * pad && !b.sensor) {
        const t = this._toi(b, mx, my, h);
        if (t < 1) { const f = this._tf; mx = mx * t + f.vx * h * (1 - t); my = my * t + f.vy * h * (1 - t); }
      }
      b.x += mx; b.y += my;
    }
    for (let i = 0; i < fixed.length; i++) { const b = fixed[i]; b.x += b.vx * h; b.y += b.vy * h; }
    // 5. ease apart whatever still overlaps (positions only, so no energy is added)
    const slop = this.slop;
    for (let it = 0; it < 3; it++) for (let i = 0; i < nc; i++) {
      const c = con[i]; if (!c.d && !c.jn) continue;
      const a = c.a, b = c.b, d = C.overlap(a, b); if (d <= slop) continue;
      const nx = C.nx, ny = C.ny; if (nx * c.nx + ny * c.ny < 0.7) continue;   // not the contact that was solved: next step's business
      const m = (d - slop) * 0.8 * c.k;
      a.x += nx * m * a._im; a.y += ny * m * a._im; b.x -= nx * m * b._im; b.y -= ny * m * b._im;
    }
    // 6. bounce: contacts that stopped something arriving fast send it back out. Solved together like step 3, because
    // one ball can be in two collisions at once
    const lim = Math.max(this.bounceMin, Math.hypot(gx, gy) * 2); let any = false;
    for (let i = 0; i < nc; i++) { const c = con[i]; c.out = c.jn > 0 ? c.e && c.vn0 < -lim ? -c.e * c.vn0 : 0 : -1; if (c.out > 0) any = true; }
    for (let it = 0, ch = 1; any && it < this.iterations && ch > 1e-12; it++) {
      ch = 0;
      for (let i = 0; i < nc; i++) {
        const c = con[i]; if (c.out < 0) continue;
        const a = c.a, b = c.b, nx = c.nx, ny = c.ny, jn = Math.max(0, c.jn + (c.out - ((a.vx - b.vx) * nx + (a.vy - b.vy) * ny)) * c.k), j = jn - c.jn; c.jn = jn;
        if (j) { a.vx += nx * j * a._im; a.vy += ny * j * a._im; b.vx -= nx * j * b._im; b.vy -= ny * j * b._im; ch += j * j * c.k * c.k; }
      }
    }
    // 7. who touches whom now: touch flags, begin and end events, and forget pairs that have parted
    for (let i = live.length - 1; i >= 0; i--) {
      const c = live[i], a = c.a, b = c.b, now = c.stamp === stamp && (c.sensor || c.d > 0 || c.jn > 0);
      if (now && !c.on) begun.push(1, a, b, c.nx, c.ny, c.vn0 < 0 ? -c.vn0 : 0); else if (!now && c.on) ev.push(0, a, b, 0, 0, 0);
      c.on = now;
      if (now && !c.sensor) {
        if (c.ny < -0.5) { a.touch |= 8; b.touch |= 4; } else if (c.ny > 0.5) { a.touch |= 4; b.touch |= 8; }
        if (c.nx > 0.5) { a.touch |= 1; b.touch |= 2; } else if (c.nx < -0.5) { a.touch |= 2; b.touch |= 1; }
      }
      if (c.stamp !== stamp) { this._pairs.delete(c.key); live[i] = live[live.length - 1]; live.pop(); c.a = c.b = null; this._free.push(c); }
    }
    for (let i = 0; i < begun.length; i++) ev.push(begun[i]);   // ends first: a body taken out and put back leaves, then arrives
    begun.length = 0;
  }
  _file(b, sx, sy, ex, ey){
    const cells = this._cells;
    for (let cx = sx; cx <= ex; cx++) for (let cy = sy; cy <= ey; cy++) {
      const k = (cx + 32768) * 65536 + (cy + 32768); let a = cells.get(k); if (!a) cells.set(k, a = []);
      if (!a.length) { this._used.push(a); this._ux.push(cx); this._uy.push(cy); }
      a.push(b);
    }
  }
  // One pair (a has the lower id): do they overlap, or will they touch within this step? If so, note the contact.
  _narrow(a, b, h, stamp){
    const C = Collide, sensor = !!(a.sensor || b.sensor), rvx = a.vx - b.vx, rvy = a.vy - b.vy;
    const tol = sensor ? 0 : this.slop * 2;   // for polygons the seam rule below is inside Collide
    let d = C.overlap(a, b, tol), t = 0;
    if (!d) { t = C._sweep(a, rvx * h, rvy * h, b, tol); if (t < 0) return; }
    let nx = C.nx, ny = C.ny;
    const key = a._pid * 67108864 + b._pid; let c = this._pairs.get(key);
    if (!sensor) {
      // Seams. Something resting on one box and meeting the side of its neighbour, by the hair that resting things
      // sink, has not hit a wall: it is on a floor made of two boxes. The face it barely overlaps is the one it is on.
      const ab = a.pts ? 0 : b.pts ? 0 : b.r === undefined ? 1 : a.r === undefined ? -1 : 0;
      if (ab) {
        const p = ab > 0 ? this._seam(a, b, d ? 2 : nx, ny) : this._seam(b, a, d ? 2 : -nx, -ny);
        if (p) { if (!d) return; d = p; nx = this._sx * ab + 0; ny = this._sy * ab + 0; }
      }
      // One-way platforms hold what comes down onto their top, and nothing else.
      if (a.oneWay || b.oneWay) {
        const up = b.oneWay ? ny : -ny, down = b.oneWay ? rvy : -rvy;
        if (!(up < -0.7 && ((c && c.on) || (down >= 0 && d <= this.slop * 4)))) return;
      }
    }
    if (!c) {
      c = this._free.pop() || { a: null, b: null, key: 0, ia: 0, ib: 0, nx: 0, ny: 0, d: 0, bias: 0, vn0: 0, jn: 0, jt: 0, k: 0, e: 0, mu: 0, out: 0, stamp: 0, on: false, sensor: false };
      c.a = a; c.b = b; c.key = key; c.ia = a._pid; c.ib = b._pid; c.jn = c.jt = 0; c.on = false; c.stamp = 0;
      this._pairs.set(key, c); this._live.push(c);
    }
    const vn = rvx * nx + rvy * ny;
    if (c.stamp !== stamp - 1 || c.nx * nx + c.ny * ny < 0.9 || sensor) c.jn = c.jt = 0;   // last step's answer only helps if the contact is the same
    c.nx = nx; c.ny = ny; c.d = d; c.vn0 = vn; c.bias = d ? 0 : Math.min(0, vn * t); c.stamp = stamp; c.sensor = sensor;
    if (sensor) return;
    c.k = 1 / (a._im + b._im); c.e = Math.max(a.bounce || 0, b.bounce || 0);
    const fa = a.friction === undefined ? this.friction : a.friction, fb = b.friction === undefined ? this.friction : b.friction; c.mu = Math.sqrt(fa * fb);
    this._con[this._nc++] = c;
  }
  // How much of its move (mx, my) body b can make before it runs into a fixed body: 1 = all of it. The one in the way
  // is left in _tf. Fixed bodies near where b was heading are in its grid cells; if it is leaving those, look at them all.
  _toi(b, mx, my, h){
    const inv = 1 / this.cell, r = b.r; let x0, y0, x1, y1, best = 1;
    if (r !== undefined) { x0 = b.x - r; y0 = b.y - r; x1 = b.x + r; y1 = b.y + r; }
    else if (b.pts) { x0 = b._x0; y0 = b._y0; x1 = b._x1; y1 = b._y1; }   // roughly: where it could have been
    else { x0 = b.x; y0 = b.y; x1 = b.x + b.w; y1 = b.y + b.h; }
    if (mx < 0) x0 += mx; else x1 += mx; if (my < 0) y0 += my; else y1 += my;
    if (x0 >= b._x0 && x1 <= b._x1 && y0 >= b._y0 && y1 <= b._y1) {
      for (let cx = Math.floor(x0 * inv), ex = Math.floor(x1 * inv); cx <= ex; cx++) for (let cy = Math.floor(y0 * inv), ey = Math.floor(y1 * inv); cy <= ey; cy++) {
        const a = this._cells.get((cx + 32768) * 65536 + (cy + 32768)); if (!a) continue;
        for (let i = 0; i < a.length; i++) if (!a[i]._im) best = this._toi1(b, a[i], mx, my, h, x0, y0, x1, y1, best);
      }
    } else for (let i = 0, F = this._fixed; i < F.length; i++) best = this._toi1(b, F[i], mx, my, h, x0, y0, x1, y1, best);
    return best;
  }
  _toi1(b, f, mx, my, h, x0, y0, x1, y1, best){
    const C = Collide;
    if (f._x0 >= x1 || f._x1 <= x0 || f._y0 >= y1 || f._y1 <= y0 || f.sensor || f.oneWay) return best;
    if (!((b.layer === undefined ? 1 : b.layer) & (f.mask === undefined ? -1 : f.mask)) || !((f.layer === undefined ? 1 : f.layer) & (b.mask === undefined ? -1 : b.mask)) || (this.filter && !this.filter(b, f))) return best;
    if (C.overlap(b, f)) return best;   // already in it: the contact deals with that
    const rx = mx - f.vx * h, ry = my - f.vy * h, t = C._sweep(b, rx, ry, f, this.slop * 2);
    if (t < 0 || t >= best || (rx * C.nx + ry * C.ny) * (t - 1) <= this.slop * 2) return best;   // a miss, or it ends no deeper than things rest
    if (!b.pts && !f.pts && f.r === undefined && this._seam(b, f, C.nx, C.ny)) return best;
    this._tf = f;
    return t;
  }
  // s (a circle or a box) against a box. For an overlap (ex = 2): of the box's four faces, the one s has sunk into
  // deepest without going deeper than a resting body does; returns that depth with the face's normal in _sx / _sy, or 0
  // if there is none. For a sweep that is about to hit the face with normal (ex, ey): returns 1 if s is level with any
  // other face, to within that same depth, which is what resting on the neighbouring box looks like.
  _seam(s, b, ex, ey){
    const tol = this.slop * 2, lo = ex === 2 ? Number.MIN_VALUE : -tol, r = s.r, x0 = s.x - (r === undefined ? 0 : r), y0 = s.y - (r === undefined ? 0 : r);
    const l = x0 + (r === undefined ? s.w : r * 2) - b.x, rt = b.x + b.w - x0, t = y0 + (r === undefined ? s.h : r * 2) - b.y, u = b.y + b.h - y0;
    let p = 0; this._sx = this._sy = 0;
    if (l >= lo && l <= tol && !(ex === -1 && !ey) && (l > p || lo < 0)) { p = l; this._sx = -1; this._sy = 0; if (lo < 0) return 1; }
    if (rt >= lo && rt <= tol && !(ex === 1 && !ey) && (rt > p || lo < 0)) { p = rt; this._sx = 1; this._sy = 0; if (lo < 0) return 1; }
    if (t >= lo && t <= tol && !(ey === -1 && !ex) && (t > p || lo < 0)) { p = t; this._sx = 0; this._sy = -1; if (lo < 0) return 1; }
    if (u >= lo && u <= tol && !(ey === 1 && !ex) && (u > p || lo < 0)) { p = u; this._sx = 0; this._sy = 1; if (lo < 0) return 1; }
    return p;
  }
  // Ids only ever grow, so a body that leaves and comes back is a stranger to the pairs it was in. Once in a very long
  // while, count again from 1.
  _renumber(){
    const live = this._live; this._pairs.clear();
    for (const c of live) if (c.a._pid !== c.ia || c.b._pid !== c.ib) c.key = -1;   // one of them has left: this pair ends at the next step
    let n = 1; for (const b of this.bodies) b._pid = n++; this._id = n;
    for (const c of live) {
      if (c.key < 0) continue;
      if (c.a._pid > c.b._pid) { const a = c.a; c.a = c.b; c.b = a; c.nx = -c.nx; c.ny = -c.ny; }
      c.ia = c.a._pid; c.ib = c.b._pid; c.key = c.ia * 67108864 + c.ib; this._pairs.set(c.key, c);
    }
  }
}
