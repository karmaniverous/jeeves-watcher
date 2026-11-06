/**
 * @module test/distFreshness
 * Whether a build output is older than its inputs (spec D201): the newest modification time of the files under the input directories, test files and `test` folders excluded, against the output's. Reads the file system; test-only.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Test files, which never reach a build. */
const TEST_FILE = /\.test\.[cm]?[jt]s$/;

/**
 * Newest modification time of the build inputs under a directory: every
 * file at any depth except test files and anything under a `test` folder.
 *
 * @param dir - The directory (missing: `0`).
 * @returns The newest `mtimeMs`, or `0` when there is no input.
 */
export function newestInputMtimeMs(dir: string): number {
  if (!existsSync(dir)) return 0;
  let newest = 0;
  for (const entry of readdirSync(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || TEST_FILE.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    if (relative(dir, path).split(sep).includes('test')) continue;
    newest = Math.max(newest, statSync(path).mtimeMs);
  }
  return newest;
}

/**
 * Whether a built file is older than any input under the given directories.
 *
 * @param builtFile - The build output (must exist).
 * @param inputDirs - Directories holding its inputs.
 * @returns `true` when some input changed after the build.
 */
export function isOlderThanInputs(
  builtFile: string,
  inputDirs: readonly string[],
): boolean {
  const built = statSync(builtFile).mtimeMs;
  return inputDirs.some((dir) => newestInputMtimeMs(dir) > built);
}
