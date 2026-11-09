'use strict';
/* ================================================================
   INPUT: keyboard, mouse / touch pointer, an on-screen touch stick, gamepads, and named actions over all of them.
     keys.has('a')                       // raw key state (lower-case KeyboardEvent.key); `keys` is Input.keys
     Input.pressed('a')                  // went down since the last Input.endFrame()
     Input.pointer                       // { x, y, down, button, hasMouse, type } in CSS pixels; Input.mouseDown(button)
     Input.wheel                         // wheel movement since the last Input.endFrame() (positive = down / away)
     Input.stick                         // touch drag stick { on, ox, oy, x, y }; Input.stickVec(radius) -> { x, y }
     Input.pollPad()                     // call once per frame; Input.pad is { on, lx, ly, rx, ry, dx, dy, id }, Input.padDown(i) / padHit(i)
     Input.bind('jump', ['key: ', 'pad:0', 'mouse:0']);   Input.down('jump');  Input.hit('jump');
     Input.move({ up: 'up', down: 'down', left: 'left', right: 'right' })   // -> { x, y }, length <= 1, includes the left stick and the touch stick
     Input.endFrame()                    // at the end of every frame (clears the "pressed this frame" sets)
   Loop.start({ autoInput: true }) calls pollPad() and endFrame() for you at the right moments; prefer it, and
   always use it with a fixed step (see engine/loop.js).
   Pad button numbers follow the standard mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 8 Back, 9 Start, 12-15 d-pad up/down/left/right.
   Both sticks have a round dead zone of Input.padDead, so a diagonal is as easy to hold as a straight line.
   Input.stickOn(canvas, allow) starts the touch stick on pointerdown when allow(event) is true.
   Typing in a text field is ignored by keys; Input.ignore(e) can widen that rule.
   Input.block(['key: ', 'key:arrowup']) stops those keys doing their browser job (scrolling the page) while the game has them.
   ================================================================ */
