/**
 * @module test/distFreshness.test
 * The stale-build check behind the dist smoke test (spec D201): a build is fresh until an input under any input directory changes after it; test files, `test` folders and missing directories do not count.
 */

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isOlderThanInputs, newestInputMtimeMs } from './distFreshness.js';

let root: string;

/** Write a file with a given modification time (seconds since the epoch). */
function file(path: string, mtime: number): string {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, 'x');
  utimesSync(full, mtime, mtime);
  return full;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jeeves-watcher-distfresh-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('newestInputMtimeMs', () => {
  it('is the newest input at any depth, skipping test files and test folders', () => {
    file('src/a.ts', 1_000);
    file('src/deep/b.ts', 2_000);
    file('src/deep/b.test.ts', 9_000);
    file('src/test/helper.ts', 9_000);
    expect(newestInputMtimeMs(join(root, 'src'))).toBe(2_000_000);
  });

  it('is 0 for a missing directory', () => {
    expect(newestInputMtimeMs(join(root, 'missing'))).toBe(0);
  });
});

describe('isOlderThanInputs', () => {
  it('is false when the build is newer than every input', () => {
    file('src/a.ts', 1_000);
    file('core/b.ts', 2_000);
    const built = file('dist/index.js', 3_000);
    expect(
      isOlderThanInputs(built, [join(root, 'src'), join(root, 'core')]),
    ).toBe(false);
  });

  it('is true when an input in any directory changed after the build', () => {
    file('src/a.ts', 1_000);
    file('core/b.ts', 4_000);
    const built = file('dist/index.js', 3_000);
    expect(
      isOlderThanInputs(built, [join(root, 'src'), join(root, 'core')]),
    ).toBe(true);
  });
});
