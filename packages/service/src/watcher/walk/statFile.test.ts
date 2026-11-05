/**
 * @module watcher/walk/statFile.test
 * File stats for the stability ticker, and the stat-confirmed absence reconciliation unlinks on (D90): only `ENOENT`/`ENOTDIR` count as gone.
 */

import type * as FsPromises from 'node:fs/promises';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lstatError = vi.hoisted(() => ({
  code: undefined as string | undefined,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    lstat: (path: string) =>
      lstatError.code
        ? Promise.reject(
            Object.assign(new Error(lstatError.code), {
              code: lstatError.code,
            }),
          )
        : actual.lstat(path),
  };
});

const { isGone, statFile } = await import('./statFile');

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-stat-'));
  await writeFile(join(dir, 'f.md'), 'abc');
  lstatError.code = undefined;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('statFile', () => {
  it('returns size and mtime of a file', async () => {
    const stats = await statFile(join(dir, 'f.md'));
    expect(stats?.size).toBe(3);
    expect(stats?.mtimeMs).toBeGreaterThan(0);
  });

  it('returns undefined for a directory or a missing path', async () => {
    expect(await statFile(dir)).toBeUndefined();
    expect(await statFile(join(dir, 'missing'))).toBeUndefined();
  });
});

describe('isGone', () => {
  it('is false for a present path and true for a missing one', async () => {
    expect(await isGone(join(dir, 'f.md'))).toBe(false);
    expect(await isGone(join(dir, 'missing'))).toBe(true);
    expect(await isGone(join(dir, 'f.md', 'under-a-file'))).toBe(true);
  });

  it.each(['EACCES', 'EPERM', 'EIO'])(
    'is false when lstat fails with %s (not a confirmed absence)',
    async (code) => {
      lstatError.code = code;
      expect(await isGone(join(dir, 'f.md'))).toBe(false);
    },
  );
});
