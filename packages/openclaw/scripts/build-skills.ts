/**
 * @module scripts/build-skills
 * Compiles SKILL.src.md files with Handlebars partials into dist/skills/.
 */

import fs from 'node:fs';
import path from 'node:path';

import Handlebars from 'handlebars';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHARED_DIR = path.join(ROOT, 'skills', 'shared');
const SKILLS_DIR = path.join(ROOT, 'skills');
const DIST_DIR = path.join(ROOT, 'dist', 'skills');

// Register shared partials
for (const file of fs.readdirSync(SHARED_DIR)) {
  if (!file.endsWith('.md')) continue;
  const name = file; // partial name includes .md extension for {{> name.md}}
  const content = fs.readFileSync(path.join(SHARED_DIR, file), 'utf8');
  Handlebars.registerPartial(name, content);
}

// Find and compile each SKILL.src.md
for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'shared') continue;

  const srcFile = path.join(SKILLS_DIR, entry.name, 'SKILL.src.md');
  if (!fs.existsSync(srcFile)) continue;

  const source = fs.readFileSync(srcFile, 'utf8');
  const template = Handlebars.compile(source, { noEscape: true });
  const output = template({});

  // Extract skill name from frontmatter for output directory
  const nameMatch = source.match(/^name:\s*(.+)$/m);
  const skillName = nameMatch ? nameMatch[1].trim() : entry.name;

  const outDir = path.join(DIST_DIR, skillName);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'SKILL.md'), output, 'utf8');

  console.log(`Built: dist/skills/${skillName}/SKILL.md`);
}
