'use strict';
/* ================================================================
   UI NAVIGATION for DOM menus with a gamepad or arrow keys: moves focus to the nearest focusable element in a direction.
     UINav.roots = () => [...document.querySelectorAll('.overlay')].filter(o => !o.hidden);   // where to look (default: the whole page)
     UINav.move('u' | 'd' | 'l' | 'r');      // left / right on a focused range input changes its value
     UINav.onMove = () => playSound('tick');
   ================================================================ */
const UINav = {
  roots: () => [document.body],
  onMove: null,
  focusables(){
    return this.roots().flatMap(o => [...o.querySelectorAll('button:not([disabled]), input:not([disabled]), select, [tabindex="0"]')])
      .filter(el => { if (el.closest('[hidden]')) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  },
  move(dir){
    const list = this.focusables(); if (!list.length) return;
    const cur = document.activeElement;
    if (cur && cur.type === 'range' && (dir === 'l' || dir === 'r')) {
      const st = +(cur.step || 1) * 5 || 5; cur.value = +cur.value + (dir === 'r' ? st : -st);
      cur.dispatchEvent(new Event('input', { bubbles: true })); cur.dispatchEvent(new Event('change', { bubbles: true })); return;
    }
    if (!list.includes(cur)) { list[0].focus(); list[0].scrollIntoView?.({ block: 'nearest' }); return; }
    const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    const v = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] }[dir];
    let best = null, bs = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect(), dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
      const along = dx * v[0] + dy * v[1], across = Math.abs(dx * v[1] - dy * v[0]);
      if (along <= 4) continue;
      const sc = along + across * 2.2; if (sc < bs) { bs = sc; best = el; }
    }
    if (best) { best.focus(); best.scrollIntoView?.({ block: 'nearest' }); this.onMove && this.onMove(); }
  },
};
