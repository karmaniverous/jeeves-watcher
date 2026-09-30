/**
 * @module vcs/batchStaging.test
 * Batch classification and staging against real temp repos: only
 * "does not exist" errors count as missing, and staging records additions
 * and tracked deletions while dropping never-tracked vanished paths.
 */

import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commitAll, git, makeTempRepo } from '../test/vcsRepo';
import { classifyBatchPaths, stageBatch } from './batchStaging';

let tempDir: string;

beforeEach(async () => {
  tempDir = await makeTempRepo('batch-staging-');
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('classifyBatchPaths', () => {
  it('splits existing, missing-tracked, and missing-untracked paths', async () => {
    const existing = join(tempDir, 'here.txt');
    const tracked = join(tempDir, 'was-tracked.txt');
    await writeFile(existing, 'x', 'utf8');
    await writeFile(tracked, 'x', 'utf8');
    await commitAll(tempDir, 'seed');
    await rm(tracked);
    const ghost = join(tempDir, 'ghost.txt');
    const underFile = join(existing, 'child.txt'); // ENOTDIR

    expect(
      await classifyBatchPaths([existing, tracked, ghost, underFile], tempDir),
    ).toEqual({
      existing: [existing],
      missingTracked: [tracked],
      missingUntracked: [ghost, underFile],
    });
  });

  it('does not query git when every path exists', async () => {
    // A corrupt index would make `git ls-files` fail if it were called.
    await writeFile(join(tempDir, '.git', 'index'), 'corrupt', 'utf8');
    const file = join(tempDir, 'a.txt');
    await writeFile(file, 'x', 'utf8');

    expect(await classifyBatchPaths([file], tempDir)).toEqual({
      existing: [file],
      missingTracked: [],
      missingUntracked: [],
    });
  });

  it('propagates stat errors other than ENOENT/ENOTDIR instead of dropping the path', async () => {
    const denied = Object.assign(new Error('EACCES: permission denied'), {
      code: 'EACCES',
    });
    const statFn = vi.fn((p: string) =>
      p.endsWith('denied.txt') ? Promise.reject(denied) : stat(p),
    );
    const ok = join(tempDir, 'ok.txt');
    await writeFile(ok, 'x', 'utf8');

    await expect(
      classifyBatchPaths([ok, join(tempDir, 'denied.txt')], tempDir, statFn),
    ).rejects.toBe(denied);
  });

  it('propagates a stat error that carries no errno code', async () => {
    const odd = new Error('unexpected failure');
    await expect(
      classifyBatchPaths([join(tempDir, 'x.txt')], tempDir, () =>
        Promise.reject(odd),
      ),
    ).rejects.toBe(odd);
  });

  it('matches tracked deletions regardless of path separator style', async () => {
    const tracked = join(tempDir, 'dir', 'f.txt');
    await mkdir(join(tempDir, 'dir'));
    await writeFile(tracked, 'x', 'utf8');
    await commitAll(tempDir, 'seed');
    await rm(tracked);

    const forward = tracked.replace(/\\/g, '/');
    const result = await classifyBatchPaths([forward], tempDir);
    expect(result.missingTracked).toEqual([forward]);
  });
});

describe('stageBatch', () => {
  it('stages additions and tracked deletions and drops vanished untracked paths', async () => {
    const doomed = join(tempDir, 'doomed.txt');
    await writeFile(doomed, 'old content', 'utf8');
    await commitAll(tempDir, 'seed');
    await rm(doomed);
    const added = join(tempDir, 'added.txt');
    await writeFile(added, 'new content', 'utf8');

    const logger = pino({ level: 'silent' });
    const debugSpy = vi.spyOn(logger, 'debug');
    await stageBatch(
      [added, doomed, join(tempDir, 'ghost.txt')],
      tempDir,
      logger,
    );

    const staged = (
      await git(tempDir, 'diff', '--cached', '--name-status', '--no-renames')
    )
      .trim()
      .split('\n')
      .sort();
    expect(staged).toEqual(['A\tadded.txt', 'D\tdoomed.txt']);
    expect(debugSpy).toHaveBeenCalledWith(
      expect.objectContaining({ root: tempDir, count: 1 }),
      'Dropping missing, untracked paths from batch',
    );
  });

  it('stages nothing and succeeds when every path vanished untracked', async () => {
    await expect(
      stageBatch(
        [join(tempDir, 'a.txt'), join(tempDir, 'b.txt')],
        tempDir,
        pino({ level: 'silent' }),
      ),
    ).resolves.toBeUndefined();
    expect(await git(tempDir, 'diff', '--cached', '--name-only')).toBe('');
  });
});
