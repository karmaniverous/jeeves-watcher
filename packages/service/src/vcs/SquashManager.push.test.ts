/**
 * @module vcs/SquashManager.push.test
 * Tests for SquashManager.runSquash force push: force-pushes the squashed
 * history to a configured remote and logs (without throwing) a failed
 * force push even when a token is set. Commit structure/branch tests live
 * in SquashManager.mechanism.test.ts.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startDroppingRemote } from '../test/droppingRemote';
import { execFileAsync } from '../test/git';
import {
  createCommit,
  initTestRepo,
  makeRetention,
  makeSquashManager,
} from '../test/squashRepo';

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

    const manager = makeSquashManager(
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
    const manager = makeSquashManager(
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
    // Real git subprocesses: same budget as the force-push test above (the
    // default 5s timed out under full-suite load on Windows).
  }, 30000);
});
