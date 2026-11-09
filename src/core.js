'use strict';
/* ================================================================
   ENGINE CORE: the canvas, the view size and small math helpers.
   The engine is a set of plain <script> files that share one global scope (no build step, works from file://).
   Load every engine/ file before any game file; engine files never read a game's state.

   It draws on <canvas id="game"> (made and added to the page if there isn't one). Globals set here:
     cv, ctx        the canvas and its 2D context
     dpr            device pixels per CSS pixel (capped at VIEW.maxDpr)
     vw, vh         the window size in CSS pixels
     scale          world units -> CSS pixels for the default camera: min(vw, vh) / VIEW.ref, clamped
   Change VIEW and call resize() to tune the default zoom for another game.
   ================================================================ */
const cv = document.getElementById('game') || document.body.appendChild(Object.assign(document.createElement('canvas'), { id: 'game' }));
const ctx = cv.getContext('2d');
const VIEW = { ref: 760, minScale: 0.55, maxScale: 1.1, maxDpr: 2 };
let dpr = 1, vw = 0, vh = 0, scale = 1;
function resize(){
  dpr = Math.min(VIEW.maxDpr, window.devicePixelRatio || 1);
  vw = innerWidth; vh = innerHeight;
  cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
  scale = Math.min(VIEW.maxScale, Math.max(VIEW.minScale, Math.min(vw, vh) / VIEW.ref));
}
addEventListener('resize', resize);

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const invLerp = (a, b, v) => a === b ? 0 : (v - a) / (b - a);
const remap = (v, a0, a1, b0, b1) => lerp(b0, b1, invLerp(a0, a1, v));
// Frame-rate independent smoothing: move a fraction of the way to b, where `rate` is the fraction left after 1 s.
const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.pow(rate, dt));
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
const fmtTime = s => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const $ = id => document.getElementById(id);
const escapeHtml = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
resize();
