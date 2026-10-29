/**
 * @module scripts/build-skills
 * Writes the watcher skill (watcher-core's `WATCHER_SKILL`, the descriptor's `skill`) to `dist/skills/jeeves-watcher/SKILL.md` for plugin packaging.
 */

import path from 'node:path';

import { WATCHER_SKILL } from '@karmaniverous/jeeves-watcher-core';

import { writeSkill } from '../src/skillFiles.js';

const DIST_DIR = path.resolve(import.meta.dirname, '..', 'dist');

const file = writeSkill(DIST_DIR, WATCHER_SKILL);
console.log(`Wrote: ${path.relative(path.dirname(DIST_DIR), file)}`);
