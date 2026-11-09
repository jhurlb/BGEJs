'use strict';
/* ================================================================
   INPUT: keyboard, mouse / touch pointer, an on-screen touch stick, gamepads, and named actions over all of them.
     keys.has('a')                       // raw key state (lower-case KeyboardEvent.key); `keys` is Input.keys
     Input.pressed('a')                  // went down since the last Input.endFrame()
     Input.pointer                       // { x, y, down, hasMouse, type } in CSS pixels
     Input.stick                         // touch drag stick { on, ox, oy, x, y }; Input.stickVec(radius) -> { x, y }
     Input.pollPad()                     // call once per frame; Input.pad is { on, lx, ly, rx, ry, dx, dy, id }, Input.padDown(i) / padHit(i)
     Input.bind('jump', ['key: ', 'pad:0', 'mouse:0']);   Input.down('jump');  Input.hit('jump');
     Input.move({ up: 'up', down: 'down', left: 'left', right: 'right' })   // -> { x, y }, length <= 1, includes the left stick and the touch stick
     Input.endFrame()                    // at the end of every frame (clears the "pressed this frame" sets)
   Pad button numbers follow the standard mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 8 Back, 9 Start, 12-15 d-pad up/down/left/right.
   Input.stickOn(canvas, allow) starts the touch stick on pointerdown when allow(event) is true.
   Typing in a text field is ignored by keys; Input.ignore(e) can widen that rule.
   ================================================================ */
const Input = {
  keys: new Set(), _hitKeys: new Set(),
  pointer: { x: 0, y: 0, down: false, hasMouse: false, type: '' }, _hitMouse: new Set(),
  stick: { on: false, id: null, ox: 0, oy: 0, x: 0, y: 0 },
  pad: { on: false, id: '', lx: 0, ly: 0, rx: 0, ry: 0, dx: 0, dy: 0 }, padDead: 0.22, _pb: [], _pp: [],
  actions: new Map(),
  ignore(e){ return e.target instanceof HTMLInputElement && e.target.type !== 'range' && e.target.type !== 'checkbox'; },
  pressed(k){ return this._hitKeys.has(k); },
  endFrame(){ this._hitKeys.clear(); this._hitMouse.clear(); },
  // ---- gamepad
  deadzone(v){ const d = this.padDead; return Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d); },
  pollPad(){
    const gp = [...(navigator.getGamepads?.() || [])].find(g => g && g.connected), P = this.pad;
    this._pp = this._pb;
    if (!gp) { P.on = false; this._pb = []; return P; }
    P.on = true; P.id = gp.id;
    this._pb = gp.buttons.map(b => !!(b && (b.pressed || b.value > 0.5)));
    P.lx = this.deadzone(gp.axes[0] || 0); P.ly = this.deadzone(gp.axes[1] || 0); P.rx = gp.axes[2] || 0; P.ry = gp.axes[3] || 0;
    P.dx = (this._pb[15] ? 1 : 0) - (this._pb[14] ? 1 : 0); P.dy = (this._pb[13] ? 1 : 0) - (this._pb[12] ? 1 : 0);
    return P;
  },
  padDown(i){ return !!this._pb[i]; },
  padHit(i){ return !!this._pb[i] && !this._pp[i]; },
  padAnyHit(){ return this._pb.some((b, i) => b && !this._pp[i]); },
  // ---- touch stick
  stickOn(canvas, allow = () => true){
    const s = this.stick;
    canvas.addEventListener('pointerdown', e => { if (!allow(e)) return; s.on = true; s.id = e.pointerId; s.ox = s.x = e.clientX; s.oy = s.y = e.clientY; canvas.setPointerCapture?.(e.pointerId); });
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
  down(name){
    const l = this.actions.get(name); if (!l) return false;
    for (const [t, v] of l) if (t === 'key' ? this.keys.has(v) : t === 'pad' ? this.padDown(+v) : t === 'mouse' ? this.pointer.down && this.pointer.button === +v : false) return true;
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
};
const keys = Input.keys;
addEventListener('keydown', e => { if (Input.ignore(e)) return; const k = e.key.toLowerCase(); if (!e.repeat) Input._hitKeys.add(k); keys.add(k); }, true);
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()), true);
addEventListener('blur', () => { keys.clear(); Input.stick.on = false; Input.pointer.down = false; });
addEventListener('pointermove', e => { const p = Input.pointer; p.x = e.clientX; p.y = e.clientY; p.type = e.pointerType; if (e.pointerType === 'mouse') p.hasMouse = true; }, true);
addEventListener('pointerdown', e => { const p = Input.pointer; p.x = e.clientX; p.y = e.clientY; p.down = true; p.button = e.button; p.type = e.pointerType; Input._hitMouse.add(e.button); }, true);
addEventListener('pointerup', () => { Input.pointer.down = false; }, true);
