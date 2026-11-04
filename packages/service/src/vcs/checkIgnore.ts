/**
 * @module vcs/checkIgnore
 * Why git ignores one path, for `GET /vcs/check-exclusion` (D82): `git check-ignore -v -z --stdin` parsed into the matching rule, the file holding it and its line. Runs git.
 *
 * Exit 1 is git's "not ignored"; any other failure is rethrown (the route
 * answers `500`). A negated (`!`) rule is reported by `-v` with exit 0 but
 * means the path is not ignored. Tracked paths are never reported.
 */

import type { VcsCheckExclusionResponse } from '@karmaniverous/jeeves-watcher-core';

import { getErrorCode } from './gitExec';
import { runGit } from './runGit';

/** `check-ignore -v -z` output: source, line number, pattern, path, each NUL-terminated. */
const VERBOSE_RECORD = /^([^\0]+)\0(\d+)\0([^\0]+)\0/;

/**
 * Parse one `check-ignore -v -z` record. Pure.
 *
 * @param stdout - git's output for one ignored path.
 * @returns The exclusion state (`excluded: false` for a negated rule).
 * @throws Error when the output is not a verbose record.
 */
export function parseCheckIgnore(stdout: string): VcsCheckExclusionResponse {
  const match = VERBOSE_RECORD.exec(stdout);
  if (!match) throw new Error(`Unexpected git check-ignore output: ${stdout}`);
  const [, source, line, rule] = match;
  if (rule.startsWith('!')) return { excluded: false };
  return { excluded: true, rule, source, line: Number(line) };
}

/**
 * Ask git whether it ignores a path and why.
 *
 * @param root - Repository root.
 * @param relativePath - Root-relative path (empty for the root itself).
 * @returns The exclusion state.
 */
export async function checkIgnore(
  root: string,
  relativePath: string,
): Promise<VcsCheckExclusionResponse> {
  let stdout: string;
  try {
    ({ stdout } = await runGit(root, ['check-ignore', '-v', '-z', '--stdin'], {
      input: `${relativePath === '' ? '.' : relativePath}\0`,
    }));
  } catch (error) {
    if (getErrorCode(error) === 1) return { excluded: false };
    throw error;
  }
  return parseCheckIgnore(stdout);
}
