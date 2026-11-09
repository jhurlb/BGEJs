'use strict';
// The type declarations (src/bge.d.ts): they compile, they accept the calls the docs show, and they name exactly
// what the engine has. A member added to the engine and not declared, or declared and not there, fails here.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const ts = require('typescript');
const { chromium } = require('playwright');
const { serve } = require('./serve');
const root = path.join(__dirname, '..'), dts = path.join(root, 'dist', 'bge.d.ts');

test('bge.d.ts compiles, and a game written against it type-checks', () => {
  const prog = ts.createProgram([path.join(__dirname, 'types-usage.ts')], { noEmit: true, strict: true, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [] });
  const out = ts.getPreEmitDiagnostics(prog).map(d => `${d.file ? path.basename(d.file.fileName) + ':' + (d.file.getLineAndCharacterOfPosition(d.start).line + 1) : ''} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
  assert.deepStrictEqual(out, []);
});

// What the declarations say: every top-level value, and the members of each class and each object written out in full.
function declared(){
  const sf = ts.createSourceFile('bge.d.ts', fs.readFileSync(dts, 'utf8'), ts.ScriptTarget.ES2022, true), out = {};
  const names = (members, open) => ({ members: [...new Set(members.filter(m => m.name).map(m => m.name.getText(sf)))], open });
  for (const st of sf.statements) {
    if (ts.isClassDeclaration(st)) out[st.name.text] = names(st.members, false);
    else if (ts.isFunctionDeclaration(st)) out[st.name.text] = null;
    else if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations)
      out[d.name.getText(sf)] = d.type && ts.isTypeLiteralNode(d.type) ? names(d.type.members, d.type.members.some(ts.isIndexSignatureDeclaration)) : null;
  }
  return out;
}
// The top-level names of the bundle.
function engineGlobals(){
  const sf = ts.createSourceFile('bge.js', fs.readFileSync(path.join(root, 'dist', 'bge.js'), 'utf8'), ts.ScriptTarget.ES2022, true), out = [];
  for (const st of sf.statements) {
    if (ts.isClassDeclaration(st) || ts.isFunctionDeclaration(st)) out.push(st.name.text);
    else if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) out.push(d.name.getText(sf));
  }
  return out;
}

let srv, browser;
before(async () => { srv = await serve(); browser = await chromium.launch(); });
after(async () => { await browser.close(); srv.close(); });

test('bge.d.ts names exactly what the engine has', async () => {
  const D = declared(), G = engineGlobals();
  assert.deepStrictEqual(G.filter(n => !(n in D)), [], 'engine globals with no declaration');
  assert.deepStrictEqual(Object.keys(D).filter(n => !G.includes(n)), [], 'declared globals the engine does not have');
  const pg = await (await browser.newContext()).newPage();
  await pg.goto(`${srv.base}tests/blank.html`);
  const real = await pg.evaluate(list => {
    const make = { Rng: () => new Rng(1), Bus: () => new Bus(), World: () => new World(), Clock: () => new Clock(), Pool: () => new Pool(() => ({})), Store: () => new Store('t'),
      SpatialHash: () => new SpatialHash(), Physics: () => new Physics(), Particles: () => new Particles(8), Camera: () => new Camera(), MusicPlayer: () => new MusicPlayer([{ src: 'x.mp3' }]), Tilemap: () => new Tilemap(2, 2) };
    const out = {};
    for (const n of list) {
      const v = (0, eval)(n), names = new Set();
      if (typeof v === 'function' && make[n]) {
        for (const k of Object.getOwnPropertyNames(v)) if (!['length', 'name', 'prototype'].includes(k)) names.add(k);
        for (const k of Object.getOwnPropertyNames(v.prototype)) if (k !== 'constructor') names.add(k);
        for (const k of Object.getOwnPropertyNames(make[n]())) names.add(k);
      } else if (v && typeof v === 'object') for (const k of Object.getOwnPropertyNames(v)) names.add(k);
      out[n] = [...names];
    }
    return out;
  }, Object.keys(D).filter(n => D[n]));
  const wrong = [];
  for (const n in real) {
    const want = D[n].members, have = real[n];
    for (const m of want) if (!have.includes(m)) wrong.push(`${n}.${m} is declared but not in the engine`);
    if (!D[n].open) for (const m of have) if (!m.startsWith('_') && !want.includes(m)) wrong.push(`${n}.${m} is in the engine but not declared`);
  }
  assert.deepStrictEqual(wrong, []);
});
