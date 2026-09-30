/**
 * @module vcs/SquashManager.test
 * Tests for SquashManager: retention boundary and squash mechanism.
 * Safety guards live in SquashManager.guards.test.ts; cron matching in
 * cronMatch.test.ts.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startDroppingRemote } from '../test/droppingRemote';
import { execFileAsync } from '../test/git';
import {
  commitCount,
  createCommit,
  initTestRepo,
  makeRetention,
} from '../test/squashRepo';
import { SquashManager } from './SquashManager';

const silentLogger = pino({ level: 'silent' });

// ─── Retention boundary calculation ───

describe('SquashManager.calculateRetentionBoundary', () => {
  it('age constraint wins when it is tighter', () => {
    const manager = new SquashManager(
      '/tmp/test',
      makeRetention({ maxAgeDays: 7, maxVersions: 100 }),
      silentLogger,
    );

    const now = new Date();
    const commits = [
      { hash: 'a', date: new Date(now.getTime() - 20 * 86400000) }, // 20 days ago
      { hash: 'b', date: new Date(now.getTime() - 10 * 86400000) }, // 10 days ago
      { hash: 'c', date: new Date(now.getTime() - 5 * 86400000) }, // 5 days ago
      { hash: 'd', date: new Date(now.getTime() - 1 * 86400000) }, // 1 day ago
    ];

    // maxAgeDays=7: commits a,b are older than 7 days -> ageBoundary=2 (c is first to keep)
    // maxVersions=100: countBoundary=0 (all 4 within 100)
    // tighter=max(2,0)=2
    const boundary = manager.calculateRetentionBoundary(commits);
    expect(boundary).toBe(2);
  });

  it('count constraint wins when it is tighter', () => {
    const manager = new SquashManager(
      '/tmp/test',
      makeRetention({ maxAgeDays: 365, maxVersions: 2 }),
      silentLogger,
    );

    const now = new Date();
    const commits = [
      { hash: 'a', date: new Date(now.getTime() - 5 * 86400000) },
      { hash: 'b', date: new Date(now.getTime() - 3 * 86400000) },
      { hash: 'c', date: new Date(now.getTime() - 2 * 86400000) },
      { hash: 'd', date: new Date(now.getTime() - 1 * 86400000) },
    ];

    // maxAgeDays=365: all within range -> ageBoundary=0
    // maxVersions=2: countBoundary=4-2=2
    // tighter=max(0,2)=2
    const boundary = manager.calculateRetentionBoundary(commits);
    expect(boundary).toBe(2);
  });

  it('returns 0 when all commits are within both constraints', () => {
    const manager = new SquashManager(
      '/tmp/test',
      makeRetention({ maxAgeDays: 365, maxVersions: 100 }),
      silentLogger,
    );

    const now = new Date();
    const commits = [
      { hash: 'a', date: new Date(now.getTime() - 5 * 86400000) },
      { hash: 'b', date: new Date(now.getTime() - 1 * 86400000) },
    ];

    const boundary = manager.calculateRetentionBoundary(commits);
    expect(boundary).toBe(0);
  });
});

// ─── Squash mechanism ───

describe('SquashManager.runSquash', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vcs-squash-'));
    await initTestRepo(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('produces correct commit structure (1 baseline + N recent)', async () => {
    const now = new Date();
    // Create 5 commits: 3 old (beyond retention), 2 recent
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
      new Date(now.getTime() - 40 * 86400000).toISOString(),
    );
    await createCommit(
      tempDir,
      'file4.txt',
      'd',
      new Date(now.getTime() - 5 * 86400000).toISOString(),
    );
    await createCommit(
      tempDir,
      'file5.txt',
      'e',
      new Date(now.getTime() - 1 * 86400000).toISOString(),
    );

    expect(await commitCount(tempDir)).toBe(5);

    const manager = new SquashManager(
      tempDir,
      makeRetention({ maxAgeDays: 30, maxVersions: 100 }),
      silentLogger,
    );

    const result = await manager.runSquash();

    expect(result.squashed).toBe(true);
    expect(result.commitsRemoved).toBe(3);
    expect(result.commitsRetained).toBe(2);

    // Should now have 1 baseline + 2 retained = 3 commits
    expect(await commitCount(tempDir)).toBe(3);

    // First commit should be the baseline
    const { stdout: logOut } = await execFileAsync(
      'git',
      ['log', '--oneline', '--reverse'],
      { cwd: tempDir },
    );
    const lines = logOut.trim().split('\n');
    expect(lines[0]).toContain('historical baseline');

    // All files should still be present
    const { stdout: lsOut } = await execFileAsync(
      'git',
      ['ls-tree', '--name-only', 'HEAD'],
      { cwd: tempDir },
    );
    expect(lsOut).toContain('file1.txt');
    expect(lsOut).toContain('file5.txt');
  }, 30000);

  it('is a no-op when within retention window', async () => {
    const now = new Date();
    // All commits are recent
    await createCommit(
      tempDir,
      'file1.txt',
      'a',
      new Date(now.getTime() - 2 * 86400000).toISOString(),
    );
    await createCommit(
      tempDir,
      'file2.txt',
      'b',
      new Date(now.getTime() - 1 * 86400000).toISOString(),
    );

    const manager = new SquashManager(
      tempDir,
      makeRetention({ maxAgeDays: 30, maxVersions: 100 }),
      silentLogger,
    );

    const result = await manager.runSquash();
    expect(result.squashed).toBe(false);
    expect(await commitCount(tempDir)).toBe(2);
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

  it('aborts on index.lock collision', async () => {
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

    // Create index.lock
    const lockPath = join(tempDir, '.git', 'index.lock');
    await writeFile(lockPath, '', 'utf8');

    const manager = new SquashManager(
      tempDir,
      makeRetention({ maxAgeDays: 30, maxVersions: 100 }),
      silentLogger,
    );

    const result = await manager.runSquash();
    expect(result.squashed).toBe(false);
    expect(result.error).toBe('index.lock exists');

    // Repo unchanged
    expect(await commitCount(tempDir)).toBe(2);

    await rm(lockPath, { force: true });
  });

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

  it('handles single commit repo (no-op)', async () => {
    await createCommit(tempDir, 'file1.txt', 'a');

    const manager = new SquashManager(
      tempDir,
      makeRetention({ maxAgeDays: 1, maxVersions: 1 }),
      silentLogger,
    );

    const result = await manager.runSquash();
    expect(result.squashed).toBe(false);
    expect(await commitCount(tempDir)).toBe(1);
  });

  it('uses configured branch name instead of dynamic detection (Bug 1)', async () => {
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

    // Rename the default branch to 'main' to verify configured name is used
    await execFileAsync('git', ['branch', '-M', 'main'], { cwd: tempDir });

    const manager = new SquashManager(
      tempDir,
      makeRetention({ maxAgeDays: 30, maxVersions: 100 }),
      silentLogger,
      { branch: 'main' },
    );

    const result = await manager.runSquash();
    expect(result.squashed).toBe(true);

    // Verify we're on the configured branch
    const { stdout: branchOut } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: tempDir },
    );
    expect(branchOut.trim()).toBe('main');
  }, 30000);

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
