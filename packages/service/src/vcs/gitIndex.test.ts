/**
 * @module vcs/gitIndex.test
 * Git index operations against real temp repos: literal stdin staging
 * (`add`, `add -u`, `rm --cached`), `update-index --force-remove`,
 * `check-ignore`, deleted-path listing, staged-diff detection, and commit.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { execFileAsync } from '../test/git';
import { normalizeSlashes } from '../util/normalizeSlashes';
import {
  gitAdd,
  gitAddUpdate,
  gitCommit,
  gitForceRemove,
  gitRmCached,
  hasStagedChanges,
  listDeletedTrackedPaths,
  listIgnored,
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

describe('gitAdd', () => {
  it('stages several files, including names with spaces, in one call', async () => {
    const names = ['file0.txt', 'file 1.txt', 'file2.txt'];
    for (const name of names) {
      await writeFile(join(tempDir, name), name, 'utf8');
    }

    await gitAdd(tempDir, names);

    const staged = (await git('diff', '--cached', '--name-only'))
      .trim()
      .split('\n')
      .sort();
    expect(staged).toEqual([...names].sort());
  });

  it('reads glob characters literally: [ab].txt stages that file only', async () => {
    for (const name of ['a.txt', 'b.txt', '[ab].txt']) {
      await writeFile(join(tempDir, name), name, 'utf8');
    }

    await gitAdd(tempDir, ['[ab].txt']);

    expect((await git('diff', '--cached', '--name-only')).trim()).toBe(
      '[ab].txt',
    );
  });

  it('fails for a tracked file under an ignored folder (why tracked files use add -u)', async () => {
    await mkdir(join(tempDir, 'docs'));
    await commitFiles(['docs/a.md']);
    await writeFile(join(tempDir, '.gitignore'), 'docs/\n', 'utf8');
    await writeFile(join(tempDir, 'docs', 'a.md'), 'changed', 'utf8');

    await expect(gitAdd(tempDir, ['docs/a.md'])).rejects.toMatchObject({
      code: 1,
    });
  });

  it('is a no-op for an empty list', async () => {
    await expect(gitAdd(tempDir, [])).resolves.toBeUndefined();
  });
});

describe('gitAddUpdate', () => {
  it('stages a tracked file under an ignored folder (D174)', async () => {
    await mkdir(join(tempDir, 'docs'));
    await commitFiles(['docs/a.md']);
    await writeFile(join(tempDir, '.gitignore'), 'docs/\n', 'utf8');
    await writeFile(join(tempDir, 'docs', 'a.md'), 'changed', 'utf8');

    await gitAddUpdate(tempDir, ['docs/a.md']);

    expect((await git('diff', '--cached', '--name-only')).trim()).toBe(
      'docs/a.md',
    );
  });

  it('is a no-op for an empty list', async () => {
    await expect(gitAddUpdate(tempDir, [])).resolves.toBeUndefined();
  });
});

describe('gitRmCached', () => {
  it('stages removals and ignores paths that are not tracked', async () => {
    await commitFiles(['a.txt', 'b.txt']);
    await rm(join(tempDir, 'a.txt'));

    await gitRmCached(tempDir, ['a.txt', 'never-tracked.txt']);

    expect((await git('diff', '--cached', '--name-status')).trim()).toMatch(
      /^D\s+a\.txt$/,
    );
    expect(await git('ls-files')).toContain('b.txt');
  });

  it('is a no-op for an empty list', async () => {
    await expect(gitRmCached(tempDir, [])).resolves.toBeUndefined();
  });
});

describe('gitForceRemove', () => {
  it('removes a path with staged changes and keeps the file on disk (D163)', async () => {
    await commitFiles(['a[1].md', 'a1.md']);
    await writeFile(join(tempDir, 'a[1].md'), 'staged edit', 'utf8');
    await git('add', '--', ':(literal)a[1].md');

    await gitForceRemove(tempDir, ['a[1].md']);

    expect((await git('ls-files')).trim().split('\n')).toEqual(['a1.md']);
    expect((await git('status', '--porcelain')).trim().split('\n')).toEqual([
      'D  a[1].md',
      '?? a[1].md',
    ]);
  });

  it('is a no-op for an empty list', async () => {
    await expect(gitForceRemove(tempDir, [])).resolves.toBeUndefined();
  });
});

describe('listIgnored', () => {
  it('lists ignored paths and treats exit 1 (none ignored) as an empty list', async () => {
    await writeFile(join(tempDir, '.gitignore'), '*.log\n', 'utf8');

    expect(await listIgnored(tempDir, ['a.log', 'b.md'])).toEqual(['a.log']);
    expect(await listIgnored(tempDir, ['b.md'])).toEqual([]);
    expect(await listIgnored(tempDir, [])).toEqual([]);
  });

  it('rethrows real failures', async () => {
    const notARepo = await mkdtemp(join(tmpdir(), 'git-index-norepo-'));
    try {
      await expect(listIgnored(notARepo, ['a.md'])).rejects.toThrow();
    } finally {
      await rm(notARepo, { recursive: true, force: true });
    }
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