const Input = {
  keys: new Set(), _hitKeys: new Set(), _codes: new Map(), _blocked: new Set(),
  pointer: { x: 0, y: 0, down: false, button: 0, hasMouse: false, type: '' }, _hitMouse: new Set(), _ptrs: new Map(), wheel: 0,
  stick: { on: false, id: null, ox: 0, oy: 0, x: 0, y: 0 },
  pad: { on: false, id: '', lx: 0, ly: 0, rx: 0, ry: 0, dx: 0, dy: 0 }, padDead: 0.22, _pb: [], _pp: [], _hitPad: new Set(),
  actions: new Map(),
  ignore(e){ const t = e.target; return !!t && (t.isContentEditable === true || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox' && t.type !== 'radio' && t.type !== 'button')); },
  pressed(k){ return this._hitKeys.has(k); },
  // pad: also forget gamepad presses (the loop passes true; a pollPad() of your own already does this).
  endFrame(pad = false){ this._hitKeys.clear(); this._hitMouse.clear(); this.wheel = 0; if (pad) this._hitPad.clear(); },
  block(sources){ for (const s of sources) this._blocked.add(s.startsWith('key:') ? s.slice(4) : s); },
  mouseDown(button = 0){ for (const b of this._ptrs.values()) if (b === button) return true; return false; },   // any pointer: a touch counts as button 0
  releaseAll(){ this.keys.clear(); this._codes.clear(); this._ptrs.clear(); this.stick.on = false; this.pointer.down = false; },
  // ---- gamepad
  deadzone(v){ const d = this.padDead; return Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d); },
  // keep: add this poll's new presses to the ones not yet cleared by endFrame(true), instead of replacing them.
  pollPad(keep = false){
    const gp = [...(navigator.getGamepads?.() || [])].find(g => g && g.connected), P = this.pad;
    this._pp = this._pb;
    if (!keep) this._hitPad.clear();
    if (!gp) { P.on = false; this._pb = []; P.lx = P.ly = P.rx = P.ry = P.dx = P.dy = 0; return P; }
    P.on = true; P.id = gp.id;
    const pb = this._pb = gp.buttons.map(b => !!(b && (b.pressed || b.value > 0.5)));
    for (let i = 0; i < pb.length; i++) if (pb[i] && !this._pp[i]) this._hitPad.add(i);
    for (let s = 0; s < 2; s++) {   // round dead zone, rescaled so the stick still reaches 1
      let x = gp.axes[s * 2] || 0, y = gp.axes[s * 2 + 1] || 0; const l = Math.hypot(x, y), d = this.padDead;
      if (l <= d) x = y = 0; else { const m = Math.min(1, (l - d) / (1 - d)) / l; x *= m; y *= m; }
      if (s) { P.rx = x; P.ry = y; } else { P.lx = x; P.ly = y; }
    }
    P.dx = (pb[15] ? 1 : 0) - (pb[14] ? 1 : 0); P.dy = (pb[13] ? 1 : 0) - (pb[12] ? 1 : 0);
    return P;
  },
  padDown(i){ return !!this._pb[i]; },
  padHit(i){ return this._hitPad.has(i); },
  padAnyHit(){ return this._hitPad.size > 0; },
  // ---- touch stick
  stickOn(canvas, allow = () => true){
    const s = this.stick;
    canvas.addEventListener('pointerdown', e => { if (s.on || !allow(e)) return; s.on = true; s.id = e.pointerId; s.ox = s.x = e.clientX; s.oy = s.y = e.clientY; canvas.setPointerCapture?.(e.pointerId); });   // a second finger doesn't steal the stick
    canvas.addEventListener('pointermove', e => { if (s.on && e.pointerId === s.id) { s.x = e.clientX; s.y = e.clientY; } });
    const end = e => { if (e.pointerId === s.id) s.on = false; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  },
  stickVec(radius = 55, dead = 6){
    const s = this.stick; if (!s.on) return { x: 0, y: 0 };
    const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy); if (d <= dead) return { x: 0, y: 0 };
    const m = Math.min(1, d / radius); return { x: dx / d * m, y: dy / d * m };
  },
  // ---- actions
  bind(name, sources){ this.actions.set(name, sources.map(s => { const i = s.indexOf(':'); return [s.slice(0, i), s.slice(i + 1)]; })); },
  unbind(name){ this.actions.delete(name); },
  down(name){
    const l = this.actions.get(name); if (!l) return false;
    for (const [t, v] of l) if (t === 'key' ? this.keys.has(v) : t === 'pad' ? this.padDown(+v) : t === 'mouse' ? this.mouseDown(+v) : false) return true;
    return false;
  },
  hit(name){
    const l = this.actions.get(name); if (!l) return false;
    for (const [t, v] of l) if (t === 'key' ? this._hitKeys.has(v) : t === 'pad' ? this.padHit(+v) : t === 'mouse' ? this._hitMouse.has(+v) : false) return true;
    return false;
  },
  move(a = {}){
    let x = 0, y = 0;
    if (a.left && this.down(a.left)) x -= 1; if (a.right && this.down(a.right)) x += 1;
    if (a.up && this.down(a.up)) y -= 1; if (a.down && this.down(a.down)) y += 1;
    const P = this.pad; if (P.on) { if (P.lx || P.ly) { x = P.lx; y = P.ly; } else { x += P.dx; y += P.dy; } }
    if (this.stick.on) { const s = this.stickVec(); if (s.x || s.y) { x = s.x; y = s.y; } }
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    return { x, y };
  },
  // ---- event handlers
  _keyDown(e){
    if (this.ignore(e)) return;
    const k = e.key.toLowerCase();
    if (this._blocked.has(k) && !e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault();
    if (!e.repeat) this._hitKeys.add(k);
    if (e.code) { const was = this._codes.get(e.code); if (was !== undefined && was !== k) this.keys.delete(was); this._codes.set(e.code, k); }   // a held key that repeats under a new name (Shift went down) has one name at a time
    this.keys.add(k);
  },
  // The key that comes up can have another name than the one that went down (hold 1, press Shift, release: "!"), so
  // the physical key is matched too. macOS sends no key-up for keys released while Cmd is held: Cmd up releases them all.
  _keyUp(e){
    const k = e.key.toLowerCase(), was = e.code ? this._codes.get(e.code) : undefined;
    this.keys.delete(k);
    if (was !== undefined) { this.keys.delete(was); this._codes.delete(e.code); }
    if (k === 'meta') { this.keys.clear(); this._codes.clear(); }
  },
  // Every held button of every pointer is tracked (key: pointer and button), so two fingers, or two mouse buttons, don't
  // release each other. A mouse is one pointer for all its buttons: only the first press and the last release come as
  // pointerdown / pointerup, the ones in between as a pointermove that names the button.
  _ptrDown(e){ const p = this.pointer; p.x = e.clientX; p.y = e.clientY; p.down = true; p.button = e.button; p.type = e.pointerType; this._ptrs.set(e.pointerId * 8 + e.button, e.button); this._hitMouse.add(e.button); },
  _ptrMove(e){
    const p = this.pointer; p.x = e.clientX; p.y = e.clientY; p.type = e.pointerType; if (e.pointerType === 'mouse') p.hasMouse = true;
    if (e.button >= 0 && e.button < 5 && e.pointerType === 'mouse') {
      if (e.buttons & [1, 4, 2, 8, 16][e.button]) { if (!this._ptrs.has(e.pointerId * 8 + e.button)) this._ptrDown(e); } else { this._ptrs.delete(e.pointerId * 8 + e.button); p.down = this._ptrs.size > 0; }
    }
  },
  _ptrUp(e){
    for (const k of this._ptrs.keys()) if (Math.floor(k / 8) === e.pointerId) this._ptrs.delete(k);
    this.pointer.down = this._ptrs.size > 0;
  },
};
const keys = Input.keys;
addEventListener('keydown', e => Input._keyDown(e), true);
addEventListener('keyup', e => Input._keyUp(e), true);
addEventListener('blur', () => Input.releaseAll());
addEventListener('pointermove', e => Input._ptrMove(e), true);
addEventListener('pointerdown', e => Input._ptrDown(e), true);
addEventListener('pointerup', e => Input._ptrUp(e), true);
addEventListener('pointercancel', e => Input._ptrUp(e), true);
addEventListener('wheel', e => { Input.wheel += Math.sign(e.deltaY); }, { capture: true, passive: true });
