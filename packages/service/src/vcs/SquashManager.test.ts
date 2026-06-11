/**
 * @module vcs/SquashManager.test
 * Tests for SquashManager: retention boundary, squash mechanism, cron matching.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { VcsRetentionConfig } from '@karmaniverous/jeeves-watcher-core';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cronMatchesNow, SquashManager } from './SquashManager';

const execFileAsync = promisify(execFile);

const silentLogger = pino({ level: 'silent' });

function makeRetention(
  overrides: Partial<VcsRetentionConfig> = {},
): VcsRetentionConfig {
  return {
    maxAgeDays: 30,
    maxVersions: 100,
    squashCron: '0 0 * * *',
    ...overrides,
  };
}

async function commitCount(cwd: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-list', '--count', 'HEAD'],
      { cwd },
    );
    return parseInt(stdout.trim(), 10);
  } catch {
    return 0;
  }
}

async function initTestRepo(tempDir: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: tempDir });
  await execFileAsync('git', ['config', 'user.email', 'test@test.com'], {
    cwd: tempDir,
  });
  await execFileAsync('git', ['config', 'user.name', 'Test'], {
    cwd: tempDir,
  });
}

async function createCommit(
  cwd: string,
  filename: string,
  content: string,
  dateIso?: string,
): Promise<string> {
  await writeFile(join(cwd, filename), content, 'utf8');
  await execFileAsync('git', ['add', filename], { cwd });

  const env: Record<string, string> = { ...process.env } as Record<
    string,
    string
  >;
  if (dateIso) {
    env['GIT_AUTHOR_DATE'] = dateIso;
    env['GIT_COMMITTER_DATE'] = dateIso;
  }

  await execFileAsync('git', ['commit', '-m', `add ${filename}`], {
    cwd,
    env,
  });

  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd,
  });
  return stdout.trim();
}

// ─── cronMatchesNow ───

describe('cronMatchesNow', () => {
  it('matches wildcard expression', () => {
    expect(cronMatchesNow('* * * * *')).toBe(true);
  });

  it('matches specific minute and hour', () => {
    const now = new Date(2024, 5, 15, 14, 30); // June 15, 2024 14:30
    expect(cronMatchesNow('30 14 * * *', now)).toBe(true);
    expect(cronMatchesNow('31 14 * * *', now)).toBe(false);
  });

  it('matches step expression */5', () => {
    const at0 = new Date(2024, 0, 1, 0, 0);
    const at5 = new Date(2024, 0, 1, 0, 5);
    const at3 = new Date(2024, 0, 1, 0, 3);
    expect(cronMatchesNow('*/5 * * * *', at0)).toBe(true);
    expect(cronMatchesNow('*/5 * * * *', at5)).toBe(true);
    expect(cronMatchesNow('*/5 * * * *', at3)).toBe(false);
  });

  it('matches range expression', () => {
    const at3 = new Date(2024, 0, 1, 3, 0);
    const at6 = new Date(2024, 0, 1, 6, 0);
    expect(cronMatchesNow('0 1-5 * * *', at3)).toBe(true);
    expect(cronMatchesNow('0 1-5 * * *', at6)).toBe(false);
  });

  it('matches list expression', () => {
    const at0 = new Date(2024, 0, 1, 0, 0);
    const at15 = new Date(2024, 0, 1, 0, 15);
    const at10 = new Date(2024, 0, 1, 0, 10);
    expect(cronMatchesNow('0,15,30,45 * * * *', at0)).toBe(true);
    expect(cronMatchesNow('0,15,30,45 * * * *', at15)).toBe(true);
    expect(cronMatchesNow('0,15,30,45 * * * *', at10)).toBe(false);
  });

  it('matches day of week (Sunday=0 or 7)', () => {
    // June 16, 2024 is a Sunday
    const sunday = new Date(2024, 5, 16, 0, 0);
    expect(cronMatchesNow('0 0 * * 0', sunday)).toBe(true);
    expect(cronMatchesNow('0 0 * * 7', sunday)).toBe(true);
    expect(cronMatchesNow('0 0 * * 1', sunday)).toBe(false);
  });

  it('returns false for invalid expression', () => {
    expect(cronMatchesNow('invalid')).toBe(false);
  });
});

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
  });

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
      remoteUrl,
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
});
