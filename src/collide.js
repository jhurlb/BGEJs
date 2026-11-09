'use strict';
/* ================================================================
   COLLISION HELPERS for circles, axis-aligned boxes, segments, rays and polygons. Plain functions, no allocation.
   Boxes are { x, y, w, h } with x, y the top-left corner. Rays take a unit direction and return the distance to
   the first hit, or -1. Functions that find a surface (rayBox, pushOutOfBox, ray, overlap, sweep) leave its normal in
   Collide.nx / ny, which you can hand to Collide.bounce(vel, restitution) to reflect a velocity { vx, vy } off it:
     if (Collide.pushOutOfBox(ball, wall)) Collide.bounce(ball, 0.8);   // ball: { x, y, r, vx, vy }

   SHAPES. overlap, sweep, ray and resolve take any two shapes, each a plain object:
     { x, y, r }             a circle, x, y its centre
     { x, y, w, h }          a box, x, y its top-left corner
     { x, y, pts: [...] }    a convex polygon: [x0, y0, x1, y1, ...] relative to x, y, wound either way
     Collide.overlap(a, b)            how deep a is in b (0 = apart); nx / ny is the way to move a to get out
     Collide.sweep(a, dx, dy, b)      a moves by (dx, dy): the share of the move, 0..1, at which it first touches b, or -1.
                                      Nothing can tunnel through this, however fast or thin. nx / ny is the surface it hits
     Collide.ray(ox, oy, dx, dy, s)   rayCircle / rayBox for any shape, always with the normal
     Collide.resolve(a, b, bounce, friction)   a full collision between two things with vx, vy and an optional mass:
                                      pushes them apart and trades momentum. mass: Infinity or fixed: true never moves
   For many things at once, with gravity, stacking and resting contact, use Physics (physics.js), which is built on these.
   ================================================================ */
