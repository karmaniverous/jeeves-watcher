/**
 * @module vcs/SquashManager.mechanism.test
 * Tests for the core SquashManager.runSquash mechanism: produces the
 * correct commit structure (1 baseline + N recent), is a no-op when
 * within the retention window, aborts on an index.lock collision, is a
 * no-op for single-commit repos, and honors a configured branch name
 * instead of dynamic detection (Bug 1). Retention boundary math lives in
 * SquashManager.retention.test.ts; push/pause behavior lives in
 * SquashManager.pushAndPause.test.ts.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { execFileAsync } from '../test/git';
import {
  commitCount,
  createCommit,
  initTestRepo,
  makeRetention,
} from '../test/squashRepo';
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
});
