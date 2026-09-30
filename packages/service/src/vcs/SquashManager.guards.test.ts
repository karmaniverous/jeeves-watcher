/**
 * @module vcs/SquashManager.guards.test
 * Squash safety guards (#249): refuse on in-progress git operations and on
 * uncommitted tracked changes, and never leave a sequencer behind after a
 * failed cherry-pick. All tests run real git against temp repos.
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
} from '../test/squashRepo';
import { detectStaleGitOperation } from './gitRepoState';
import { SquashManager } from './SquashManager';

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

describe('SquashManager guards (#249)', () => {
  it.each(['sequencer', 'rebase-merge', 'rebase-apply'])(
    'refuses with an in-progress operation (.git/%s) and never pauses',
    async (marker) => {
      await createSquashableHistory(tempDir);
      await mkdir(join(tempDir, '.git', marker));

      const logger = pino({ level: 'silent' });
      const errorSpy = vi.spyOn(logger, 'error');
      const pauseFn = vi.fn(() => Promise.resolve());
      const manager = new SquashManager(tempDir, makeRetention(), logger, {
        pauseCommits: pauseFn,
      });

      const result = await manager.runSquash();

      expect(result).toEqual({
        squashed: false,
        error: `Squash refused: in-progress git operation detected (.git/${marker})`,
      });
      expect(pauseFn).not.toHaveBeenCalled();
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
      const manager = new SquashManager(tempDir, makeRetention(), silentLogger);

      const result = await manager.runSquash();

      expect(result.squashed).toBe(false);
      expect(result.error).toContain(marker);
      expect(await commitCount(tempDir)).toBe(3);
    },
  );

  it('refuses with a dirty tracked file, resumes, and leaves its content intact', async () => {
    await createSquashableHistory(tempDir);
    const dirty = join(tempDir, 'file3.txt');
    await writeFile(dirty, 'uncommitted edit', 'utf8');

    const logger = pino({ level: 'silent' });
    const warnSpy = vi.spyOn(logger, 'warn');
    const resumeFn = vi.fn(() => {});
    const manager = new SquashManager(tempDir, makeRetention(), logger, {
      pauseCommits: () => Promise.resolve(),
      resumeCommits: resumeFn,
    });

    const result = await manager.runSquash();

    expect(result.squashed).toBe(false);
    expect(result.error).toContain('uncommitted changes');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ root: tempDir }),
      expect.stringContaining('Squash refused'),
    );
    expect(resumeFn).toHaveBeenCalledTimes(1);
    expect(await readFile(dirty, 'utf8')).toBe('uncommitted edit');
    expect(await commitCount(tempDir)).toBe(3);
  });

  it('refuses with a staged but uncommitted change', async () => {
    await createSquashableHistory(tempDir);
    await writeFile(join(tempDir, 'file1.txt'), 'staged edit', 'utf8');
    await git('add', 'file1.txt');
    const manager = new SquashManager(tempDir, makeRetention(), silentLogger);

    const result = await manager.runSquash();

    expect(result.squashed).toBe(false);
    expect(await git('diff', '--cached', '--name-only')).toBe('file1.txt');
  });

  it('still squashes a clean tree with untracked files present', async () => {
    await createSquashableHistory(tempDir);
    const untracked = join(tempDir, 'untracked.pdf');
    await writeFile(untracked, 'not tracked', 'utf8');
    const manager = new SquashManager(tempDir, makeRetention(), silentLogger);

    const result = await manager.runSquash();

    expect(result).toEqual({
      squashed: true,
      commitsRemoved: 2,
      commitsRetained: 1,
    });
    expect(await commitCount(tempDir)).toBe(2);
    expect(await readFile(untracked, 'utf8')).toBe('not tracked');
    expect(await git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('master');
  }, 30000);

  it('aborts a failed cherry-pick so no sequencer is left behind', async () => {
    // A retained merge commit makes `git cherry-pick <list>` fail for real
    // ("is a merge but no -m option was given") after it has started a
    // sequence, which is the state that wedged J:\veterancrowd.
    await createCommit(tempDir, 'old1.txt', 'a', daysAgo(60));
    await createCommit(tempDir, 'old2.txt', 'b', daysAgo(50));
    await createCommit(tempDir, 'recent.txt', 'c', daysAgo(2));
    await git('checkout', '-b', 'side');
    await createCommit(tempDir, 'side.txt', 'd', daysAgo(1));
    await git('checkout', 'master');
    await createCommit(tempDir, 'main.txt', 'e', daysAgo(1));
    await git('merge', '--no-ff', '-m', 'merge side', 'side');
    const headBefore = await git('rev-parse', 'HEAD');
    const countBefore = await commitCount(tempDir);

    const manager = new SquashManager(tempDir, makeRetention(), silentLogger);
    const result = await manager.runSquash();

    expect(result.squashed).toBe(false);
    expect(result.error).toMatch(/cherry-pick/);
    expect(await detectStaleGitOperation(tempDir)).toBeUndefined();
    expect(await git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('master');
    expect(await git('rev-parse', 'HEAD')).toBe(headBefore);
    expect(await commitCount(tempDir)).toBe(countBefore);
    expect(await git('status', '--porcelain', '--untracked-files=no')).toBe('');
  }, 30000);
});
