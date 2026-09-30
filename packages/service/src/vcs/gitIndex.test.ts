/**
 * @module vcs/gitIndex.test
 * Git index operations against real temp repos: stdin staging of additions
 * and removals, deleted-path listing, staged-diff detection, and commit.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { execFileAsync } from '../test/git';
import { normalizeSlashes } from '../util/normalizeSlashes';
import {
  gitAddViaStdin,
  gitCommit,
  gitRmCachedViaStdin,
  hasStagedChanges,
  listDeletedTrackedPaths,
} from './gitIndex';
import { initRepo } from './vcsBootstrap';

let tempDir: string;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: tempDir });
  return stdout;
}

async function commitFiles(names: string[]): Promise<void> {
  for (const name of names) {
    await writeFile(join(tempDir, name), name, 'utf8');
  }
  await git('add', '-A');
  await git('commit', '-m', 'seed');
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'git-index-'));
  await initRepo(tempDir);
  await git('config', 'user.email', 'test@test.com');
  await git('config', 'user.name', 'Test');
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('gitAddViaStdin', () => {
  it('stages several files, including names with spaces, in one call', async () => {
    const names = ['file0.txt', 'file 1.txt', 'file2.txt'];
    for (const name of names) {
      await writeFile(join(tempDir, name), name, 'utf8');
    }

    await gitAddViaStdin(
      names.map((n) => join(tempDir, n)),
      tempDir,
    );

    const staged = (await git('diff', '--cached', '--name-only'))
      .trim()
      .split('\n')
      .sort();
    expect(staged).toEqual([...names].sort());
  });

  it('stages the deletion of a tracked file that is gone from disk', async () => {
    await commitFiles(['to-delete.txt']);
    await rm(join(tempDir, 'to-delete.txt'));

    await gitAddViaStdin([join(tempDir, 'to-delete.txt')], tempDir);

    expect((await git('diff', '--cached', '--name-status')).trim()).toMatch(
      /^D\s+to-delete\.txt$/,
    );
  });

  it('fails the whole call for a vanished path git never tracked', async () => {
    await writeFile(join(tempDir, 'real.txt'), 'x', 'utf8');
    await expect(
      gitAddViaStdin(
        [join(tempDir, 'real.txt'), join(tempDir, 'ghost.txt')],
        tempDir,
      ),
    ).rejects.toThrow(/did not match any files/);
    // This is why batchStaging drops missing-untracked paths first.
    expect((await git('diff', '--cached', '--name-only')).trim()).toBe('');
  });

  it('is a no-op for an empty list', async () => {
    await expect(gitAddViaStdin([], tempDir)).resolves.toBeUndefined();
  });

  it('kills git and rejects when the timeout elapses', async () => {
    await writeFile(join(tempDir, 'a.txt'), 'x', 'utf8');
    // Spawning git takes far longer than 1 ms.
    await expect(
      gitAddViaStdin([join(tempDir, 'a.txt')], tempDir, 1),
    ).rejects.toThrow(/timed out after 1ms/);
  });
});

describe('gitRmCachedViaStdin', () => {
  it('stages removals and ignores paths that are not tracked', async () => {
    await commitFiles(['a.txt', 'b.txt']);
    await rm(join(tempDir, 'a.txt'));

    await gitRmCachedViaStdin(
      [join(tempDir, 'a.txt'), join(tempDir, 'never-tracked.txt')],
      tempDir,
    );

    expect((await git('diff', '--cached', '--name-status')).trim()).toMatch(
      /^D\s+a\.txt$/,
    );
    expect(await git('ls-files')).toContain('b.txt');
  });

  it('is a no-op for an empty list', async () => {
    await expect(gitRmCachedViaStdin([], tempDir)).resolves.toBeUndefined();
  });
});

describe('listDeletedTrackedPaths', () => {
  it('returns absolute forward-slash paths of tracked files missing on disk', async () => {
    await mkdir(join(tempDir, 'sub'));
    await writeFile(join(tempDir, 'sub', 'gone.txt'), 'x', 'utf8');
    await commitFiles(['kept.txt']);
    await rm(join(tempDir, 'sub', 'gone.txt'));
    await writeFile(join(tempDir, 'untracked.txt'), 'x', 'utf8');

    const deleted = await listDeletedTrackedPaths(tempDir);

    expect(deleted).toEqual([
      normalizeSlashes(join(tempDir, 'sub', 'gone.txt')),
    ]);
  });

  it('returns an empty list when nothing tracked is missing', async () => {
    await commitFiles(['kept.txt']);
    expect(await listDeletedTrackedPaths(tempDir)).toEqual([]);
  });
});

describe('hasStagedChanges', () => {
  it('reports false when the index matches HEAD, even with untracked and unstaged noise', async () => {
    await commitFiles(['tracked.txt', 'other.txt']);
    await writeFile(join(tempDir, 'untracked.txt'), 'x', 'utf8');
    await rm(join(tempDir, 'other.txt'));

    expect(await hasStagedChanges(tempDir)).toBe(false);
  });

  it('reports true once something is staged', async () => {
    await commitFiles(['tracked.txt']);
    await writeFile(join(tempDir, 'tracked.txt'), 'changed', 'utf8');
    await git('add', 'tracked.txt');

    expect(await hasStagedChanges(tempDir)).toBe(true);
  });

  it('rethrows errors other than "differences found"', async () => {
    const notARepo = await mkdtemp(join(tmpdir(), 'git-index-norepo-'));
    try {
      await expect(hasStagedChanges(notARepo)).rejects.toThrow();
    } finally {
      await rm(notARepo, { recursive: true, force: true });
    }
  });
});

describe('gitCommit', () => {
  it('commits the index and returns the short hash of the new HEAD', async () => {
    await writeFile(join(tempDir, 'a.txt'), 'x', 'utf8');
    await git('add', 'a.txt');

    const hash = await gitCommit(tempDir, 'test commit');

    expect(hash).toBe((await git('rev-parse', '--short', 'HEAD')).trim());
    expect((await git('log', '-1', '--format=%s')).trim()).toBe('test commit');
  });
});
