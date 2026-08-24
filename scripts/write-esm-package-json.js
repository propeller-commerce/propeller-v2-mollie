#!/usr/bin/env node
/**
 * Drop a tiny `package.json` into `dist/esm/` declaring `"type": "module"`.
 * Without this, Node treats `.js` files there as CJS (since the root
 * package.json has no `"type": "module"`), and ESM consumers blow up with
 * "module is not defined".
 */

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'dist', 'esm', 'package.json');
fs.writeFileSync(target, JSON.stringify({ type: 'module' }, null, 2) + '\n');
console.log(`📦 Wrote ${target} with type: module`);
