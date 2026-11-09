'use strict';
/* ================================================================
   TILEMAP: a level as a grid of numbered tiles, in layers. It draws only what is on screen, collides, hands its
   walls to Physics, casts rays and finds paths. Tile 0 is empty.
     const map = Tilemap.from(['#######',
                               '#P...*#',
                               '#######'], 40, { '#': 1 });   // rows of characters, the tile size in world units, and which
                                                              // character is which tile. '.' and ' ' are empty; any other
                                                              // character leaves a mark: map.marks.P[0] is { x, y, cx, cy }
     const map = new Tilemap(cols, rows, 40);                 // or an empty one...
     const map = Tilemap.tiled(Assets.get('level1'));         // ...or a map saved from the Tiled editor as JSON
     map.get(cx, cy);  map.set(cx, cy, id);  map.at(x, y);    // by cell, or by world position. Outside the map is 0
     map.fill(cx, cy, w, h, id);  map.cx(x);  map.cy(y);  map.w;  map.h;  map.bounds   // bounds fits cam.bounds
     map.layer('back')                                        // get or add a layer; get, set, at, fill and draw take one last
                                                              // (a name or a number, default the first). layer.visible, layer.alpha

   WHAT A TILE IS. With nothing said, every tile but 0 is a solid block. map.def(id, { ... }) says otherwise:
     solid: false            walked through (decoration)
     oneWay: true            a platform: landed on from above, passed through otherwise. h: 0.25 makes it that share of a tile thick
     pts: [0, 1, 1, 0, 1, 1] a convex polygon in shares of a tile (this one is a slope up to the right), for Physics
     color: '#345'           what to fill it with when there is no sheet;  frame: 7  which sheet frame, if not id - 1
     frames: [4, 5, 6], fps: 6   an animated tile (call map.update(dt));  draw(c, x, y, size, cx, cy, id)   draw it yourself
     body: { bounce: 1 }     extra properties for its Physics body

   DRAWING
     map.sheet = Sprites.sheet(Assets.get('tiles'), 16, 16);  // tile id 1 is frame 0, as Tiled numbers them (map.firstId)
     map.draw(ctx, cam.view);                                 // every visible layer, only the tiles in view
     map.draw(ctx, cam.view, 'back');  ...actors...  map.draw(ctx, cam.view, 'front');
     map.paint = (c, id, x, y, size, cx, cy) => { ... };      // or draw every tile yourself
     map.prerender = 16;                                      // draw tiles once into big cached pictures, at this many pixels a tile,
                                                              // and stamp those: far fewer draw calls, and no hairlines between tiles.
                                                              // set() redraws what it touches; call map.redraw() after changing
                                                              // defs, the sheet or paint. Animated tiles stand still when prerendered

   COLLIDING, without Physics: move a box { x, y, w, h } or a circle { x, y, r } (as its square) and stop at the walls.
     const t = map.move(player, player.vx * dt, player.vy * dt);   // t: the sides that hit, 1 left, 2 right, 4 top, 8 bottom
     if (t & 3) player.vx = 0;  if (t & 12) player.vy = 0;  const onGround = t & 8;
   However far it moves it cannot skip a wall. map.move(o, dx, dy, true) falls through one-way platforms.
   map.blocked(x, y) is "is this point in a wall"; map.edge = true makes everything outside the map solid.

   WITH PHYSICS
     map.addTo(world, { friction: 0.5 });      // the walls as fixed bodies: solid tiles joined into as few boxes as will do,
                                               // one-way runs, and a polygon per `pts` tile. map.bodies is the list.
     map.addTo(world) again after changing tiles; map.removeFrom() takes them out.

   RAYS AND PATHS (tiles count as whole squares here, slopes included; one-way tiles do not block)
     map.raycast(ox, oy, dx, dy, max)          // distance along a unit direction to the first wall, or -1. map.hit is
                                               // { cx, cy, id } and Collide.nx / ny the wall's normal
     map.sees(ax, ay, bx, by)                  // true when no wall is between two points
     map.path(ax, ay, bx, by, { diagonal: true, max: 5000, cost(id, cx, cy) })   // the shortest way round the walls (A*): the
                                               // centre of each tile to pass through, [{ x, y }, ...], or null when there is none.
                                               // cost returns how many times dearer a tile is to cross (mud: 3), Infinity = never.
                                               // max caps the tiles looked at, so a far goal can't stall a frame
   ================================================================ */
