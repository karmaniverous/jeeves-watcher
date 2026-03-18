/**
 * Copies content/ directory from @karmaniverous/jeeves into the package root.
 *
 * When the jeeves lib is bundled (not externalized), its content files
 * must be co-located with the consuming package's package.json because
 * packageDirectorySync resolves relative to import.meta.url at runtime.
 */

/* global console, process */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(ROOT, 'content');

// Resolve the jeeves package via Node's module resolution (handles hoisting)
const require = createRequire(import.meta.url);
const jeevesEntry = require.resolve('@karmaniverous/jeeves');
// Entry is .../node_modules/@karmaniverous/jeeves/dist/index.js
// Package root is two levels up from dist/index.js
const jeevesRoot = path.resolve(path.dirname(jeevesEntry), '..');
const SRC = path.join(jeevesRoot, 'content');

if (!fs.existsSync(SRC)) {
  console.error('Error: @karmaniverous/jeeves content/ not found at', SRC);
  console.error('Resolved entry:', jeevesEntry);
  console.error('Derived root:', jeevesRoot);
  process.exit(1);
}

fs.cpSync(SRC, DEST, { recursive: true });
console.log('Copied: @karmaniverous/jeeves content/ → content/');
