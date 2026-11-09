'use strict';
/* ================================================================
   PROFILER: how long each system and phase takes, and an on-screen overlay.
     Profiler.on = true;                         // runSystems() then times every system automatically
     Profiler.begin('render'); ...; Profiler.end('render');   // time anything else
     Profiler.count('particles', fx.count);      // any number you want on the overlay
     Profiler.frame();                           // once per frame, after rendering
     Profiler.draw(ctx);                         // the overlay (top-left, CSS-pixel space); Profiler.report() -> rows
   Times are smoothed averages in milliseconds. Turning it off costs nothing.
   ================================================================ */
const Profiler = {
  on: false, t: new Map(), open: new Map(), counts: new Map(), frameMs: 0, _last: 0, fps: 0,
  begin(name){ if (this.on) this.open.set(name, performance.now()); },
  end(name){
    if (!this.on) return; const s = this.open.get(name); if (s === undefined) return;
    const d = performance.now() - s, o = this.t.get(name); this.t.set(name, o === undefined ? d : o + (d - o) * 0.1);
  },
  count(name, n){ if (this.on) this.counts.set(name, n); },
  frame(){
    const now = performance.now();
    if (this._last) { const d = now - this._last; this.frameMs += (d - this.frameMs) * 0.1; this.fps = this.frameMs ? 1000 / this.frameMs : 0; }
    this._last = now;
  },
  report(){ return [...this.t.entries()].sort((a, b) => b[1] - a[1]).map(([name, ms]) => ({ name, ms })); },
  draw(c, top = 8){
    if (!this.on) return;
    c.save(); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rows = [`${this.fps.toFixed(0)} fps  ${this.frameMs.toFixed(1)} ms`, ...[...this.counts].map(([k, v]) => `${k}: ${v}`), ...this.report().slice(0, 14).map(r => `${r.ms.toFixed(2).padStart(6)}  ${r.name}`)];
    c.font = '11px monospace'; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillStyle = 'rgba(0,0,0,.65)'; c.fillRect(8, top, 230, rows.length * 14 + 8);
    c.fillStyle = '#d7f7d0'; rows.forEach((r, i) => c.fillText(r, 14, top + 4 + i * 14));
    c.restore();
  },
};
