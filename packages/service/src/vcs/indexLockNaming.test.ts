/**
 * @module vcs/indexLockNaming.test
 * Every git call that writes an index names that index's lock (the kill rule removes only a named lock): `commit` names the real index's, the untrack helper's private-index `write-tree` names the private one's. Real git, with runGit spied.
 */

import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commitAll, git, makeTempRepo } from '../test/vcsRepo';
import { gitCommit } from './gitIndex';
import { realIndexLock } from './gitProcess';
import type * as RunGitModule from './runGit';
import { runGit, type RunGitOptions } from './runGit';
import { listTracked } from './trackedCheck';
import { untrackPaths } from './untrack';
import { privateIndexPath } from './untrackPending';

vi.mock('./runGit', async (importOriginal) => {
  const actual = await importOriginal<typeof RunGitModule>();
  return { ...actual, runGit: vi.fn(actual.runGit) };
});

let repo: string;

beforeEach(async () => {
  repo = await makeTempRepo('locknames-');
});

afterEach(async () => {
  vi.mocked(runGit).mockClear();
  await rm(repo, { recursive: true, force: true });
});

/** The indexLockPath each git subcommand was run with. */
function locks(): [string | undefined, string | undefined][] {
  return vi
    .mocked(runGit)
    .mock.calls.map(([, args, options]: [string, string[], RunGitOptions?]) => [
      args[0],
      options?.indexLockPath,
    ]);
}

describe('index lock naming', () => {
  it('commit names the real index lock', async () => {
    await writeFile(join(repo, 'a.md'), 'a');
    await git(repo, 'add', 'a.md');
    vi.mocked(runGit).mockClear();

    await gitCommit(repo, 'm');

    expect(locks()).toContainEqual(['commit', realIndexLock(repo)]);
  });

  it('the untrack write-tree names the private index lock', async () => {
    await writeFile(join(repo, 'big.bin'), 'x');
    await commitAll(repo, 'seed');
    vi.mocked(runGit).mockClear();

    await untrackPaths(repo, {
      select: (env) => listTracked(repo, ['big.bin'], { env }),
      message: () => 'untrack',
    });

    expect(locks()).toContainEqual([
      'write-tree',
      `${privateIndexPath(repo)}.lock`,
    ]);
  });
});
