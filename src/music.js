'use strict';
/* ================================================================
   MUSIC PLAYER: streamed <audio> tracks with a playlist, volume, mute and looping, and the browser's
   "no sound before a gesture" rule handled for you.
     const bgm = new MusicPlayer([{ src: 'music/a.mp3', name: 'A' }, { src: 'music/b.mp3', name: 'B' }], { loop: false, vol: 0.7 });
     bgm.play();  bgm.next();  bgm.stop();  bgm.volume = 0.5;  bgm.muted = true;  bgm.playing   // track name or ''
     bgm.pause(); bgm.resume()   // hold it (a pause menu) without losing its place; gestures won't restart it
     bgm.stop(true)   // stop and unload, so the next play() starts the current track from the top
     bgm.loopFrom = 6.5   // a single looping track goes back here instead of 0 (skip an intro)
   With one track and loop: true it repeats; with several it moves to the next when one ends. play() before the
   first click or key press is retried on the next gesture.
   ================================================================ */
class MusicPlayer {
  constructor(tracks, o = {}){
    this.tracks = tracks; this.idx = o.start ?? 0; this.loopFrom = o.loopFrom || 0; this.loop = o.loop ?? tracks.length === 1; this._vol = o.vol ?? 0.75; this._muted = false; this.want = false; this.held = false;
    this.el = new Audio(); this.el.preload = 'none';
    this.el.addEventListener('ended', () => { if (this.loop && this.tracks.length === 1) { this.el.currentTime = this.loopFrom; if (this.want && !this.held) this._play(); } else this.next(); });
    for (const ev of ['pointerup', 'keydown', 'touchend', 'click']) addEventListener(ev, () => { if (this.want && !this.held && this.el.paused) this._play(); }, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.el.pause(); else if (this.want && !this.held) this._play(); });
  }
  _play(){ this.el.volume = this._vol; this.el.muted = this._muted || !this._vol; this.el.play().catch(() => {}); }
  play(i){
    if (i !== undefined || !this.el.src) { if (i !== undefined) this.idx = i; this.el.src = this.tracks[this.idx].src; }
    this.want = true; this.held = false; this._play();
  }
  pause(){ this.held = true; this.el.pause(); }
  resume(){ this.held = false; if (this.want) this._play(); }
  next(){ this.idx = (this.idx + 1) % this.tracks.length; this.el.src = this.tracks[this.idx].src; if (this.want && !this.held) this._play(); }
  stop(unload = false){ this.want = false; this.held = false; this.el.pause(); if (unload) { this.el.removeAttribute('src'); this.el.load(); } }
  get playing(){ return this.want && !this.el.paused ? this.tracks[this.idx].name || this.tracks[this.idx].src : ''; }
  get volume(){ return this._vol; } set volume(v){ this._vol = v; this.el.volume = v; this.el.muted = this._muted || !v; }
  get muted(){ return this._muted; } set muted(m){ this._muted = m; this.el.muted = m || !this._vol; }
}
