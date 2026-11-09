'use strict';
/* ================================================================
   COLLISION HELPERS for circles, axis-aligned boxes and segments. Plain functions, no allocation
   unless noted. Boxes are { x, y, w, h } with x, y the top-left corner.
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
  // Keep a circle inside a box; returns which walls it touched as a bit mask (1 left, 2 right, 4 top, 8 bottom).
  clampToBox(o, b){
    let hit = 0;
    if (o.x - o.r < b.x) { o.x = b.x + o.r; hit |= 1; } else if (o.x + o.r > b.x + b.w) { o.x = b.x + b.w - o.r; hit |= 2; }
    if (o.y - o.r < b.y) { o.y = b.y + o.r; hit |= 4; } else if (o.y + o.r > b.y + b.h) { o.y = b.y + b.h - o.r; hit |= 8; }
    return hit;
  },
};
