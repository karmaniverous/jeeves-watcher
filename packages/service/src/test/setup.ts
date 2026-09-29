/**
 * @module test/setup
 * Vitest per-file setup: make every git child hermetic (see {@link applyHermeticGitEnv}).
 */

import { applyHermeticGitEnv } from './git';

applyHermeticGitEnv();
