'use strict';
/* ---------------- NETWORK transport: the claude.ai live room when the page runs there, else a BroadcastChannel between tabs of one browser.
   netInit() picks one; netJoin(name) gives a room with presence(patch), peers(), leave(). Presence only: each peer publishes one small object. ---------------- */
const NET = { kind: null, api: null, lobby: null, channel: 'bge-net' };   // set NET.channel per game before netInit()
function localNet(){                     // BroadcastChannel stand-in with the room API's shape (tabs of one browser)
  const id = Math.random().toString(36).slice(2, 10), bc = new BroadcastChannel(NET.channel), rooms = new Map();
  const send = (r, extra) => { try { bc.postMessage({ id, room: r.name, p: r.mine, ...extra }); } catch (e) {} };
  bc.onmessage = ev => {
    const m = ev.data; if (!m || m.id === id) return; const r = rooms.get(m.room); if (!r) return;
    if (m.bye) r.others.delete(m.id); else r.others.set(m.id, { peer: m.id, isMe: false, sameTab: false, presence: Object.freeze(m.p || {}), seen: performance.now() });
    if (m.hello) send(r);
  };
  setInterval(() => { const now = performance.now(); for (const r of rooms.values()) { send(r); for (const [k, o] of r.others) if (now - o.seen > 3500) r.others.delete(k); } }, 1000);
  addEventListener('pagehide', () => { for (const r of rooms.values()) send(r, { bye: 1 }); });
  function room(name){
    if (rooms.has(name)) return rooms.get(name);
    let pend = 0;
    const r = { name, mine: {}, others: new Map(),
      presence(patch){ r.mine = { ...r.mine }; for (const k in patch) { if (patch[k] === null) delete r.mine[k]; else r.mine[k] = patch[k]; } if (!pend) pend = setTimeout(() => { pend = 0; send(r); }, 33); return Promise.resolve(); },
      peers(){ return [{ peer: id, isMe: true, sameTab: true, presence: r.mine }, ...r.others.values()]; },
      leave(){ send(r, { bye: 1 }); rooms.delete(name); return Promise.resolve(); },
      connected(){ return true; } };
    rooms.set(name, r); send(r, { hello: 1 });
    return r;
  }
  return { lobby: room('lobby'), join: name => Promise.resolve(room(name)) };
}
async function netInit(){
  if (NET.kind) return NET.kind !== 'none';
  let room = null;
  try { if (window.claude && claude.use) room = await claude.use('room'); } catch (e) {}
  if (room) { NET.kind = 'room'; NET.api = room; NET.lobby = room; }
  else if (typeof BroadcastChannel !== 'undefined') { NET.kind = 'local'; NET.api = localNet(); NET.lobby = NET.api.lobby; }
  else NET.kind = 'none';
  return NET.kind !== 'none';
}
const netJoin = name => NET.api ? NET.api.join(name) : Promise.reject(new Error('netJoin: call netInit() first (or no transport is available)'));
const safePres = (room, obj) => { try { room.presence(obj).catch(() => {}); } catch (e) {} };