const Collide = {
  circles(ax, ay, ar, bx, by, br){ const r = ar + br; return dist2(ax, ay, bx, by) < r * r; },
  pointInBox(px, py, b){ return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h; },
  boxes(a, b){ return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; },
  circleBox(cx, cy, r, b){ const nx = clamp(cx, b.x, b.x + b.w), ny = clamp(cy, b.y, b.y + b.h); return dist2(cx, cy, nx, ny) < r * r; },
  // Closest point on segment a-b to p, as t in [0, 1].
  segT(px, py, ax, ay, bx, by){ const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; return l ? clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1) : 0; },
  segDist2(px, py, ax, ay, bx, by){ const t = Collide.segT(px, py, ax, ay, bx, by); return dist2(px, py, ax + (bx - ax) * t, ay + (by - ay) * t); },
  segCircle(ax, ay, bx, by, cx, cy, r){ return Collide.segDist2(cx, cy, ax, ay, bx, by) < r * r; },
  // Ray from (ox, oy) along unit (dx, dy) against a circle: distance to the first hit, or -1.
  rayCircle(ox, oy, dx, dy, cx, cy, r){
    const fx = ox - cx, fy = oy - cy, b = fx * dx + fy * dy, c = fx * fx + fy * fy - r * r;
    if (c > 0 && b > 0) return -1;
    const disc = b * b - c; if (disc < 0) return -1;
    const t = -b - Math.sqrt(disc); return t < 0 ? 0 : t;
  },
  // Ray against a box (slab test). Starting inside gives 0. Collide.nx / ny get the normal of the face it entered by.
  rayBox(ox, oy, dx, dy, b){
    let t0 = 0, t1 = Infinity, nx = 0, ny = 0;
    if (dx) { const i = 1 / dx; let a = (b.x - ox) * i, c = (b.x + b.w - ox) * i, s = -1; if (a > c) { const t = a; a = c; c = t; s = 1; } if (a > t0) { t0 = a; nx = s; ny = 0; } if (c < t1) t1 = c; }
    else if (ox < b.x || ox > b.x + b.w) return -1;
    if (dy) { const i = 1 / dy; let a = (b.y - oy) * i, c = (b.y + b.h - oy) * i, s = -1; if (a > c) { const t = a; a = c; c = t; s = 1; } if (a > t0) { t0 = a; nx = 0; ny = s; } if (c < t1) t1 = c; }
    else if (oy < b.y || oy > b.y + b.h) return -1;
    if (t0 > t1) return -1;
    Collide.nx = nx; Collide.ny = ny;
    return t0;
  },
  // Where segment a-b crosses segment c-d: t along a-b in [0, 1] (the point is a + (b - a) * t), or -1. Parallel segments never cross.
  segments(ax, ay, bx, by, cx, cy, dx, dy){
    const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy, den = rx * sy - ry * sx;
    if (!den) return -1;
    const t = ((cx - ax) * sy - (cy - ay) * sx) / den, u = ((cx - ax) * ry - (cy - ay) * rx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
  },
  pointInPoly(px, py, pts){   // pts: [x0, y0, x1, y1, ...]
    let inside = false;
    for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
      const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  },
  // Push two overlapping circles apart, split by mass (objects with x, y, r and optional mass). Returns the overlap.
  // mass: Infinity (or fixed: true) is never moved.
  separate(a, b){
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), o = (a.r + b.r) - d;
    if (o <= 0) return 0;
    const ia = Collide.invMass(a), ib = Collide.invMass(b), k = ia + ib; if (!k) return o;
    const nx = d ? dx / d : 1, ny = d ? dy / d : 0, ka = ia / k, kb = ib / k;
    a.x -= nx * o * ka; a.y -= ny * o * ka; b.x += nx * o * kb; b.y += ny * o * kb;
    return o;
  },
  invMass(o){ return o.fixed || o.mass === Infinity ? 0 : o.mass > 0 ? 1 / o.mass : 1; },   // no mass, 0 or nonsense counts as 1
  // Move a circle { x, y, r } out of a solid box it overlaps (walls, platforms). Returns true when it was moved,
  // with the direction it was pushed in Collide.nx / ny.
  pushOutOfBox(o, b){
    const qx = clamp(o.x, b.x, b.x + b.w), qy = clamp(o.y, b.y, b.y + b.h);
    let dx = o.x - qx, dy = o.y - qy; const d2 = dx * dx + dy * dy;
    if (d2 >= o.r * o.r) return false;
    if (d2 > 0) { const d = Math.sqrt(d2); dx /= d; dy /= d; o.x = qx + dx * o.r; o.y = qy + dy * o.r; }
    else {   // the centre is inside the box: leave by the nearest side
      const l = o.x - b.x, r = b.x + b.w - o.x, t = o.y - b.y, u = b.y + b.h - o.y, m = Math.min(l, r, t, u);
      dx = dy = 0;
      if (m === l) { dx = -1; o.x = b.x - o.r; } else if (m === r) { dx = 1; o.x = b.x + b.w + o.r; } else if (m === t) { dy = -1; o.y = b.y - o.r; } else { dy = 1; o.y = b.y + b.h + o.r; }
    }
    Collide.nx = dx; Collide.ny = dy;
    return true;
  },
  // Reflect a velocity { vx, vy } off the surface whose normal is in Collide.nx / ny (or pass your own). `restitution` is
  // the share of speed kept along the normal (1 = perfect bounce, 0 = slide). Does nothing when already moving away.
  bounce(v, restitution = 1, nx = Collide.nx, ny = Collide.ny){
    const d = v.vx * nx + v.vy * ny; if (d >= 0) return v;
    v.vx -= (1 + restitution) * d * nx; v.vy -= (1 + restitution) * d * ny;
    return v;
  },
  // ---- any shape against any shape
  // How deep a is in b, or 0 when they are apart. Collide.nx / ny is the shortest way to move a out of b.
  overlap(a, b, tol = 0){   // tol is for Physics: see _polys
    const C = Collide, ka = a.r !== undefined ? 0 : a.pts ? 2 : 1, kb = b.r !== undefined ? 0 : b.pts ? 2 : 1;
    if (ka === 0) {
      if (kb === 0) {
        const dx = a.x - b.x, dy = a.y - b.y, r = a.r + b.r, d2 = dx * dx + dy * dy; if (d2 >= r * r) return 0;
        const d = Math.sqrt(d2); C.nx = d ? dx / d : -1; C.ny = d ? dy / d : 0; return r - d;
      }
      return kb === 1 ? C._circleBox(a, b) : C._circlePoly(a, C._b, C._verts(b, C._b));
    }
    if (kb === 0) { const d = ka === 1 ? C._circleBox(b, a) : C._circlePoly(b, C._a, C._verts(a, C._a)); if (d) { C.nx = 0 - C.nx; C.ny = 0 - C.ny; } return d; }
    if (ka === 1 && kb === 1) {
      const l = a.x + a.w - b.x, r = b.x + b.w - a.x, t = a.y + a.h - b.y, u = b.y + b.h - a.y;
      if (l <= 0 || r <= 0 || t <= 0 || u <= 0) return 0;
      const ox = l < r ? l : r, oy = t < u ? t : u;
      if (ox < oy) { C.nx = l < r ? -1 : 1; C.ny = 0; return ox; }
      C.nx = 0; C.ny = t < u ? -1 : 1; return oy;
    }
    return C._polys(C._a, C._verts(a, C._a), C._b, C._verts(b, C._b), tol);
  },
  // a moves by (dx, dy) while b stays put: the share of the move (0..1) at which a first touches b, or -1 if it never does.
  // The point of contact is a's position plus (dx, dy) * t, and Collide.nx / ny is b's surface normal there. For two moving
  // things pass their relative movement. If they already overlap: 0 when the move goes deeper, -1 when it leads out.
  sweep(a, dx, dy, b){ const C = Collide; if (C.overlap(a, b)) return dx * C.nx + dy * C.ny < 0 ? 0 : -1; return C._sweep(a, dx, dy, b); },
  // Ray from (ox, oy) along unit (dx, dy) against any shape: distance to the first hit, or -1. Starting inside gives 0
  // with no normal (nx = ny = 0).
  ray(ox, oy, dx, dy, s){
    const C = Collide;
    if (s.r !== undefined) {
      const t = C.rayCircle(ox, oy, dx, dy, s.x, s.y, s.r);
      if (t > 0) { C.nx = (ox + dx * t - s.x) / s.r; C.ny = (oy + dy * t - s.y) / s.r; } else if (t === 0) C.nx = C.ny = 0;
      return t;
    }
    if (!s.pts) return C.rayBox(ox, oy, dx, dy, s);
    const V = C._b, n = C._verts(s, V); let t0 = 0, t1 = Infinity, bx = 0, by = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const x1 = V[j * 2], y1 = V[j * 2 + 1], ex = V[i * 2] - x1, ey = V[i * 2 + 1] - y1, l = Math.hypot(ex, ey); if (!l) continue;
      const ux = ey / l, uy = -ex / l, den = dx * ux + dy * uy, off = (x1 - ox) * ux + (y1 - oy) * uy;
      if (!den) { if (off < 0) return -1; continue; }
      const t = off / den;
      if (den < 0) { if (t > t0) { t0 = t; bx = ux; by = uy; } } else if (t < t1) t1 = t;
      if (t0 > t1) return -1;
    }
    C.nx = bx + 0; C.ny = by + 0;
    return t0;
  },
  // A whole collision between two shapes that have a velocity (vx, vy) and maybe a mass: push them apart, split by mass,
  // and exchange momentum along the normal. bounce 0 = they stop against each other, 1 = perfectly elastic; friction
  // slows the slide along the surface. Returns the overlap there was (0 = no contact), with the normal in Collide.nx / ny.
  resolve(a, b, bounce = 0, friction = 0){
    const C = Collide, d = C.overlap(a, b); if (!d) return 0;
    const ia = C.invMass(a), ib = C.invMass(b), k = ia + ib; if (!k) return d;
    const nx = C.nx, ny = C.ny, avx = a.vx || 0, avy = a.vy || 0, bvx = b.vx || 0, bvy = b.vy || 0;
    a.x += nx * d * ia / k; a.y += ny * d * ia / k; b.x -= nx * d * ib / k; b.y -= ny * d * ib / k;
    const rx = avx - bvx, ry = avy - bvy, vn = rx * nx + ry * ny;
    if (vn < 0) {
      const j = -(1 + bounce) * vn / k, f = clamp((rx * ny - ry * nx) / k, -friction * j, friction * j), px = nx * j - ny * f, py = ny * j + nx * f;
      if (ia) { a.vx = avx + px * ia; a.vy = avy + py * ia; }
      if (ib) { b.vx = bvx - px * ib; b.vy = bvy - py * ib; }
    }
    return d;
  },
  // ---- the workings of the above. Polygons are copied into _a / _b in world space, wound so (ey, -ex) points outwards.
  _a: [], _b: [], _e: { x: 0, y: 0, w: 0, h: 0 },
  _verts(s, out){
    const x = s.x, y = s.y, p = s.pts;
    if (!p) { const X = x + s.w, Y = y + s.h; out[0] = x; out[1] = y; out[2] = X; out[3] = y; out[4] = X; out[5] = Y; out[6] = x; out[7] = Y; return 4; }
    const n = p.length >> 1; let area = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) area += p[j * 2] * p[i * 2 + 1] - p[i * 2] * p[j * 2 + 1];
    if (area >= 0) for (let i = 0; i < n * 2; i += 2) { out[i] = p[i] + x; out[i + 1] = p[i + 1] + y; }
    else for (let i = 0, j = n * 2 - 2; i < n * 2; i += 2, j -= 2) { out[i] = p[j] + x; out[i + 1] = p[j + 1] + y; }
    return n;
  },
  _circleBox(c, b){
    const C = Collide, qx = clamp(c.x, b.x, b.x + b.w), qy = clamp(c.y, b.y, b.y + b.h), dx = c.x - qx, dy = c.y - qy, d2 = dx * dx + dy * dy;
    if (d2 > 0) { if (d2 >= c.r * c.r) return 0; const d = Math.sqrt(d2); C.nx = dx / d; C.ny = dy / d; return c.r - d; }
    const l = c.x - b.x, r = b.x + b.w - c.x, t = c.y - b.y, u = b.y + b.h - c.y, m = Math.min(l, r, t, u);   // the centre is inside
    C.nx = m === l ? -1 : m === r ? 1 : 0; C.ny = C.nx ? 0 : m === t ? -1 : 1;
    return m + c.r;
  },
  _circlePoly(c, V, n){
    const C = Collide, r = c.r; let best = -Infinity, bx = 0, by = 0, near = Infinity, qx = 0, qy = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const x1 = V[j * 2], y1 = V[j * 2 + 1], ex = V[i * 2] - x1, ey = V[i * 2 + 1] - y1, l2 = ex * ex + ey * ey; if (!l2) continue;   // a repeated point
      const l = Math.sqrt(l2), ux = ey / l, uy = -ex / l, s = (c.x - x1) * ux + (c.y - y1) * uy; if (s >= r && s > 0) return 0;
      if (s > best) { best = s; bx = ux; by = uy; }
      const u = clamp(((c.x - x1) * ex + (c.y - y1) * ey) / l2, 0, 1), px = x1 + ex * u, py = y1 + ey * u, d2 = dist2(c.x, c.y, px, py);
      if (d2 < near) { near = d2; qx = px; qy = py; }
    }
    if (best > 0) {   // the centre is outside: it touches the nearest point of the outline, an edge or a corner
      if (near >= r * r) return 0;
      const d = Math.sqrt(near); if (d) { C.nx = (c.x - qx) / d; C.ny = (c.y - qy) / d; return r - d; }
    }
    if (best === -Infinity) return 0;
    C.nx = bx + 0; C.ny = by + 0;
    return r - best;
  },
  // Separating axes: the edge normals of both polygons. The smallest overlap is the way out. With a tolerance, an axis
  // they overlap on by no more than that is preferred, the deepest such: Physics uses this for things resting across a
  // seam between two tiles, which overlap the next tile's side by a hair and its top by the depth things rest at.
  _polys(A, na, B, nb, tol = 0){
    const C = Collide; let best = Infinity, bx = 0, by = 0, sh = 0, sx = 0, sy = 0;
    for (let pass = 0; pass < 2; pass++) {
      const V = pass ? B : A, n = pass ? nb : na;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ex = V[i * 2] - V[j * 2], ey = V[i * 2 + 1] - V[j * 2 + 1], l = Math.hypot(ex, ey); if (!l) continue;   // a repeated point
        const ux = ey / l, uy = -ex / l;
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        for (let k = 0; k < na * 2; k += 2) { const p = A[k] * ux + A[k + 1] * uy; if (p < a0) a0 = p; if (p > a1) a1 = p; }
        for (let k = 0; k < nb * 2; k += 2) { const p = B[k] * ux + B[k + 1] * uy; if (p < b0) b0 = p; if (p > b1) b1 = p; }
        const lo = a1 - b0, hi = b1 - a0, o = lo < hi ? lo : hi, s = lo < hi ? -1 : 1; if (o <= 0) return 0;
        if (o < best) { best = o; bx = ux * s; by = uy * s; }
        if (o <= tol && o > sh) { sh = o; sx = ux * s; sy = uy * s; }
      }
    }
    if (best === Infinity) return 0;
    if (sh) { C.nx = sx + 0; C.ny = sy + 0; return sh; }
    C.nx = bx + 0; C.ny = by + 0;
    return best;
  },
  // sweep() for shapes known to be apart (touching counts as a hit at 0 when the move presses them together).
  _sweep(a, dx, dy, b, tol = 0){
    const C = Collide, ka = a.r !== undefined ? 0 : a.pts ? 2 : 1, kb = b.r !== undefined ? 0 : b.pts ? 2 : 1;
    if (!dx && !dy) return -1;
    if (ka === 0) return kb === 0 ? C._sweepPt(a.x - b.x, a.y - b.y, dx, dy, a.r + b.r) : kb === 1 ? C._sweepCB(a, dx, dy, b) : C._sweepCP(a, dx, dy, C._b, C._verts(b, C._b));
    if (kb === 0) { const t = ka === 1 ? C._sweepCB(b, -dx, -dy, a) : C._sweepCP(b, -dx, -dy, C._a, C._verts(a, C._a)); if (t >= 0) { C.nx = 0 - C.nx; C.ny = 0 - C.ny; } return t; }
    if (ka === 1 && kb === 1) {   // a box against a box is a point against a bigger box
      const E = C._e; E.x = b.x - a.w; E.y = b.y - a.h; E.w = b.w + a.w; E.h = b.h + a.h;
      const t = C.rayBox(a.x, a.y, dx, dy, E);
      return t < 0 || t > 1 ? -1 : t === 0 && !C.nx && !C.ny ? C._face(a.x, a.y, dx, dy, E) : t;
    }
    return C._sweepPP(C._a, C._verts(a, C._a), dx, dy, C._b, C._verts(b, C._b), tol);
  },
  // A point at (fx, fy) from the centre of a circle of radius R moves by (dx, dy).
  _sweepPt(fx, fy, dx, dy, R){
    const C = Collide, A = dx * dx + dy * dy, B = fx * dx + fy * dy, c = fx * fx + fy * fy - R * R;
    if (B >= 0 || !A) return -1;   // moving away
    let t = 0;
    if (c > 0) { const disc = B * B - A * c; if (disc < 0) return -1; t = (-B - Math.sqrt(disc)) / A; if (t > 1) return -1; if (t < 0) t = 0; }
    const hx = fx + dx * t, hy = fy + dy * t, l = Math.hypot(hx, hy);
    if (l) { C.nx = hx / l; C.ny = hy / l; } else { const m = Math.sqrt(A); C.nx = -dx / m; C.ny = -dy / m; }
    return t;
  },
  // A point on the edge of box E (or a hair inside it): the face it is on, if the move goes into it.
  _face(px, py, dx, dy, E){
    const C = Collide, l = px - E.x, r = E.x + E.w - px, t = py - E.y, u = E.y + E.h - py, m = Math.min(l, r, t, u);
    C.nx = m === l ? -1 : m === r ? 1 : 0; C.ny = C.nx ? 0 : m === t ? -1 : 1;
    return dx * C.nx + dy * C.ny < 0 ? 0 : -1;
  },
  // A circle against a box is a point against the box grown by r, with rounded corners.
  _sweepCB(c, dx, dy, b){
    const C = Collide, r = c.r, E = C._e; E.x = b.x - r; E.y = b.y - r; E.w = b.w + r * 2; E.h = b.h + r * 2;
    const t = C.rayBox(c.x, c.y, dx, dy, E); if (t < 0 || t > 1) return -1;
    const hx = c.x + dx * t, hy = c.y + dy * t, kx = hx < b.x ? b.x : hx > b.x + b.w ? b.x + b.w : hx, ky = hy < b.y ? b.y : hy > b.y + b.h ? b.y + b.h : hy;
    if (kx !== hx && ky !== hy) return C._sweepPt(c.x - kx, c.y - ky, dx, dy, r);
    return t === 0 && !C.nx && !C.ny ? C._face(c.x, c.y, dx, dy, E) : t;
  },
  // A circle against a polygon: each edge moved out by r, and a circle of r round each corner.
  _sweepCP(c, dx, dy, V, n){
    const C = Collide, r = c.r; let best = -1, bx = 0, by = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const x1 = V[j * 2], y1 = V[j * 2 + 1], ex = V[i * 2] - x1, ey = V[i * 2 + 1] - y1, l = Math.hypot(ex, ey), ux = l ? ey / l : 0, uy = l ? -ex / l : 0, dn = dx * ux + dy * uy;
      if (dn < 0) {
        const s = (c.x - x1) * ux + (c.y - y1) * uy - r;
        if (s > -1e-6) {
          const t = s > 0 ? -s / dn : 0, u = ((c.x + dx * t - x1) * ex + (c.y + dy * t - y1) * ey) / (l * l);
          if (t <= 1 && (best < 0 || t < best) && u >= 0 && u <= 1) { best = t; bx = ux; by = uy; }
        }
      }
      const t = C._sweepPt(c.x - x1, c.y - y1, dx, dy, r);
      if (t >= 0 && (best < 0 || t < best)) { best = t; bx = C.nx; by = C.ny; }
    }
    C.nx = bx + 0; C.ny = by + 0;
    return best;
  },
  // Two convex polygons: on each axis find when their shadows start and stop overlapping. They touch when the last
  // axis starts, provided no axis has stopped by then. With a tolerance (Physics again), a hit is let go when on some
  // other axis the two are level to within it: that is something on one tile meeting the side of the next.
  _sweepPP(A, na, dx, dy, B, nb, tol = 0){
    const C = Collide; let t0 = -Infinity, t1 = Infinity, bx = 0, by = 0, seams = 0, sx = 0, sy = 0;
    for (let pass = 0; pass < 2; pass++) {
      const V = pass ? B : A, n = pass ? nb : na;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ex = V[i * 2] - V[j * 2], ey = V[i * 2 + 1] - V[j * 2 + 1], l = Math.hypot(ex, ey); if (!l) continue;   // a repeated point
        const ux = ey / l, uy = -ex / l, v = dx * ux + dy * uy;
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        for (let k = 0; k < na * 2; k += 2) { const p = A[k] * ux + A[k + 1] * uy; if (p < a0) a0 = p; if (p > a1) a1 = p; }
        for (let k = 0; k < nb * 2; k += 2) { const p = B[k] * ux + B[k + 1] * uy; if (p < b0) b0 = p; if (p > b1) b1 = p; }
        if (tol && Math.abs(Math.min(a1 - b0, b1 - a0)) <= tol) {   // remember up to two such axes that differ
          if (!seams) { seams = 1; sx = ux; sy = uy; } else if (Math.abs(sx * ux + sy * uy) < 0.999) seams = 2;
        }
        if (Math.abs(v) < 1e-12) { if (a1 <= b0 || b1 <= a0) return -1; continue; }
        const en = (v > 0 ? b0 - a1 : b1 - a0) / v, lv = (v > 0 ? b1 - a0 : b0 - a1) / v;
        if (en > t0) { t0 = en; bx = v > 0 ? -ux : ux; by = v > 0 ? -uy : uy; }
        if (lv < t1) t1 = lv;
        if (t0 > t1 || t0 > 1 || t1 <= 0) return -1;
      }
    }
    if (t0 === -Infinity || seams === 2 || (seams && Math.abs(sx * bx + sy * by) < 0.999)) return -1;
    C.nx = bx + 0; C.ny = by + 0;
    return t0 < 0 ? 0 : t0;
  },
  nx: 0, ny: 0,
  // Keep a circle inside a box; returns which walls it touched as a bit mask (1 left, 2 right, 4 top, 8 bottom).
  clampToBox(o, b){
    let hit = 0;
    if (o.x - o.r < b.x) { o.x = b.x + o.r; hit |= 1; } else if (o.x + o.r > b.x + b.w) { o.x = b.x + b.w - o.r; hit |= 2; }
    if (o.y - o.r < b.y) { o.y = b.y + o.r; hit |= 4; } else if (o.y + o.r > b.y + b.h) { o.y = b.y + b.h - o.r; hit |= 8; }
    return hit;
  },
};
