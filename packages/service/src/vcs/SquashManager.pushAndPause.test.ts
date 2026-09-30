/**
 * @module vcs/SquashManager.pushAndPause.test
 * Tests for SquashManager.runSquash push and pause/resume coordination:
 * force-pushes the squashed history to a configured remote, logs (without
 * throwing) a failed force push even when a token is set, and always
 * calls the pause/resume callbacks around the squash — including when
 * pause itself throws (Bug 3) and when the squash is a no-op. Commit
 * structure/branch tests live in SquashManager.mechanism.test.ts.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startDroppingRemote } from '../test/droppingRemote';
import { execFileAsync } from '../test/git';
import { createCommit, initTestRepo, makeRetention } from '../test/squashRepo';
import { SquashManager } from './SquashManager';

const silentLogger = pino({ level: 'silent' });

describe('SquashManager.runSquash', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vcs-squash-'));
    await initTestRepo(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('force pushes after squash when remote configured', async () => {
    // Create a bare remote
    const bareRemote = await mkdtemp(join(tmpdir(), 'vcs-bare-squash-'));
    await execFileAsync('git', ['init', '--bare'], { cwd: bareRemote });

    const now = new Date();
    await createCommit(
      tempDir,
      'file1.txt',
      'a',
      new Date(now.getTime() - 60 * 86400000).toISOString(),
    );
    await createCommit(
      tempDir,
      'file2.txt',
      'b',
      new Date(now.getTime() - 50 * 86400000).toISOString(),
    );
    await createCommit(
      tempDir,
      'file3.txt',
      'c',
      new Date(now.getTime() - 1 * 86400000).toISOString(),
    );

    // Push initial history to remote
    const remoteUrl = bareRemote.replace(/\\/g, '/');
    await execFileAsync('git', ['push', remoteUrl, 'HEAD:refs/heads/master'], {
      cwd: tempDir,
    });

    const manager = new SquashManager(
      tempDir,
      makeRetention({ maxAgeDays: 30, maxVersions: 100 }),
      silentLogger,
      { remoteUrl },
    );

    const result = await manager.runSquash();
    expect(result.squashed).toBe(true);

    // Verify remote was force-pushed (commit count changed)
    const { stdout: remoteLog } = await execFileAsync(
      'git',
      ['rev-list', '--count', 'HEAD'],
      { cwd: bareRemote },
    );
    // Should have 1 baseline + 1 retained = 2
    expect(parseInt(remoteLog.trim(), 10)).toBe(2);

    await rm(bareRemote, { recursive: true, force: true });
  }, 30000);

  it('logs a failed force push with a token without throwing', async () => {
    const now = new Date();
    await createCommit(
      tempDir,
      'file1.txt',
      'a',
      new Date(now.getTime() - 60 * 86400000).toISOString(),
    );
    await createCommit(
      tempDir,
      'file2.txt',
      'b',
      new Date(now.getTime() - 50 * 86400000).toISOString(),
    );
    await createCommit(
      tempDir,
      'file3.txt',
      'c',
      new Date(now.getTime() - 1 * 86400000).toISOString(),
    );

    const logger = pino({ level: 'silent' });
    const errorSpy = vi.spyOn(logger, 'error');

    // Token with special characters; local https remote that drops at once
    // (no network, no credential prompt). runSquash awaits git's exit.
    const remote = await startDroppingRemote();
    const manager = new SquashManager(
      tempDir,
      makeRetention({ maxAgeDays: 30, maxVersions: 100 }),
      logger,
      { remoteUrl: remote.url(), accessToken: 'tok/en@special' },
    );

    const result = await manager.runSquash().finally(remote.close);
    expect(result.squashed).toBe(true);
    // Force push will fail (invalid remote) — that's expected
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ root: tempDir }),
      'Squash force push failed',
    );
  });

  it('calls pause/resume callbacks around squash operations (Bug 3)', async () => {
    const now = new Date();
    await createCommit(
      tempDir,
      'file1.txt',
      'a',
      new Date(now.getTime() - 60 * 86400000).toISOString(),
    );
    await createCommit(
      tempDir,
      'file2.txt',
      'b',
      new Date(now.getTime() - 1 * 86400000).toISOString(),
    );

    const callOrder: string[] = [];
    const pauseFn = vi.fn(() => {
      callOrder.push('pause');
      return Promise.resolve();
    });
    const resumeFn = vi.fn(() => {
      callOrder.push('resume');
    });

    const manager = new SquashManager(
      tempDir,
      makeRetention({ maxAgeDays: 30, maxVersions: 100 }),
      silentLogger,
      { pauseCommits: pauseFn, resumeCommits: resumeFn },
    );

    const result = await manager.runSquash();
    expect(result.squashed).toBe(true);
    expect(pauseFn).toHaveBeenCalledTimes(1);
    expect(resumeFn).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['pause', 'resume']);
  }, 30000);

  it('calls resume when pause throws (Bug 3 — Copilot review)', async () => {
    await createCommit(tempDir, 'file1.txt', 'a');

    const pauseFn = vi.fn(() => Promise.reject(new Error('pause failed')));
    const resumeFn = vi.fn(() => {});

    const manager = new SquashManager(
      tempDir,
      makeRetention({ maxAgeDays: 30, maxVersions: 100 }),
      silentLogger,
      { pauseCommits: pauseFn, resumeCommits: resumeFn },
    );

    const result = await manager.runSquash();
    expect(result.squashed).toBe(false);
    expect(result.error).toBe('pause failed');
    // Resume must still be called to avoid leaving the pipeline stuck
    expect(resumeFn).toHaveBeenCalledTimes(1);
  });

  it('calls resume even when squash fails (Bug 3)', async () => {
    // Empty repo — no commits to squash but pause/resume should still be called
    const pauseFn = vi.fn(() => Promise.resolve());
    const resumeFn = vi.fn(() => {});

    const manager = new SquashManager(
      tempDir,
      makeRetention({ maxAgeDays: 30, maxVersions: 100 }),
      silentLogger,
      { pauseCommits: pauseFn, resumeCommits: resumeFn },
    );

    const result = await manager.runSquash();
    expect(result.squashed).toBe(false);
    expect(pauseFn).toHaveBeenCalledTimes(1);
    expect(resumeFn).toHaveBeenCalledTimes(1);
  });
});
