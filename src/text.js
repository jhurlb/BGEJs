'use strict';
/* ================================================================
   TEXT on the canvas: sizes, outlines and shadows, wrapping, alignment, coloured words, typewriter reveal, bitmap
   fonts and floating numbers. It is `Txt` because `Text` already means something else to the browser.
     Txt.draw(ctx, 'Score 120', x, y, { size: 24, color: '#fff', outline: '#000' });
   Sizes are in whatever units the context is in: world units after cam.apply(ctx), CSS pixels after cam.applyScreen(ctx).
   Options (all optional):
     size: 16, font: 'system-ui, sans-serif' (Txt.font), weight: 400, italic: false
     color: '#fff', alpha: 1
     align: 'left' | 'center' | 'right'       where x is on each line
     valign: 'top' | 'middle' | 'bottom'      where y is on the whole block
     width: 300                               wrap at this width; '\n' always starts a new line
     lineHeight: 1.25                         x size
     outline: '#000', outlineWidth: size * 0.18
     shadow: '#000', shadowX, shadowY         a copy behind, offset by size * 0.08 unless given
     angle, scale                             turned and scaled about (x, y)
     reveal: 12                               only the first 12 characters (a typewriter: reveal: seconds * 30). Words keep
                                              their places as they appear; Txt.measure(...).chars is how many there are
     rich: true                               colour tags in the string: 'Take the {#fd5}gold key{/} to the {door}door{/}'.
                                              {#rgb} or {any css colour} starts a colour, or a name set in Txt.colors;
                                              {/} goes back. '{{' is a plain '{'
   A style can be named and reused; a draw can add to it:
     Txt.style('title', { size: 48, weight: 800, outline: '#000', align: 'center' });
     Txt.draw(ctx, 'GAME OVER', vw / 2, 80, 'title');   Txt.draw(ctx, 'paused', x, y, { style: 'title', size: 24 });
   Txt.measure(str, opts) gives { w, h, chars, lines } without drawing. Layouts are remembered (the last Txt.max
   different ones), so drawing the same text every frame measures it once. draw() leaves the context's font, textAlign
   ('left'), textBaseline ('middle') and fill style as it used them, and after an outline its stroke style, lineWidth and
   lineJoin too: set your own again before a fillText of your own.

   BITMAP FONTS, for pixel art: glyphs in a grid image, in the order of a string.
     const font = Txt.bitmap(Assets.get('font'), 8, 8, ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ');
     Txt.draw(ctx, 'HELLO', x, y, { font, size: 16, color: '#fd5' });   // size is the glyph height; color tints (leave it out for the image as drawn)
   Txt.bitmap's last argument: { margin, spacing } of the grid, advance: 1 (how far each glyph moves on, in glyph widths),
   widths: { i: 0.5, ... } for narrow letters, upper: true to draw lower case with the capitals. Outlines are not drawn.

   FLOATING TEXT (damage numbers, "+10"): rises, pops and fades by itself.
     Txt.pop('-25', enemy.x, enemy.y, { color: '#f55', size: 18, outline: '#000' });   // also life: 0.8, vx, vy: -60, gravity: 0, grow: 1.4
     Txt.update(dt);                      // in your update
     Txt.drawPops(ctx, cam.view);         // with the world, after cam.apply(ctx). Txt.pops is the list; Txt.clearPops() empties it
   ================================================================ */
