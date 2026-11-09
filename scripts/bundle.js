'use strict';
// Joins src/*.js (in the order of src/index.txt) into dist/bge.js. `node scripts/bundle.js --check` fails if dist is stale.
// Top-level declarations stay global, as with separate <script> tags. A file's top-level code may only use files above it.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), src = path.join(root, 'src');
const order = fs.readFileSync(path.join(src, 'index.txt'), 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
const missing = fs.readdirSync(src).filter(f => f.endsWith('.js') && !order.includes(f));
if (missing.length) { console.error(`src/index.txt is missing: ${missing.join(', ')}`); process.exit(1); }
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
let out = `/* BGEjs ${pkg.version}: a small browser game engine. Built from src/ by scripts/bundle.js; edit src/, not this file. */\n`;
for (const f of order) out += `\n/* ---- src/${f} ---- */\n` + fs.readFileSync(path.join(src, f), 'utf8').replace(/^'use strict';\n/, '') + '\n';
out = `'use strict';\n` + out;
const dest = path.join(root, 'dist', 'bge.js');
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
  if (cur !== out) { console.error('dist/bge.js is out of date: run npm run bundle'); process.exit(1); }
  console.log('dist/bge.js is up to date');
} else { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, out); console.log(`wrote dist/bge.js (${(out.length / 1024).toFixed(1)} KB, ${order.length} files)`); }
