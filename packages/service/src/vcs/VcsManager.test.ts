/**
 * @module vcs/VcsManager.test
 * Tests for VcsManager static and instance methods.
 */

import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { VcsConfig } from '@karmaniverous/jeeves-watcher-core';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VcsManager } from './VcsManager';

const execFileAsync = promisify(execFile);

const silentLogger = pino({ level: 'silent' });

function makeConfig(overrides: Partial<VcsConfig> = {}): VcsConfig {
  return {
    enabled: true,
    commitDebounceMs: 5000,
    maxBatchSize: 1000,
    ...overrides,
  };
}

/**
 * Count commits in the repo. Returns 0 for repos with no commits.
 */
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

// ─── Static methods ───

describe('VcsManager.checkGitAvailable', () => {
  it('returns true when git is available', async () => {
    const result = await VcsManager.checkGitAvailable();
    expect(result).toBe(true);
  });
});

describe('VcsManager.initRepo', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vcs-init-'));
  });

  it('initializes a git repo in an empty directory', async () => {
    await VcsManager.initRepo(tempDir);
    await expect(access(join(tempDir, '.git'))).resolves.toBeUndefined();
  });

  it('is idempotent — does not fail on existing repo', async () => {
    await VcsManager.initRepo(tempDir);
    await VcsManager.initRepo(tempDir);
    await expect(access(join(tempDir, '.git'))).resolves.toBeUndefined();
  });
});

describe('VcsManager.ensureGitignore', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vcs-gitignore-'));
  });

  it('creates .gitignore with default entries when file does not exist', async () => {
    await VcsManager.ensureGitignore(tempDir);
    const content = await readFile(join(tempDir, '.gitignore'), 'utf8');
    expect(content).toContain('.git/');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.jeeves-watcher/');
    expect(content).toContain('.jeeves-metadata/');
  });

  it('appends missing entries to existing .gitignore', async () => {
    await writeFile(
      join(tempDir, '.gitignore'),
      '.git/\ncustom-entry\n',
      'utf8',
    );
    await VcsManager.ensureGitignore(tempDir);
    const content = await readFile(join(tempDir, '.gitignore'), 'utf8');
    expect(content).toContain('.git/');
    expect(content).toContain('custom-entry');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.jeeves-watcher/');
    expect(content).toContain('.jeeves-metadata/');
    // Should not duplicate .git/
    const gitEntries = content.split('\n').filter((l) => l.trim() === '.git/');
    expect(gitEntries).toHaveLength(1);
  });

  it('does nothing when all entries already present', async () => {
    const existing =
      '.git/\nnode_modules/\n.jeeves-watcher/\n.jeeves-metadata/\n';
    await writeFile(join(tempDir, '.gitignore'), existing, 'utf8');
    await VcsManager.ensureGitignore(tempDir);
    const content = await readFile(join(tempDir, '.gitignore'), 'utf8');
    expect(content).toBe(existing);
  });

  it('handles existing file without trailing newline', async () => {
    await writeFile(
      join(tempDir, '.gitignore'),
      '.git/\nnode_modules/',
      'utf8',
    );
    await VcsManager.ensureGitignore(tempDir);
    const content = await readFile(join(tempDir, '.gitignore'), 'utf8');
    expect(content).toContain('.jeeves-watcher/');
    expect(content).toContain('.jeeves-metadata/');
    const lines = content.split('\n');
    expect(lines.filter((l) => l.length > 0).length).toBeGreaterThanOrEqual(4);
  });

  it('includes custom always-on entries', async () => {
    await VcsManager.ensureGitignore(tempDir, ['*.log', 'tmp/']);
    const content = await readFile(join(tempDir, '.gitignore'), 'utf8');
    expect(content).toContain('*.log');
    expect(content).toContain('tmp/');
  });
});

// ─── Instance methods ───

