/**
 * @module scripts/build-skills
 * Copies skill files to dist/skills/ for plugin packaging.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const DIST_DIR = path.join(ROOT, 'dist', 'skills');

for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;

  const srcFile = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
  if (!fs.existsSync(srcFile)) continue;

  const outDir = path.join(DIST_DIR, entry.name);
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(srcFile, path.join(outDir, 'SKILL.md'));

  console.log(`Copied: dist/skills/${entry.name}/SKILL.md`);
}