class Tilemap {
  constructor(cols, rows, tile = 32, o = {}){
    this.cols = cols; this.rows = rows; this.tile = tile; this.x = o.x || 0; this.y = o.y || 0;
    this.layers = []; this.defs = []; this.marks = {}; this.objects = {};
    this.sheet = null; this.firstId = 1; this.paint = null; this.color = '#556'; this.prerender = 0; this.smooth = false; this.time = 0;
    this.collide = 0; this.edge = false; this.hit = { cx: 0, cy: 0, id: 0 }; this.dist = -1; this.bodies = []; this._world = null;
    this._d = { w: 0, h: 0, ox: 0, oy: 0 }; this._g = null; this._from = null; this._st = null; this._stamp = 0; this._heap = [];
    this.layer(o.layer || 'main');
  }
  get w(){ return this.cols * this.tile; }
  get h(){ return this.rows * this.tile; }
  get bounds(){ return { x0: this.x, y0: this.y, x1: this.x + this.w, y1: this.y + this.h }; }
  cx(x){ return Math.floor((x - this.x) / this.tile); }
  cy(y){ return Math.floor((y - this.y) / this.tile); }
  layer(name){
    let L = this.layers.find(l => l.name === name);
    if (!L) this.layers.push(L = { name, data: new Uint16Array(this.cols * this.rows), visible: true, alpha: 1, chunks: new Map() });
    return L;
  }
  _L(l){
    if (l === undefined) return this.layers[0];
    const L = typeof l === 'number' ? this.layers[l] : typeof l === 'string' ? this.layers.find(a => a.name === l) : l;
    if (!L) throw new Error(`Tilemap: unknown layer "${l}"`);
    return L;
  }
  get(cx, cy, l){ return cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows ? 0 : this._L(l).data[cy * this.cols + cx]; }
  at(x, y, l){ return this.get(this.cx(x), this.cy(y), l); }
  set(cx, cy, id, l){
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return this;
    const L = this._L(l); L.data[cy * this.cols + cx] = id;
    const ch = L.chunks.get((cy >> 4) * 4096 + (cx >> 4)); if (ch) ch.dirty = true;
    return this;
  }
  fill(cx, cy, w, h, id, l){ for (let j = cy; j < cy + h; j++) for (let i = cx; i < cx + w; i++) this.set(i, j, id, l); return this; }
  def(id, props){ if (props === undefined) return this.defs[id]; this.defs[id] = props; return this; }
  solid(id){ if (!id) return false; const d = this.defs[id]; return d ? d.solid !== undefined ? !!d.solid : !d.oneWay : true; }
  blocked(x, y){ return this._solid(this._L(this.collide).data, this.cx(x), this.cy(y)); }
  _solid(D, cx, cy){ return cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows ? this.edge : this.solid(D[cy * this.cols + cx]); }
  _one(D, cx, cy){ if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return false; const d = this.defs[D[cy * this.cols + cx]]; return !!d && !!d.oneWay; }
  update(dt){ this.time += dt; }
  redraw(){ for (const L of this.layers) L.chunks.clear(); return this; }

