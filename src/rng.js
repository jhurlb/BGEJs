'use strict';
/* ================================================================
   RANDOM NUMBERS. Rng(seed) is a small, fast, seedable generator (sfc32), so a run can be replayed
   or a test made repeatable. Rng.main backs the global helpers below; Rng.seed(n) reseeds it.
     const r = new Rng(42); r.float(); r.range(2, 5); r.int(0, 9); r.pick(list); r.chance(0.3);
     r.shuffle(list); r.weighted([['a', 3], ['b', 1]]); r.angle(); r.gauss();
   Code that calls Math.random directly is not affected by the seed.
   Rng.fx is a second, never-seeded stream for looks and sounds (shake, sparkle, pitch wobble). Keep those off Rng.main:
   anything that runs a different number of times per play-through (rendering, rate-limited sounds) would otherwise
   shift the gameplay numbers and break replays.
   ================================================================ */
class Rng {
  constructor(seed = (Math.random() * 2 ** 32) >>> 0){ this.seed(seed); }
  seed(s){
    // splitmix32 spreads one number over the four words of state
    let x = s >>> 0;
    const next = () => { x = (x + 0x9e3779b9) >>> 0; let z = x; z = Math.imul(z ^ (z >>> 16), 0x85ebca6b); z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35); return (z ^ (z >>> 16)) >>> 0; };
    this.a = next(); this.b = next(); this.c = next(); this.d = next();
    for (let i = 0; i < 12; i++) this.next();
    return this;
  }
  next(){   // uint32
    let { a, b, c, d } = this;
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0; a = b ^ (b >>> 9); b = (c + (c << 3)) >>> 0; c = ((c << 21) | (c >>> 11)) >>> 0; c = (c + t) >>> 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return t;
  }
  float(){ return this.next() / 4294967296; }                       // [0, 1)
  range(a, b){ return a + this.float() * (b - a); }                   // [a, b)
  int(a, b){ return a + Math.floor(this.float() * (b - a + 1)); }     // [a, b], both ends included
  chance(p){ return this.float() < p; }
  sign(){ return this.float() < 0.5 ? -1 : 1; }
  angle(){ return this.float() * Math.PI * 2; }
  pick(list){ return list[Math.floor(this.float() * list.length)]; }
  gauss(mean = 0, sd = 1){ let u = 0; while (!u) u = this.float(); return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * this.float()); }
  shuffle(a){ for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.float() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }   // Fisher-Yates, in place
  weighted(items){   // items: [[value, weight], ...]
    let s = 0; for (const it of items) s += it[1];
    let r = this.float() * s; for (const it of items) { r -= it[1]; if (r <= 0) return it[0]; }
    return items[items.length - 1][0];
  }
  state(){ return [this.a, this.b, this.c, this.d]; }
  restore(s){ [this.a, this.b, this.c, this.d] = s; return this; }
}
Rng.main = new Rng();
Rng.seed = n => Rng.main.seed(n);
Rng.fx = new Rng();

// Global shorthands on Rng.main
const rand = (a, b) => Rng.main.range(a, b);
const pickW = items => Rng.main.weighted(items);
const shuffle = a => Rng.main.shuffle(a);
