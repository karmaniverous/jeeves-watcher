/**
 * @module plugin/skillFiles
 * Writes the watcher skill (descriptor `skill`, from watcher-core) as `SKILL.md` into the plugin's dist, the folder `openclaw.plugin.json` lists under `skills`. Used by the build (`scripts/build-skills.ts`); writes files.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Skill folder relative to the dist directory (manifest `skills[0]` minus `dist/`). */
export const SKILL_DIR = 'skills/jeeves-watcher';

/**
 * Write `skill` to `<distDir>/skills/jeeves-watcher/SKILL.md`.
 *
 * @param distDir - The plugin's dist directory.
 * @param skill - Skill markdown (the descriptor's `skill`).
 * @returns The path written.
 */
export function writeSkill(distDir: string, skill: string): string {
  const dir = join(distDir, SKILL_DIR);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'SKILL.md');
  writeFileSync(file, skill, 'utf8');
  return file;
}