  // ---- drawing
  draw(c, view = null, l){
    if (l === undefined) { for (const L of this.layers) if (L.visible) this._draw(c, view, L); }
    else this._draw(c, view, this._L(l));
  }
  _draw(c, v, L){
    const T = this.tile, cols = this.cols; let c0 = 0, r0 = 0, c1 = cols - 1, r1 = this.rows - 1;
    if (v) { c0 = Math.max(c0, this.cx(v.x0)); r0 = Math.max(r0, this.cy(v.y0)); c1 = Math.min(c1, this.cx(v.x1)); r1 = Math.min(r1, this.cy(v.y1)); }
    if (c0 > c1 || r0 > r1) return;
    const pa = c.globalAlpha; if (L.alpha !== 1) c.globalAlpha = pa * L.alpha;
    if (this.prerender > 0) {
      const S = 16 * T;
      for (let j = r0 >> 4; j <= r1 >> 4; j++) for (let i = c0 >> 4; i <= c1 >> 4; i++) { const ch = this._chunk(L, i, j); if (ch.any) c.drawImage(ch.cv, this.x + i * S, this.y + j * S, S, S); }
    } else for (let j = r0; j <= r1; j++) for (let i = c0; i <= c1; i++) { const id = L.data[j * cols + i]; if (id) this.drawTile(c, id, this.x + i * T, this.y + j * T, T, i, j); }
    if (L.alpha !== 1) c.globalAlpha = pa;
  }
  drawTile(c, id, x, y, T, cx, cy){
    const d = this.defs[id];
    if (d && d.draw) d.draw(c, x, y, T, cx, cy, id);
    else if (this.paint) this.paint(c, id, x, y, T, cx, cy);
    else if (this.sheet && !(d && d.color)) {
      const o = this._d; o.w = o.h = T;
      this.sheet.draw(c, d && d.frames ? d.frames[Math.floor(this.time * (d.fps || 8)) % d.frames.length] : d && d.frame !== undefined ? d.frame : id - this.firstId, x, y, o);
    } else { c.fillStyle = (d && d.color) || this.color; c.fillRect(x, y, T, T); }
  }
  // A 16 x 16 block of one layer as a picture, redrawn only when a tile in it has changed.
  _chunk(L, i, j){
    const px = this.prerender, key = j * 4096 + i, T = this.tile; let ch = L.chunks.get(key);
    if (ch && !ch.dirty && ch.px === px) return ch;
    if (!ch) L.chunks.set(key, ch = { cv: document.createElement('canvas'), dirty: true, px: 0, any: false });
    ch.cv.width = ch.cv.height = 16 * px;   // also wipes it
    const g = ch.cv.getContext('2d'), k = px / T; g.imageSmoothingEnabled = this.smooth;
    g.setTransform(k, 0, 0, k, -(this.x + i * 16 * T) * k, -(this.y + j * 16 * T) * k);
    ch.any = false; ch.dirty = false; ch.px = px;
    for (let r = j * 16, r1 = Math.min(this.rows, r + 16); r < r1; r++) for (let q = i * 16, q1 = Math.min(this.cols, q + 16); q < q1; q++) {
      const id = L.data[r * this.cols + q]; if (id) { ch.any = true; this.drawTile(g, id, this.x + q * T, this.y + r * T, T, q, r); }
    }
    return ch;
  }

  // ---- colliding
  // Each axis in turn, checking every column or row the leading edge crosses, so no speed skips a wall.
  move(o, dx, dy, through = false){
    const T = this.tile, X = this.x, Y = this.y, D = this._L(this.collide).data, r = o.r, w = r ? r * 2 : o.w, h = r ? r * 2 : o.h, e = 1e-9;
    let x = r ? o.x - r : o.x, y = r ? o.y - r : o.y, hit = 0;
    if (dx) {
      const r0 = Math.floor((y - Y) / T + e), r1 = Math.ceil((y + h - Y) / T - e) - 1; let nx = x + dx;
      if (dx > 0) {
        scan: for (let c = Math.ceil((x + w - X) / T - e), c1 = Math.ceil((nx + w - X) / T - e) - 1; c <= c1; c++)
          for (let j = r0; j <= r1; j++) if (this._solid(D, c, j)) { nx = X + c * T - w; hit |= 2; break scan; }
      } else {
        scan: for (let c = Math.floor((x - X) / T + e) - 1, c1 = Math.floor((nx - X) / T + e); c >= c1; c--)
          for (let j = r0; j <= r1; j++) if (this._solid(D, c, j)) { nx = X + (c + 1) * T; hit |= 1; break scan; }
      }
      x = nx;
    }
    if (dy) {
      const c0 = Math.floor((x - X) / T + e), c1 = Math.ceil((x + w - X) / T - e) - 1; let ny = y + dy;
      if (dy > 0) {
        scan: for (let j = Math.ceil((y + h - Y) / T - e), j1 = Math.ceil((ny + h - Y) / T - e) - 1; j <= j1; j++)
          for (let c = c0; c <= c1; c++) if (this._solid(D, c, j) || (!through && this._one(D, c, j))) { ny = Y + j * T - h; hit |= 8; break scan; }
      } else {
        scan: for (let j = Math.floor((y - Y) / T + e) - 1, j1 = Math.floor((ny - Y) / T + e); j >= j1; j--)
          for (let c = c0; c <= c1; c++) if (this._solid(D, c, j)) { ny = Y + (j + 1) * T; hit |= 4; break scan; }
      }
      y = ny;
    }
    o.x = r ? x + r : x; o.y = r ? y + r : y;
    return hit;
  }

