'use strict';
/* ================================================================
   CARTOON LOOK: two optional post effects for a hand-inked, old-film style.
   Ink: while inkOn is set, every solid fill on any canvas also gets an ink outline (INK colour, inkW wide).
   See-through fills (alpha under 0.85), gradients and patterns are skipped. Set inkOn = 1 around what should
   be inked and back to 0 after (HUD, glows). This patches CanvasRenderingContext2D.fill / fillRect once at load.
   Film: filmFx() draws grain, flicker, dust, scratches and a vignette over the whole canvas in screen space;
   tune it through FILM (vignette colour and strength, grain, scratch and dust odds).
   ================================================================ */
const INK = '#1c120a';
let inkOn = 0, inkW = 2.2;
(function(){
  const P = CanvasRenderingContext2D.prototype, f0 = P.fill, fr0 = P.fillRect;
  const solid = c => {
    if (c.globalAlpha < 0.85) return false;
    const s = c.fillStyle; if (typeof s !== 'string') return false;
    if (s.charCodeAt(0) === 114) { const a = parseFloat(s.slice(s.lastIndexOf(',') + 1)); return !(a < 0.85); }   // 'rgba(...)'
    return s !== INK;
  };
  const ink = (c, fn) => {   // swap only the stroke settings in and out (cheaper than save/restore, which runs thousands of times a frame)
    const ss = c.strokeStyle, lw = c.lineWidth, lj = c.lineJoin, sb = c.shadowBlur, ld = c.getLineDash();
    c.strokeStyle = INK; c.lineWidth = inkW; c.lineJoin = 'round'; if (ld.length) c.setLineDash([]); if (sb) c.shadowBlur = 0;
    fn();
    c.strokeStyle = ss; c.lineWidth = lw; c.lineJoin = lj; if (ld.length) c.setLineDash(ld); if (sb) c.shadowBlur = sb;
  };
  P.fill = function(a, b){
    if (a === undefined) f0.call(this); else if (b === undefined) f0.call(this, a); else f0.call(this, a, b);
    if (inkOn && solid(this)) ink(this, () => a instanceof Path2D ? this.stroke(a) : this.stroke());
  };
  P.fillRect = function(x, y, w, h){
    fr0.call(this, x, y, w, h);
    if (inkOn && Math.abs(w) > 3 && Math.abs(h) > 3 && solid(this)) ink(this, () => this.strokeRect(x, y, w, h));
  };
})();
// Film overlay in screen space: grain, flicker, dust, scratches and a vignette.
const FILM = { grain: [], vig: null, vw: 0, vh: 0, n: 0, scratch: [], vigColor: '40,22,8', vigAlpha: 0.55, flicker: 0.25, scratchOdds: 0.04, dustOdds: 0.3 };
function filmFx(){
  const c = ctx, W = cv.width, H = cv.height;
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (!FILM.grain.length) for (let g = 0; g < 4; g++) {
    const n = document.createElement('canvas'); n.width = n.height = 160; const x = n.getContext('2d'), d = x.createImageData(160, 160);
    for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255 | 0; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = Math.random() < 0.5 ? 26 : 0; }
    x.putImageData(d, 0, 0); FILM.grain.push(c.createPattern(n, 'repeat'));
  }
  if (FILM.vw !== W || FILM.vh !== H) {
    FILM.vw = W; FILM.vh = H; const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    g.addColorStop(0, `rgba(${FILM.vigColor},0)`); g.addColorStop(1, `rgba(${FILM.vigColor},${FILM.vigAlpha})`);
    const v = document.createElement('canvas'); v.width = W; v.height = H; const vc = v.getContext('2d'); vc.fillStyle = g; vc.fillRect(0, 0, W, H); FILM.vig = v;   // drawn once per size, then blitted
  }
  FILM.n++;
  const q = (FILM.n >> 1) % 4;   // grain changes every other frame, like film at 30fps
  const gp = FILM.grain[q]; if (gp.setTransform) gp.setTransform(new DOMMatrix([1, 0, 0, 1, (Math.random() * 160) | 0, (Math.random() * 160) | 0])); c.fillStyle = gp; c.fillRect(0, 0, W, H);
  c.drawImage(FILM.vig, 0, 0);
  if (Math.random() < FILM.flicker) { c.fillStyle = `rgba(255,236,200,${Math.random() * 0.035})`; c.fillRect(0, 0, W, H); }   // projector flicker
  if (Math.random() < FILM.scratchOdds) FILM.scratch.push({ x: Math.random() * W, life: 6 + Math.random() * 14 | 0, w: Math.random() < 0.5 ? 1 : 2 });
  c.fillStyle = 'rgba(30,18,8,.35)';
  for (const sc of FILM.scratch) { sc.x += (Math.random() - 0.5) * 6; c.fillRect(sc.x, 0, sc.w * dpr, H); sc.life--; }
  FILM.scratch = FILM.scratch.filter(sc => sc.life > 0);
  if (Math.random() < FILM.dustOdds) { c.fillStyle = 'rgba(25,15,6,.5)'; for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(Math.random() * W, Math.random() * H, (0.8 + Math.random() * 2.2) * dpr, 0, TAU); c.fill(); } }
}
