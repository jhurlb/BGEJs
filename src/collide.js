'use strict';
/* ================================================================
   COLLISION HELPERS for circles, axis-aligned boxes, segments, rays and polygons. Plain functions, no allocation.
   Boxes are { x, y, w, h } with x, y the top-left corner. Rays take a unit direction and return the distance to
   the first hit, or -1. Functions that find a surface (rayBox, pushOutOfBox) leave its normal in Collide.nx / ny,
   which you can hand to Collide.bounce(vel, restitution) to reflect a velocity { vx, vy } off it:
     if (Collide.pushOutOfBox(ball, wall)) Collide.bounce(ball, 0.8);   // ball: { x, y, r, vx, vy }
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
  separate(a, b){
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), o = (a.r + b.r) - d;
    if (o <= 0) return 0;
    const nx = d ? dx / d : 1, ny = d ? dy / d : 0, ma = a.mass || 1, mb = b.mass || 1, ka = mb / (ma + mb), kb = ma / (ma + mb);
    a.x -= nx * o * ka; a.y -= ny * o * ka; b.x += nx * o * kb; b.y += ny * o * kb;
    return o;
  },
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
  nx: 0, ny: 0,
  // Keep a circle inside a box; returns which walls it touched as a bit mask (1 left, 2 right, 4 top, 8 bottom).
  clampToBox(o, b){
    let hit = 0;
    if (o.x - o.r < b.x) { o.x = b.x + o.r; hit |= 1; } else if (o.x + o.r > b.x + b.w) { o.x = b.x + b.w - o.r; hit |= 2; }
    if (o.y - o.r < b.y) { o.y = b.y + o.r; hit |= 4; } else if (o.y + o.r > b.y + b.h) { o.y = b.y + b.h - o.r; hit |= 8; }
    return hit;
  },
};