  // ---- Physics
  addTo(world, opts = null){
    this.removeFrom(); this._world = world;
    const T = this.tile, cols = this.cols, D = this._L(this.collide).data, out = this.bodies;
    const make = (id, b) => { const d = this.defs[id]; out.push(world.add(Object.assign(b, { fixed: true, tile: id }, opts, d && d.body))); return b; };
    // 1 = a plain block, 2 = one-way, 3 = a polygon, 0 = nothing to hit
    const kind = id => { if (!id) return 0; const d = this.defs[id]; return !d ? 1 : d.pts ? 3 : d.oneWay ? 2 : d.solid === false ? 0 : 1; };
    const loose = id => { const d = this.defs[id]; return !(d && d.body); }, same = (a, b) => a === b || (loose(a) && loose(b));   // tiles with a body of their own only join their own kind
    let open = new Map();   // the boxes that ended on the row above, by the columns they span: a run that matches one grows it
    for (let j = 0; j < this.rows; j++) {
      const next = new Map(), y = this.y + j * T;
      for (let i = 0; i < cols; i++) {
        const id = D[j * cols + i], k = kind(id); if (!k) continue;
        const x = this.x + i * T, d = this.defs[id];
        if (k === 3) { make(id, { x, y, pts: d.pts.map(v => v * T) }); continue; }
        let e = i; while (e + 1 < cols && kind(D[j * cols + e + 1]) === k && (k === 1 ? same(id, D[j * cols + e + 1]) : D[j * cols + e + 1] === id)) e++;
        const w = (e - i + 1) * T;
        if (k === 2) make(id, { x, y, w, h: (d.h ?? 1) * T, oneWay: true });
        else { const key = i * 65536 + e; let up = open.get(key); if (up && same(up.tile, id)) up.h += T; else up = make(id, { x, y, w, h: T }); next.set(key, up); }
        i = e;
      }
      open = next;
    }
    return out;
  }
  removeFrom(){ if (this._world) for (const b of this.bodies) this._world.remove(b); this.bodies.length = 0; this._world = null; return this; }

