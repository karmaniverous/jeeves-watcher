/**
 * @module vcs/SquashManager.guards.test
 * Squash guards and the lock-held flush (D20, D101, D148): refuse on in-progress git operations, when HEAD is off the configured branch, or when the in-hold flush fails; squash a dirty tree without touching it. Real git against temp repos.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execFileAsync } from '../test/git';
import {
  commitCount,
  createCommit,
  createSquashableHistory,
  daysAgo,
  initTestRepo,
  makeRetention,
  makeSquashManager,
} from '../test/squashRepo';
import { RootGitLock } from './RootGitLock';

const silentLogger = pino({ level: 'silent' });

let tempDir: string;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: tempDir });
  return stdout.trim();
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'squash-guard-'));
  await initTestRepo(tempDir);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('SquashManager guards', () => {
  it.each(['sequencer', 'rebase-merge', 'rebase-apply'])(
    'refuses with an in-progress operation (.git/%s)',
    async (marker) => {
      await createSquashableHistory(tempDir);
      await mkdir(join(tempDir, '.git', marker));
      const logger = pino({ level: 'silent' });
      const errorSpy = vi.spyOn(logger, 'error');

      const result = await makeSquashManager(
        tempDir,
        makeRetention(),
        logger,
      ).runSquash();

      expect(result).toEqual({
        squashed: false,
        error: `Squash refused: in-progress git operation detected (.git/${marker})`,
      });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ root: tempDir, marker }),
        expect.stringContaining('Squash refused'),
      );
      expect(await commitCount(tempDir)).toBe(3);
    },
  );

  it.each(['CHERRY_PICK_HEAD', 'MERGE_HEAD'])(
    'refuses with .git/%s present',
    async (marker) => {
      await createSquashableHistory(tempDir);
      await writeFile(join(tempDir, '.git', marker), `${'0'.repeat(40)}\n`);

      const result = await makeSquashManager(
        tempDir,
        makeRetention(),
        silentLogger,
      ).runSquash();

      expect(result.squashed).toBe(false);
      expect(result.error).toContain(marker);
      expect(await commitCount(tempDir)).toBe(3);
    },
  );

  it('refuses when HEAD is not on the configured branch, moving nothing', async () => {
    await createSquashableHistory(tempDir);
    const tip = await git('rev-parse', 'HEAD');
    await git('checkout', '-q', '--detach');

    const result = await makeSquashManager(
      tempDir,
      makeRetention(),
      silentLogger,
    ).runSquash();

    expect(result).toEqual({
      squashed: false,
      error: 'Squash refused: HEAD is not on master',
    });
    expect(await git('rev-parse', 'master')).toBe(tip);
  });

  it('squashes a dirty tree and leaves the working tree and index as they were', async () => {
    await createSquashableHistory(tempDir);
    const dirty = join(tempDir, 'file3.txt');
    await writeFile(dirty, 'uncommitted edit', 'utf8');
    await writeFile(join(tempDir, 'file1.txt'), 'staged edit', 'utf8');
    await git('add', 'file1.txt');
    await writeFile(join(tempDir, 'untracked.pdf'), 'not tracked', 'utf8');
    const statusBefore = await git('status', '--porcelain');

    const result = await makeSquashManager(
      tempDir,
      makeRetention(),
      silentLogger,
    ).runSquash();

    expect(result).toEqual({
      squashed: true,
      commitsRemoved: 2,
      commitsRetained: 1,
    });
    expect(await readFile(dirty, 'utf8')).toBe('uncommitted edit');
    expect(await git('status', '--porcelain')).toBe(statusBefore);
    expect(await git('diff', '--cached', '--name-only')).toBe('file1.txt');
    expect(await git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('master');
  }, 30000);

  it('squashes a branch with a merge commit along the first-parent chain', async () => {
    await createCommit(tempDir, 'old1.txt', 'a', daysAgo(60));
    await createCommit(tempDir, 'old2.txt', 'b', daysAgo(50));
    await createCommit(tempDir, 'recent.txt', 'c', daysAgo(2));
    await git('checkout', '-q', '-b', 'side');
    await createCommit(tempDir, 'side.txt', 'd', daysAgo(1));
    await git('checkout', '-q', 'master');
    await createCommit(tempDir, 'main.txt', 'e', daysAgo(1));
    await git('merge', '--no-ff', '-m', 'merge side', 'side');
    const treeBefore = await git('rev-parse', 'HEAD^{tree}');

    const result = await makeSquashManager(
      tempDir,
      makeRetention(),
      silentLogger,
    ).runSquash();

    expect(result).toEqual({
      squashed: true,
      commitsRemoved: 2,
      commitsRetained: 3,
    });
    expect(await git('rev-parse', 'HEAD^{tree}')).toBe(treeBefore);
    expect(await git('log', '--format=%s', '-1')).toBe('merge side');
  }, 30000);
});

describe('SquashManager in-hold flush (D101)', () => {
  it('flushes inside the lock before rewriting', async () => {
    await createSquashableHistory(tempDir);
    const lock = new RootGitLock(tempDir, silentLogger);
    const heldDuringFlush: (string | undefined)[] = [];
    const manager = makeSquashManager(tempDir, makeRetention(), silentLogger, {
      lock,
      flushInHold: () => {
        heldDuringFlush.push(lock.heldBy);
        return Promise.resolve(true);
      },
    });

    expect((await manager.runSquash()).squashed).toBe(true);
    expect(heldDuringFlush).toEqual(['squash']);
  }, 30000);

  it('refuses when the in-hold flush fails', async () => {
    await createSquashableHistory(tempDir);
    const tip = await git('rev-parse', 'HEAD');

    const result = await makeSquashManager(
      tempDir,
      makeRetention(),
      silentLogger,
      { flushInHold: () => Promise.resolve(false) },
    ).runSquash();

    expect(result).toEqual({
      squashed: false,
      error: 'Squash refused: the pending batch failed to commit',
    });
    expect(await git('rev-parse', 'HEAD')).toBe(tip);
  });
});
