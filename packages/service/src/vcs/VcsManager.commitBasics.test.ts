/**
 * @module vcs/VcsManager.commitBasics.test
 * Core VcsManager commit-pipeline behavior: flush batches pending files
 * into a single commit, handleUnlink stages deletions, the throttle timer
 * does not reset on repeated changes, maxBatchSize triggers inline commits
 * with overflow handling, and stop() flushes and disables further changes.
 */

import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execFileAsync } from '../test/git';
import {
  commitCount,
  makeFastVcsConfig as makeConfig,
  makeTempRepo,
} from '../test/vcsRepo';
import { VcsManager } from './VcsManager';

const silentLogger = pino({ level: 'silent' });

describe('VcsManager instance', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempRepo('vcs-instance-');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('flush', () => {
    it('commits pending files to git', async () => {
      const manager = new VcsManager(tempDir, makeConfig(), silentLogger);
      await manager.start();
      manager.endBaseline();

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
      await manager.start();

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
      await manager.start();

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
      await manager.start();
      manager.endBaseline();

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

  describe('throttle', () => {
    it('does not reset throttle timer on subsequent fileChanged calls', async () => {
      vi.useFakeTimers();

      const config = makeConfig({ commitThrottleMs: 5000 });
      const manager = new VcsManager(tempDir, config, silentLogger);
      await manager.start();

      // Mock flush to avoid real git operations with fake timers
      const flushSpy = vi.spyOn(manager, 'flush').mockResolvedValue(undefined);

      const filePath = join(tempDir, 'throttle.txt');
      manager.fileChanged(filePath);

      // Advance 3 seconds — flush should not fire yet
      await vi.advanceTimersByTimeAsync(3000);
      expect(flushSpy).not.toHaveBeenCalled();

      // File changed again — does NOT reset the timer (throttle, not debounce)
      manager.fileChanged(filePath);

      // Advance 2 more seconds (5 total since first change) — flush fires
      await vi.advanceTimersByTimeAsync(2000);
      expect(flushSpy).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  describe('maxBatchSize', () => {
    it('flushes immediately when pending exceeds maxBatchSize', async () => {
      const config = makeConfig({
        maxBatchSize: 3,
        commitThrottleMs: 60000,
      });
      const manager = new VcsManager(tempDir, config, silentLogger);
      await manager.start();

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
        commitThrottleMs: 1000,
      });
      const manager = new VcsManager(tempDir, config, silentLogger);
      await manager.start();

      // Create 3 files — 2 should commit immediately, 1 starts new timer
      for (let i = 0; i < 3; i++) {
        const filePath = join(tempDir, `overflow${String(i)}.txt`);
        await writeFile(filePath, `content ${String(i)}`, 'utf8');
        manager.fileChanged(filePath);
      }

      // Wait for in-flight batch to complete, then wait for throttle on overflow
      await manager.flush();

      // Should have 2 commits: one from maxBatchSize (2 files), one from flush (1 file)
      expect(await commitCount(tempDir)).toBe(2);
    });
  });

  describe('stop', () => {
    it('flushes pending changes on stop', async () => {
      const manager = new VcsManager(tempDir, makeConfig(), silentLogger);
      await manager.start();
      manager.endBaseline();

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
      await manager.start();

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
});