  // ---- rays and paths
  raycast(ox, oy, dx, dy, max = Infinity){
    const T = this.tile, X = this.x, Y = this.y, D = this._L(this.collide).data, H = this.hit; let t0 = 0, en = 0;
    const end = (t, cx, cy, nx, ny) => { H.cx = cx; H.cy = cy; H.id = this.get(cx, cy, this.collide); Collide.nx = nx; Collide.ny = ny; return this.dist = t; };
    this.dist = -1;
    if (ox < X || oy < Y || ox >= X + this.w || oy >= Y + this.h) {   // from outside: skip to where it enters the map
      if (this.edge) return end(0, this.cx(ox), this.cy(oy), -dx, -dy);
      let a = 0, b = max;
      if (dx) { const p = (X - ox) / dx, q = (X + this.w - ox) / dx, lo = Math.min(p, q); if (lo > a) { a = lo; en = 1; } b = Math.min(b, Math.max(p, q)); } else if (ox < X || ox >= X + this.w) return -1;
      if (dy) { const p = (Y - oy) / dy, q = (Y + this.h - oy) / dy, lo = Math.min(p, q); if (lo > a) { a = lo; en = 2; } b = Math.min(b, Math.max(p, q)); } else if (oy < Y || oy >= Y + this.h) return -1;
      if (a > b) return -1;
      t0 = a;
    }
    const px = ox + dx * t0, py = oy + dy * t0, sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    let cx = clamp(Math.floor((px - X) / T + (t0 ? sx * 1e-7 : 0)), 0, this.cols - 1), cy = clamp(Math.floor((py - Y) / T + (t0 ? sy * 1e-7 : 0)), 0, this.rows - 1);
    if (this._solid(D, cx, cy)) return en === 1 ? end(t0, cx, cy, -sx, 0) : en === 2 ? end(t0, cx, cy, 0, -sy) : end(t0, cx, cy, -dx, -dy);   // starts in a wall, or meets one on the map's rim
    const ax = dx ? T / Math.abs(dx) : Infinity, ay = dy ? T / Math.abs(dy) : Infinity;
    let tx = dx ? (X + (cx + (dx > 0 ? 1 : 0)) * T - px) / dx : Infinity, ty = dy ? (Y + (cy + (dy > 0 ? 1 : 0)) * T - py) / dy : Infinity;
    for (;;) {
      let t, nx = 0, ny = 0;
      if (tx < ty) { t = tx; tx += ax; cx += sx; nx = -sx; } else { t = ty; ty += ay; cy += sy; ny = -sy; }
      if (!(t0 + t <= max)) return -1;
      const outside = cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows;
      if (outside ? this.edge : this.solid(D[cy * this.cols + cx])) return end(t0 + t, cx, cy, nx, ny);
      if (outside) return -1;
    }
  }
  sees(ax, ay, bx, by){ const d = Math.hypot(bx - ax, by - ay); return !d || this.raycast(ax, ay, (bx - ax) / d, (by - ay) / d, d) < 0; }
  path(ax, ay, bx, by, o = {}){
    const cols = this.cols, rows = this.rows, n = cols * rows, D = this._L(this.collide).data, T = this.tile;
    const sx = this.cx(ax), sy = this.cy(ay), gx = this.cx(bx), gy = this.cy(by);
    if (sx < 0 || sy < 0 || sx >= cols || sy >= rows || gx < 0 || gy < 0 || gx >= cols || gy >= rows) return null;
    const cost = o.cost || null, diag = o.diagonal !== false, max = o.max ?? 5000, goal = gy * cols + gx, start = sy * cols + sx;
    // What it costs to step onto a tile: 0 = can't.
    const price = i => { const id = D[i]; if (this.solid(id)) return 0; if (!cost) return 1; const k = cost(id, i % cols, (i / cols) | 0); return k > 0 && k < Infinity ? k : 0; };
    if (start === goal) return [];
    if (!price(goal)) return null;
    if (!this._g || this._g.length !== n) { this._g = new Float32Array(n); this._from = new Int32Array(n); this._st = new Uint32Array(n); this._stamp = 0; }
    const G = this._g, F = this._from, S = this._st, heap = this._heap, open = (this._stamp += 2), shut = open + 1;   // S[i]: open = seen, shut = done
    // A binary heap of [f, cell] pairs kept flat.
    heap.length = 0;
    const push = (f, i) => { let k = heap.length; heap.push(f, i); while (k > 0) { const p = ((k / 2 - 1) >> 1) * 2; if (heap[p] <= f) break; heap[k] = heap[p]; heap[k + 1] = heap[p + 1]; k = p; } heap[k] = f; heap[k + 1] = i; };
    const pop = () => {
      const top = heap[1], f = heap[heap.length - 2], i = heap[heap.length - 1]; heap.length -= 2; const len = heap.length; if (!len) return top;
      let k = 0; for (;;) { let c = k * 2 + 2; if (c >= len) break; if (c + 2 < len && heap[c + 2] < heap[c]) c += 2; if (heap[c] >= f) break; heap[k] = heap[c]; heap[k + 1] = heap[c + 1]; k = c; }
      heap[k] = f; heap[k + 1] = i; return top;
    };
    const est = i => { const ex = Math.abs(i % cols - gx), ey = Math.abs(((i / cols) | 0) - gy); return diag ? Math.max(ex, ey) + 0.41421356 * Math.min(ex, ey) : ex + ey; };
    G[start] = 0; S[start] = open; F[start] = -1; push(est(start), start);
    let looked = 0;
    while (heap.length) {
      const i = pop(); if (S[i] === shut) continue;
      if (i === goal) {
        const out = []; for (let k = goal; k !== start; k = F[k]) out.push({ x: this.x + (k % cols + 0.5) * T, y: this.y + (((k / cols) | 0) + 0.5) * T });
        return out.reverse();
      }
      S[i] = shut; if (++looked > max) return null;
      const x = i % cols, y = (i / cols) | 0;
      for (let d = 0; d < (diag ? 8 : 4); d++) {
        const ox = Tilemap._DX[d], oy = Tilemap._DY[d], qx = x + ox, qy = y + oy; if (qx < 0 || qy < 0 || qx >= cols || qy >= rows) continue;
        const q = qy * cols + qx; if (S[q] === shut) continue;
        const p = price(q); if (!p) continue;
        if (d > 3 && (!price(y * cols + qx) || !price(qy * cols + x))) continue;   // no squeezing between two corners
        const g = G[i] + p * (d > 3 ? 1.41421356 : 1);
        if (S[q] !== open || g < G[q]) { G[q] = g; F[q] = i; S[q] = open; push(g + est(q), q); }
      }
    }
    return null;
  }

