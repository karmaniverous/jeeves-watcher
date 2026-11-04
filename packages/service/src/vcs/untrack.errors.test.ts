/**
 * @module vcs/untrack.errors.test
 * A git failure other than git's own "no" answer must not be read as one: a timed-out ancestry check keeps the `untrack.pending` marker and its exclude line (instead of discarding a published untrack), and a timed-out HEAD read fails the untrack (instead of treating HEAD as unborn). Real temp repos; `runGit` wrapped to inject a timeout.
 */

import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commitAll, git, makeTempRepo } from '../test/vcsRepo';
import { GitTimeoutError } from './gitProcess';
import type * as RunGitModule from './runGit';
import { listTracked } from './trackedCheck';
import { untrackPaths } from './untrack';
import { recoverUntrackPending, untrackMarkerPath } from './untrackPending';

/** First git subcommand that times out (after the global options). */
const failing = vi.hoisted(() => ({
  subcommand: undefined as string | undefined,
}));

vi.mock('./runGit', async (importOriginal) => {
  const real = await importOriginal<typeof RunGitModule>();
  return {
    runGit: (...args: Parameters<typeof real.runGit>) => {
      if (
        failing.subcommand !== undefined &&
        args[1][0] === failing.subcommand
      ) {
        return Promise.reject(
          new GitTimeoutError(`git ${args[1].join(' ')}`, 1, 0, 0, false),
        );
      }
      return real.runGit(...args);
    },
  };
});

const logger = pino({ level: 'silent' });
let repo: string;

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

const lsFiles = async () =>
  (await git(repo, 'ls-files')).split('\n').filter(Boolean).sort();

beforeEach(async () => {
  failing.subcommand = undefined;
  repo = await makeTempRepo('untrack-errors-');
  await writeFile(join(repo, 'big.bin'), 'x');
  await commitAll(repo, 'seed');
});

afterEach(async () => {
  failing.subcommand = undefined;
  await rm(repo, { recursive: true, force: true });
});

describe('untrack error handling', () => {
  it('keeps a published marker and its exclude line when the ancestry check times out', async () => {
    const exclude = join(repo, '.git', 'info', 'exclude');
    await writeFile(exclude, '*.bin\n');
    await expect(
      untrackPaths(repo, {
        select: (env) => listTracked(repo, ['big.bin'], { env }),
        message: 'untrack test',
        pattern: '*.bin',
        hooks: { afterUpdateRef: () => Promise.reject(new Error('crash')) },
      }),
    ).rejects.toThrow('crash');

    failing.subcommand = 'merge-base';
    await expect(recoverUntrackPending(repo, logger)).rejects.toThrow(
      GitTimeoutError,
    );
    expect(await exists(untrackMarkerPath(repo))).toBe(true);
    expect(await readFile(exclude, 'utf8')).toBe('*.bin\n');

    failing.subcommand = undefined;
    expect(await recoverUntrackPending(repo, logger)).toBe('finished');
    expect(await lsFiles()).toEqual([]);
  });

  it('discards a marker whose commit git does not know (exit 128)', async () => {
    await writeFile(
      untrackMarkerPath(repo),
      JSON.stringify({
        oldHead: 'f'.repeat(40),
        newCommit: 'e'.repeat(40),
        paths: ['big.bin'],
      }),
    );

    expect(await recoverUntrackPending(repo, logger)).toBe('discarded');
    expect(await lsFiles()).toEqual(['big.bin']);
  });

  it('fails the untrack, changing nothing, when reading HEAD times out', async () => {
    failing.subcommand = 'rev-parse';

    await expect(
      untrackPaths(repo, {
        select: (env) => listTracked(repo, ['big.bin'], { env }),
        message: 'untrack test',
      }),
    ).rejects.toThrow(GitTimeoutError);
    expect(await lsFiles()).toEqual(['big.bin']);
  });
});
