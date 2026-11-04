/**
 * @module vcs/gitRepoState.test
 * Repository state checks against real temp repos: stale operation
 * markers, the ref HEAD points at, and index.lock handling.
 */

import { access, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commitAll, git, makeTempRepo } from '../test/vcsRepo';
import {
  detectStaleGitOperation,
  headRef,
  removeIndexLock,
  removeStaleIndexLock,
  STALE_OPERATION_MARKERS,
} from './gitRepoState';

let tempDir: string;
const lockPath = () => join(tempDir, '.git', 'index.lock');
const indexLockExists = (dir: string) =>
  access(join(dir, '.git', 'index.lock')).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  tempDir = await makeTempRepo('git-repo-state-');
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('detectStaleGitOperation', () => {
  it('returns undefined for a clean repo', async () => {
    expect(await detectStaleGitOperation(tempDir)).toBeUndefined();
  });

  it.each(STALE_OPERATION_MARKERS)(
    'detects .git/%s as a directory or file and leaves it in place',
    async (marker) => {
      const path = join(tempDir, '.git', marker);
      if (marker.endsWith('_HEAD')) await writeFile(path, 'x', 'utf8');
      else await mkdir(path);

      expect(await detectStaleGitOperation(tempDir)).toBe(marker);
      await expect(access(path)).resolves.toBeUndefined();
    },
  );

  it('detects the state a real conflicted cherry-pick leaves behind', async () => {
    await writeFile(join(tempDir, 'f.txt'), 'base', 'utf8');
    await commitAll(tempDir, 'base');
    await git(tempDir, 'checkout', '-b', 'side');
    await writeFile(join(tempDir, 'f.txt'), 'side', 'utf8');
    await commitAll(tempDir, 'side');
    await git(tempDir, 'checkout', 'master');
    await writeFile(join(tempDir, 'f.txt'), 'main', 'utf8');
    await commitAll(tempDir, 'main');
    await expect(git(tempDir, 'cherry-pick', 'side')).rejects.toThrow();

    expect(await detectStaleGitOperation(tempDir)).toBe('CHERRY_PICK_HEAD');
  });
});

describe('headRef', () => {
  it('names the branch ref HEAD points at, unborn or committed', async () => {
    expect(await headRef(tempDir)).toBe('refs/heads/master');
    await writeFile(join(tempDir, 'f.txt'), 'x', 'utf8');
    await commitAll(tempDir, 'seed');
    expect(await headRef(tempDir)).toBe('refs/heads/master');
  });

  it('is undefined when HEAD is detached', async () => {
    await writeFile(join(tempDir, 'f.txt'), 'x', 'utf8');
    await commitAll(tempDir, 'seed');
    await git(tempDir, 'checkout', '-q', '--detach');
    expect(await headRef(tempDir)).toBeUndefined();
  });
});

describe('index.lock', () => {
  it('removes it (missing is fine)', async () => {
    await writeFile(lockPath(), '', 'utf8');
    expect(await indexLockExists(tempDir)).toBe(true);

    await removeIndexLock(tempDir);
    expect(await indexLockExists(tempDir)).toBe(false);
    await expect(removeIndexLock(tempDir)).resolves.toBeUndefined();
  });

  it('removeStaleIndexLock removes only locks older than the threshold', async () => {
    const logger = pino({ level: 'silent' });
    const warnSpy = vi.spyOn(logger, 'warn');
    await writeFile(lockPath(), '', 'utf8');

    await removeStaleIndexLock(tempDir, 60_000, logger);
    expect(await indexLockExists(tempDir)).toBe(true);

    const old = new Date(Date.now() - 120_000);
    await utimes(lockPath(), old, old);
    await removeStaleIndexLock(tempDir, 60_000, logger);

    expect(await indexLockExists(tempDir)).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ root: tempDir }),
      'Removed stale index.lock',
    );
  });

  it('removeStaleIndexLock is silent when there is no lock', async () => {
    const logger = pino({ level: 'silent' });
    const warnSpy = vi.spyOn(logger, 'warn');

    await removeStaleIndexLock(tempDir, 0, logger);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('removeStaleIndexLock logs, not throws, when a stale lock cannot be removed', async () => {
    const logger = pino({ level: 'silent' });
    const warnSpy = vi.spyOn(logger, 'warn');
    // A directory named index.lock: stat succeeds, non-recursive rm fails.
    await mkdir(lockPath());
    const old = new Date(Date.now() - 120_000);
    await utimes(lockPath(), old, old);

    await expect(
      removeStaleIndexLock(tempDir, 60_000, logger),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ root: tempDir }),
      'Unable to remove stale index.lock',
    );
    expect(await indexLockExists(tempDir)).toBe(true);
  });
});