  // ---- making one
  static from(lines, tile = 32, legend = {}, o = {}){
    const cols = Math.max(0, ...lines.map(s => s.length)), m = new Tilemap(cols, lines.length, tile, o);
    lines.forEach((row, j) => { for (let i = 0; i < row.length; i++) {
      const ch = row[i], id = legend[ch];
      if (id !== undefined) m.set(i, j, id);
      else if (ch !== '.' && ch !== ' ') (m.marks[ch] || (m.marks[ch] = [])).push({ x: m.x + (i + 0.5) * tile, y: m.y + (j + 0.5) * tile, cx: i, cy: j });
    } });
    return m;
  }
  // A map exported from Tiled as JSON (orthogonal, layer data as CSV or uncompressed base64). o: { tile, x, y, collide: 'layer name' }.
  // Tile layers keep their names, visibility and opacity; object layers land in map.objects[name]; custom tile properties
  // (solid, oneWay...) and tile animations become defs. Flipped and rotated tiles are drawn unflipped.
  static tiled(j, o = {}){
    if (j.infinite) throw new Error('Tilemap: infinite Tiled maps are not supported (untick "Infinite" in the map properties)');
    if (j.orientation && j.orientation !== 'orthogonal') throw new Error(`Tilemap: only orthogonal maps are supported, not "${j.orientation}"`);
    const m = new Tilemap(j.width, j.height, o.tile || j.tilewidth, o), k = m.tile / j.tilewidth; m.layers.length = 0;
    const walk = list => { for (const L of list || []) {
      if (L.type === 'group') walk(L.layers);
      else if (L.type === 'tilelayer') {
        let data = L.data;
        if (typeof data === 'string') {
          if (L.compression) throw new Error(`Tilemap: layer "${L.name}" is compressed (${L.compression}); set the Tile Layer Format to CSV in Tiled`);
          const bin = atob(data); data = new Array(bin.length >> 2);
          for (let i = 0; i < data.length; i++) data[i] = (bin.charCodeAt(i * 4) | bin.charCodeAt(i * 4 + 1) << 8 | bin.charCodeAt(i * 4 + 2) << 16 | bin.charCodeAt(i * 4 + 3) << 24) >>> 0;
        }
        const l = m.layer(L.name); l.visible = L.visible !== false; l.alpha = L.opacity ?? 1;
        for (let i = 0; i < l.data.length; i++) l.data[i] = (data[i] || 0) & 0x0fffffff;   // the top bits are Tiled's flip flags
      } else if (L.type === 'objectgroup') m.objects[L.name] = (L.objects || []).map(ob => ({ ...ob, x: m.x + ob.x * k, y: m.y + ob.y * k, width: (ob.width || 0) * k, height: (ob.height || 0) * k }));
    } };
    walk(j.layers);
    if (!m.layers.length) m.layer('main');
    const sets = j.tilesets || []; if (sets.length) m.firstId = sets[0].firstgid || 1;
    for (const ts of sets) for (const t of ts.tiles || []) {
      const d = {}; let any = false;
      for (const p of t.properties || []) { d[p.name] = p.value; any = true; }
      if (t.animation && t.animation.length) { d.frames = t.animation.map(a => a.tileid + ts.firstgid - m.firstId); d.fps = 1000 / (t.animation[0].duration || 100); any = true; }
      if (any) m.def(ts.firstgid + t.id, d);
    }
    if (o.collide !== undefined) m.collide = o.collide;
    return m;
  }
}
Tilemap._DX = [1, -1, 0, 0, 1, 1, -1, -1]; Tilemap._DY = [0, 0, 1, -1, 1, -1, 1, -1];