describe('VcsManager instance', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vcs-instance-'));
    await VcsManager.initRepo(tempDir);
    // Configure git user for commits
    await execFileAsync('git', ['config', 'user.email', 'test@test.com'], {
      cwd: tempDir,
    });
    await execFileAsync('git', ['config', 'user.name', 'Test'], {
      cwd: tempDir,
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('flush', () => {
    it('commits pending files to git', async () => {
      const manager = new VcsManager(tempDir, makeConfig(), silentLogger);
      manager.start();

      const filePath = join(tempDir, 'test.txt');
      await writeFile(filePath, 'hello', 'utf8');
      manager.fileChanged(filePath);

      await manager.flush();

      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: tempDir },
      );
      expect(stdout).toContain('watcher: batch');
      expect(stdout).toContain('1 files');
    });

    it('is a no-op when pending set is empty', async () => {
      // Create an initial commit so git log doesn't fail
      const filePath = join(tempDir, 'initial.txt');
      await writeFile(filePath, 'init', 'utf8');
      await execFileAsync('git', ['add', '.'], { cwd: tempDir });
      await execFileAsync('git', ['commit', '-m', 'initial'], {
        cwd: tempDir,
      });

      const manager = new VcsManager(tempDir, makeConfig(), silentLogger);
      manager.start();

      const { stdout: before } = await execFileAsync(
        'git',
        ['rev-parse', 'HEAD'],
        { cwd: tempDir },
      );
      await manager.flush();
      const { stdout: after } = await execFileAsync(
        'git',
        ['rev-parse', 'HEAD'],
        { cwd: tempDir },
      );

      expect(after).toBe(before);
    });

    it('handles multiple files in a single commit', async () => {
      const manager = new VcsManager(tempDir, makeConfig(), silentLogger);
      manager.start();

      for (let i = 0; i < 5; i++) {
        const filePath = join(tempDir, `file${String(i)}.txt`);
        await writeFile(filePath, `content ${String(i)}`, 'utf8');
        manager.fileChanged(filePath);
      }

      await manager.flush();

      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: tempDir },
      );
      expect(stdout).toContain('5 files');
    });
  });

  describe('handleUnlink', () => {
    it('stages file deletion in pending set', async () => {
      const manager = new VcsManager(tempDir, makeConfig(), silentLogger);
      manager.start();

      // Create and commit a file first
      const filePath = join(tempDir, 'to-delete.txt');
      await writeFile(filePath, 'delete me', 'utf8');
      await execFileAsync('git', ['add', '.'], { cwd: tempDir });
      await execFileAsync('git', ['commit', '-m', 'add file'], {
        cwd: tempDir,
      });

      // Delete the file from disk then notify VCS
      await rm(filePath);
      manager.handleUnlink(filePath);

      await manager.flush();

      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: tempDir },
      );
      expect(stdout).toContain('watcher: batch');

      // Verify file is gone from git tracking
      const { stdout: status } = await execFileAsync('git', ['status'], {
        cwd: tempDir,
      });
      expect(status).toContain('nothing to commit');
    });
  });

  describe('debounce', () => {
    it('resets debounce timer on each fileChanged call', async () => {
      vi.useFakeTimers();

      const config = makeConfig({ commitDebounceMs: 5000 });
      const manager = new VcsManager(tempDir, config, silentLogger);
      manager.start();

      // Mock flush to avoid real git operations with fake timers
      const flushSpy = vi.spyOn(manager, 'flush').mockResolvedValue(undefined);

      const filePath = join(tempDir, 'debounce.txt');
      manager.fileChanged(filePath);

      // Advance 3 seconds — flush should not fire yet
      await vi.advanceTimersByTimeAsync(3000);
      expect(flushSpy).not.toHaveBeenCalled();

      // File changed again — resets the timer
      manager.fileChanged(filePath);

      // Advance 3 more seconds (6 total, but only 3 since last change)
      await vi.advanceTimersByTimeAsync(3000);
      expect(flushSpy).not.toHaveBeenCalled();

      // Advance 2 more seconds (5 total since last change) — flush fires
      await vi.advanceTimersByTimeAsync(2000);
      expect(flushSpy).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  describe('maxBatchSize', () => {
    it('flushes immediately when pending exceeds maxBatchSize', async () => {
      const config = makeConfig({
        maxBatchSize: 3,
        commitDebounceMs: 60000,
      });
      const manager = new VcsManager(tempDir, config, silentLogger);
      manager.start();

      for (let i = 0; i < 3; i++) {
        const filePath = join(tempDir, `file${String(i)}.txt`);
        await writeFile(filePath, `content ${String(i)}`, 'utf8');
        manager.fileChanged(filePath);
      }

      // maxBatchSize triggers commitBatch inline; flush awaits the in-flight commit
      await manager.flush();

      expect(await commitCount(tempDir)).toBe(1);
      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: tempDir },
      );
      expect(stdout).toContain('3 files');
    });

    it('starts new timer for overflow when batch exceeds maxBatchSize', async () => {
      const config = makeConfig({
        maxBatchSize: 2,
        commitDebounceMs: 1000,
      });
      const manager = new VcsManager(tempDir, config, silentLogger);
      manager.start();

      // Create 3 files — 2 should commit immediately, 1 starts new timer
      for (let i = 0; i < 3; i++) {
        const filePath = join(tempDir, `overflow${String(i)}.txt`);
        await writeFile(filePath, `content ${String(i)}`, 'utf8');
        manager.fileChanged(filePath);
      }

      // Wait for in-flight batch to complete, then wait for debounce on overflow
      await manager.flush();

      // Should have 2 commits: one from maxBatchSize (2 files), one from flush (1 file)
      expect(await commitCount(tempDir)).toBe(2);
    });
  });

  describe('stop', () => {
    it('flushes pending changes on stop', async () => {
      const manager = new VcsManager(tempDir, makeConfig(), silentLogger);
      manager.start();

      const filePath = join(tempDir, 'stop-test.txt');
      await writeFile(filePath, 'should be committed on stop', 'utf8');
      manager.fileChanged(filePath);

      await manager.stop();

      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: tempDir },
      );
      expect(stdout).toContain('watcher: batch');
    });

    it('ignores fileChanged calls after stop', async () => {
      const manager = new VcsManager(tempDir, makeConfig(), silentLogger);
      manager.start();

      const file1 = join(tempDir, 'before-stop.txt');
      await writeFile(file1, 'before', 'utf8');
      manager.fileChanged(file1);

      await manager.stop();

      // After stop, fileChanged should be ignored
      const file2 = join(tempDir, 'after-stop.txt');
      await writeFile(file2, 'after', 'utf8');
      manager.fileChanged(file2);

      await manager.flush();

      // Only the first file should have been committed
      expect(await commitCount(tempDir)).toBe(1);
      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: tempDir },
      );
      expect(stdout).toContain('1 files');
    });
  });

  describe('index.lock retry', () => {
    it('retries on index.lock contention', async () => {
      const logger = pino({ level: 'silent' });
      const warnSpy = vi.spyOn(logger, 'warn');

      const manager = new VcsManager(tempDir, makeConfig(), logger);
      manager.start();

      // Create index.lock to simulate contention
      const lockPath = join(tempDir, '.git', 'index.lock');
      await writeFile(lockPath, '', 'utf8');

      const filePath = join(tempDir, 'lock-test.txt');
      await writeFile(filePath, 'content', 'utf8');
      manager.fileChanged(filePath);

      // Remove the lock after a short delay to let retry succeed
      setTimeout(() => {
        void rm(lockPath, { force: true });
      }, 300);

      await manager.flush();

      // Should have retried (warn was called with index.lock contention message)
      expect(warnSpy).toHaveBeenCalled();

      // The commit should eventually succeed
      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: tempDir },
      );
      expect(stdout).toContain('watcher: batch');
    });

    it('gives up after max retries and logs error', async () => {
      const logger = pino({ level: 'silent' });
      const errorSpy = vi.spyOn(logger, 'error');

      const manager = new VcsManager(tempDir, makeConfig(), logger);
      manager.start();

      // Create index.lock and keep it there
      const lockPath = join(tempDir, '.git', 'index.lock');
      await writeFile(lockPath, '', 'utf8');

      const filePath = join(tempDir, 'lock-fail.txt');
      await writeFile(filePath, 'content', 'utf8');
      manager.fileChanged(filePath);

      await manager.flush();

      // Should have logged an error after exhausting retries
      expect(errorSpy).toHaveBeenCalled();

      // Clean up
      await rm(lockPath, { force: true });
    });
  });
});
