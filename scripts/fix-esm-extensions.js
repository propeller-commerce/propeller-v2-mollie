#!/usr/bin/env node
/**
 * Post-process the ESM build to rewrite extensionless relative imports to
 * include explicit `.js` extensions. TypeScript with `module: "ES2020"` emits
 * `from './foo'`, which Node ESM rejects. Bundlers tolerate both forms, but
 * Node won't, so we fix it once here rather than asking every consumer to
 * configure a loader.
 *
 * Also rewrites directory imports (`from './foo'` where `./foo/index.js` exists)
 * to `from './foo/index.js'`.
 */

const fs = require('fs');
const path = require('path');

const ESM_DIR = path.join(__dirname, '..', 'dist', 'esm');

if (!fs.existsSync(ESM_DIR)) {
  console.error(`ESM directory not found: ${ESM_DIR}`);
  process.exit(1);
}

const IMPORT_RE = /(\b(?:from|import)\s*['"])(\.\.?\/[^'"]+)(['"])/g;
const DYNAMIC_IMPORT_RE = /(\bimport\s*\(\s*['"])(\.\.?\/[^'"]+)(['"])/g;
const EXPORT_FROM_RE = /(\bexport\s+(?:\*|\{[^}]*\})\s*from\s*['"])(\.\.?\/[^'"]+)(['"])/g;

function resolveSpecifier(currentFile, specifier) {
  const baseDir = path.dirname(currentFile);
  const target = path.resolve(baseDir, specifier);

  if (fs.existsSync(target + '.js')) return specifier + '.js';
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    if (fs.existsSync(path.join(target, 'index.js'))) {
      return specifier.endsWith('/') ? specifier + 'index.js' : specifier + '/index.js';
    }
  }
  // Already has extension, or unresolvable — leave it.
  return specifier;
}

function rewrite(content, filePath) {
  const rewriter = (_match, prefix, spec, suffix) => {
    if (/\.[a-z0-9]+$/i.test(spec)) return prefix + spec + suffix;
    const fixed = resolveSpecifier(filePath, spec);
    return prefix + fixed + suffix;
  };
  return content
    .replace(IMPORT_RE, rewriter)
    .replace(DYNAMIC_IMPORT_RE, rewriter)
    .replace(EXPORT_FROM_RE, rewriter);
}

let touched = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walk(full);
    } else if (entry.endsWith('.js')) {
      const original = fs.readFileSync(full, 'utf8');
      const rewritten = rewrite(original, full);
      if (rewritten !== original) {
        fs.writeFileSync(full, rewritten);
        touched++;
      }
    }
  }
}

walk(ESM_DIR);
console.log(`🔧 Rewrote ESM imports in ${touched} files under ${ESM_DIR}`);
