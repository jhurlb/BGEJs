'use strict';
/* ================================================================
   GAME LOOP. One requestAnimationFrame loop with a clock you can scale, pause and freeze.
     Loop.start({ update(dt), render(dt, alpha), step: 1/60 });   // step: null = variable dt (capped at maxDt)
     Loop.timeScale = 0.3;      // slow motion
     Loop.hitstop(0.08);        // freeze the simulation (not rendering) for a moment
     Loop.paused = true;        // render keeps running, update stops
   With a fixed step, update(dt) runs zero or more times per frame at exactly `step`, and render gets
   alpha (0..1) for interpolating between the last two updates. Loop.time is simulated seconds,
   Loop.realTime is wall seconds since start. Loop.fps is a smoothed frame rate. Loop.updates is how many times
   update ran in the current frame.
   While the tab is hidden the browser stops animation frames; set keepAliveHidden to keep updating on a timer
   (a network host needs this).

   autoInput: true lets the loop look after engine/input.js, so you never call Input.pollPad() or Input.endFrame():
   the gamepad is read once per frame and "pressed this frame" (Input.hit, pressed, padHit, wheel) is cleared after
   each update. A press is then seen by exactly one update, even with a fixed step on a fast display (where some
   frames run no update, and clearing in render would lose the press) or during a hitstop (the press waits for the
   next update). While Loop.paused the presses are cleared after render instead, so a pause menu driven from render
   still sees each press once.
   ================================================================ */
const Loop = {
  update: null, render: null, step: null, maxDt: 1 / 30, maxSteps: 8,
  timeScale: 1, paused: false, keepAliveHidden: false, autoInput: false,
  time: 0, realTime: 0, frame: 0, fps: 60, running: false, updates: 0,
  _acc: 0, _last: 0, _stop: 0, _raf: 0, _timer: 0,
  start(opts = {}){
    Object.assign(this, opts);
    if (this.running) return;
    this.running = true; this._last = performance.now();
    const tick = ts => { if (!this.running) return; this._raf = requestAnimationFrame(tick); this._tick(ts); };
    this._raf = requestAnimationFrame(tick);
    this._timer = setInterval(() => {   // hidden tab: no animation frames
      if (!document.hidden || !this.keepAliveHidden || !this.running) return;
      this._tick(performance.now(), true);
    }, 200);
  },
  stop(){ this.running = false; cancelAnimationFrame(this._raf); clearInterval(this._timer); },
  hitstop(sec){ this._stop = Math.max(this._stop, sec); },
  get frozen(){ return this._stop > 0; },
  _tick(ts, hidden = false){
    const raw = Math.max(0, (ts - this._last) / 1000); this._last = ts;
    this.realTime += raw; this.frame++; this.updates = 0;
    if (raw > 0) this.fps += (1 / raw - this.fps) * 0.05;
    const auto = this.autoInput && typeof Input !== 'undefined';
    if (auto) Input.pollPad(true);
    let dt = hidden ? Math.min(raw, 1.5) : Math.min(raw, this.maxDt);
    if (!this.paused && this.update) {
      if (this._stop > 0) { const s = Math.min(this._stop, dt); this._stop -= s; dt -= s; }   // only the frozen part of the frame is lost
      dt *= this.timeScale;
      if (dt > 0) {
        if (this.step) {
          this._acc += dt; const max = hidden ? 1e4 : this.maxSteps;
          while (this._acc >= this.step && this.updates < max) { this._acc -= this.step; this._step(this.step, auto); }
          if (this._acc >= this.step) this._acc = 0;   // spiral of death guard: drop time the machine can't keep up with
        } else {
          // variable step, split so no single update is longer than maxDt (keeps physics stable in slow tabs and fast-forward)
          const n = Math.ceil(dt / this.maxDt - 1e-9);
          for (let i = 0; i < n; i++) this._step(dt / n, auto);
        }
      }
    }
    if (!hidden && this.render) this.render(raw, this.step ? this._acc / this.step : 1);
    if (auto && (this.paused || !this.update)) Input.endFrame(true);
  },
  _step(dt, auto){ this.update(dt); this.time += dt; this.updates++; if (auto) Input.endFrame(true); },
};