const Txt = {
  font: 'system-ui, sans-serif', styles: new Map(), colors: {}, pops: [], max: 400, _lay: new Map(), _none: {}, _fid: 0,
  style(name, o){ this.styles.set(name, o); return this; },
  _opts(o){
    if (!o) return this._none;
    if (typeof o === 'string') { const s = this.styles.get(o); if (!s) throw new Error(`Txt: unknown style "${o}"`); return s; }
    return o.style ? Object.assign({}, this._opts(o.style), o, { style: undefined }) : o;
  },
  measure(s, o, c = ctx){ return this._layout(c, String(s), this._opts(o)); },
  // Lines of runs (a run is a stretch of one colour), each with its place on its line. Worked out once per text and style.
  _layout(c, s, o){
    const f = o.font, bm = f && typeof f === 'object' ? f : null, size = o.size ?? 16;
    const css = bm ? '' : `${o.italic ? 'italic ' : ''}${o.weight ?? 400} ${size}px ${f || this.font}`;
    const key = `${s}\n${bm ? '#' + bm.id + ' ' + size : css}|${o.width || 0}|${o.rich ? 1 : 0}|${o.lineHeight ?? 1.25}`, M = this._lay;
    let L = M.get(key);
    if (L) { M.delete(key); M.set(key, L); return L; }
    if (!bm) c.font = css;
    const meas = t => bm ? bm.measure(t, size) : c.measureText(t).width, max = o.width > 0 ? o.width : Infinity;
    const lines = []; let line = { runs: [], w: 0 }, color = null, chars = 0, wide = 0, soft = false, glued = false, word = null;
    const endLine = () => {
      const R = line.runs;
      while (R.length) { const last = R[R.length - 1]; last.text = last.text.replace(/[^\S\n]+$/, ''); if (!last.text && R.length > 1) R.pop(); else break; }   // no gap at the end, whatever its colour
      let x = 0; for (const r of R) { r.x = x; r.w = meas(r.text); x += r.w; chars += r.text.length; }
      line.w = x; if (x > wide) wide = x; lines.push(line); line = { runs: [], w: 0 };
    };
    const add = (t, col) => { const R = line.runs, last = R[R.length - 1]; if (last && last.color === col) last.text += t; else R.push({ text: t, color: col, x: 0, w: 0 }); };
    const put = (text, col) => {   // words and the gaps between them, wrapping before a word that would not fit
      for (const tok of text.match(/\n|[^\S\n]+|[^\s]+/g) || []) {
        if (tok === '\n') { endLine(); soft = glued = false; continue; }
        const w = meas(tok), gap = tok.trim() === '';
        if (gap && !line.runs.length && soft) continue;   // no gap at the start of a wrapped line
        if (!gap && line.w + w > max && line.runs.length && !(glued && word.w0 === 0)) {   // (a word too long for a line stays whole, on its own line)
          if (glued) {   // the rest of a word whose colour changed part-way: the whole word goes to the next line
            const R = line.runs, r = R[word.ri], moved = R.splice(word.ri + 1), tail = r.text.slice(word.off), carry = line.w - word.w0;
            r.text = r.text.slice(0, word.off); if (tail) moved.unshift({ text: tail, color: r.color, x: 0, w: 0 });
            if (!r.text && R.length > 1) R.pop();
            endLine(); line.runs = moved; line.w = carry;
          } else endLine();
          soft = true; word = { ri: 0, off: 0, w0: 0 };
        }
        if (!gap && !glued) { const R = line.runs, last = R[R.length - 1], join = last && last.color === col; word = { ri: join ? R.length - 1 : R.length, off: join ? last.text.length : 0, w0: line.w }; }
        add(tok, col); line.w += w; glued = !gap;
      }
    };
    if (o.rich) {
      let at = 0; const re = /\{\{|\{([^{}\n]*)\}/g; let m;
      while ((m = re.exec(s))) {
        if (m.index > at) put(s.slice(at, m.index), color);
        if (m[0] === '{{') put('{', color); else color = m[1] === '/' || m[1] === '' ? null : m[1];   // a name is looked up when it is drawn, so changing Txt.colors shows at once
        at = re.lastIndex;
      }
      if (at < s.length) put(s.slice(at), color);
    } else put(s, null);
    endLine();
    const lh = size * (o.lineHeight ?? 1.25);
    L = { lines, w: wide, h: lines.length * lh, lh, chars, css };
    M.set(key, L); if (M.size > this.max) M.delete(M.keys().next().value);
    return L;
  },
  draw(c, s, x, y, o){ o = this._opts(o); return this._draw(c, String(s), x, y, o, o.alpha ?? 1, o.scale ?? 1); },
  _draw(c, s, x, y, o, alpha, sc){
    const L = this._layout(c, s, o), size = o.size ?? 16, f = o.font, bm = f && typeof f === 'object' ? f : null;
    const turned = o.angle || sc !== 1, pa = c.globalAlpha;
    if (turned) { c.save(); c.translate(x, y); if (o.angle) c.rotate(o.angle); if (sc !== 1) c.scale(sc, sc); x = y = 0; }
    if (alpha !== 1) c.globalAlpha = pa * alpha;
    if (!bm) { c.font = L.css; c.textAlign = 'left'; c.textBaseline = 'middle'; }
    const va = o.valign, y0 = y - (va === 'middle' ? L.h / 2 : va === 'bottom' ? L.h : 0) + L.lh / 2;
    const n = o.reveal === undefined ? Infinity : Math.floor(o.reveal);
    if (o.shadow) this._pass(c, L, x + (o.shadowX ?? size * 0.08), y0 + (o.shadowY ?? size * 0.08), o, n, 1, bm, size);
    if (o.outline && !bm) { c.lineJoin = 'round'; c.lineWidth = o.outlineWidth ?? size * 0.18; c.strokeStyle = o.outline; this._pass(c, L, x, y0, o, n, 2, bm, size); }
    this._pass(c, L, x, y0, o, n, 0, bm, size);
    if (turned) c.restore(); else if (alpha !== 1) c.globalAlpha = pa;
    return L;
  },
  // One pass over every run: 0 = the letters, 1 = the shadow, 2 = the outline.
  _pass(c, L, x, y, o, n, mode, bm, size){
    const al = o.align, lines = L.lines;
    for (let i = 0; i < lines.length && n > 0; i++) {
      const ln = lines[i], lx = x - (al === 'center' ? ln.w / 2 : al === 'right' ? ln.w : 0), ly = y + i * L.lh;
      for (const r of ln.runs) {
        if (n <= 0) break;
        const t = n >= r.text.length ? r.text : r.text.slice(0, n); n -= r.text.length;
        const col = mode === 1 ? o.shadow : r.color ? this.colors[r.color] || r.color : o.color;
        if (bm) bm.draw(c, t, lx + r.x, ly, size, col);
        else if (mode === 2) c.strokeText(t, lx + r.x, ly);
        else { c.fillStyle = col || '#fff'; c.fillText(t, lx + r.x, ly); }
      }
    }
  },
  bitmap(img, fw, fh, chars, o = {}){
    const sheet = Sprites.sheet(img, fw, fh, o), map = new Map(), adv = o.advance ?? 1, widths = o.widths || {}, d = { w: 0, h: 0, ox: 0, oy: 0.5 }, tints = new Map();
    [...chars].forEach((ch, i) => map.set(ch, i));
    const wOf = ch => widths[ch] ?? adv, fix = t => o.upper ? t.toUpperCase() : t;
    // The whole image in one colour, made once per colour.
    const tinted = col => {
      let s = tints.get(col); if (s) return s;
      const cnv = document.createElement('canvas'); cnv.width = img.naturalWidth || img.width; cnv.height = img.naturalHeight || img.height;
      const g = cnv.getContext('2d'); g.drawImage(img, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, cnv.width, cnv.height);
      tints.set(col, s = Sprites.sheet(cnv, fw, fh, o)); if (tints.size > 32) tints.delete(tints.keys().next().value);
      return s;
    };
    return { id: ++this._fid, sheet, map, chars,
      measure(t, size){ let w = 0; for (const ch of fix(t)) w += wOf(ch); return w * size * fw / fh; },
      draw(c, t, x, y, size, col){
        const gw = size * fw / fh, sh = col ? tinted(col) : sheet; d.w = gw; d.h = size;
        for (const ch of fix(t)) { const fr = map.get(ch); if (fr !== undefined) sh.draw(c, fr, x, y, d); x += wOf(ch) * gw; }
      } };
  },
  pop(s, x, y, o){
    const st = this._opts(o), p = { s: String(s), x, y, vx: st.vx || 0, vy: st.vy ?? -60, gravity: st.gravity || 0, t: 0, life: st.life ?? 0.8, grow: st.grow ?? 1.4,
      o: Object.assign({ align: 'center', valign: 'middle' }, st) };
    this.pops.push(p); return p;
  },
  update(dt){
    const P = this.pops; let w = 0;
    for (let i = 0; i < P.length; i++) { const p = P[i]; p.t += dt; if (p.t >= p.life) continue; p.vy += p.gravity * dt; p.x += p.vx * dt; p.y += p.vy * dt; P[w++] = p; }
    P.length = w;
  },
  drawPops(c, view = null, m = 60){
    for (const p of this.pops) {
      if (view && (p.x < view.x0 - m || p.x > view.x1 + m || p.y < view.y0 - m || p.y > view.y1 + m)) continue;
      const k = p.t / p.life;   // a quick swell at the start, a fade over the last third
      this._draw(c, p.s, p.x, p.y, p.o, (p.o.alpha ?? 1) * (k < 0.67 ? 1 : (1 - k) * 3), (p.o.scale ?? 1) * (1 + (p.grow - 1) * Math.max(0, 1 - k * 6)));
    }
  },
  clearPops(){ this.pops.length = 0; },
};
