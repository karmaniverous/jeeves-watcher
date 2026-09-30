/**
 * @module vcs/VcsManager.lockHandling.test
 * VcsManager index.lock handling: transient contention is retried and
 * eventually gives up with a logged error, failed batches are re-queued
 * for the next flush, and stale locks are force-removed while fresh ones
 * are left alone.
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

describe('VcsManager instance', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempRepo('vcs-instance-');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('index.lock retry', () => {
    it('retries on index.lock contention', async () => {
      const logger = pino({ level: 'silent' });
      const warnSpy = vi.spyOn(logger, 'warn');

      const manager = new VcsManager(tempDir, makeConfig(), logger);
      await manager.start();
      manager.endBaseline();

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
      await manager.start();

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
    }, 30000);

    it('re-queues files on commit failure so next flush retries', async () => {
      const logger = pino({ level: 'silent' });
      const warnSpy = vi.spyOn(logger, 'warn');

      const manager = new VcsManager(tempDir, makeConfig(), logger);
      await manager.start();

      // Create index.lock to force failure
      const lockPath = join(tempDir, '.git', 'index.lock');
      await writeFile(lockPath, '', 'utf8');

      const filePath = join(tempDir, 'requeue-test.txt');
      await writeFile(filePath, 'content', 'utf8');
      manager.fileChanged(filePath);

      await manager.flush();

      // Should have re-queued
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ fileCount: 1 }),
        'Re-queued files after commit failure',
      );

      // Remove lock and flush again — should now commit
      await rm(lockPath, { force: true });
      await manager.flush();

      expect(await commitCount(tempDir)).toBe(1);
      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '-1'],
        { cwd: tempDir },
      );
      expect(stdout).toContain('1 files');
    }, 30000);
  });

  describe('stale lock detection', () => {
    it('force-removes a stale lock file before commit', async () => {
      const logger = pino({ level: 'silent' });
      const warnSpy = vi.spyOn(logger, 'warn');

      const config = makeConfig({ staleLockThresholdMs: 5000 });
      const manager = new VcsManager(tempDir, config, logger);
      await manager.start();
      manager.endBaseline();

      // Create a stale lock file with old mtime
      const lockPath = join(tempDir, '.git', 'index.lock');
      await writeFile(lockPath, '', 'utf8');
      const oldTime = new Date(Date.now() - 10000);
      const { utimes } = await import('node:fs/promises');
      await utimes(lockPath, oldTime, oldTime);

      const filePath = join(tempDir, 'stale-lock.txt');
      await writeFile(filePath, 'content', 'utf8');
      manager.fileChanged(filePath);

      await manager.flush();

      // Should have removed the stale lock and committed
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ root: tempDir }),
        'Removed stale index.lock',
      );
      expect(await commitCount(tempDir)).toBe(1);
    });

    it('does NOT remove a fresh lock file', async () => {
      const logger = pino({ level: 'silent' });
      const errorSpy = vi.spyOn(logger, 'error');

      const config = makeConfig({ staleLockThresholdMs: 60000 });
      const manager = new VcsManager(tempDir, config, logger);
      await manager.start();

      // Create a fresh lock file (mtime = now)
      const lockPath = join(tempDir, '.git', 'index.lock');
      await writeFile(lockPath, '', 'utf8');

      const filePath = join(tempDir, 'fresh-lock.txt');
      await writeFile(filePath, 'content', 'utf8');
      manager.fileChanged(filePath);

      await manager.flush();

      // Should have failed (lock not removed) and logged error
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ root: tempDir }),
        'VCS commit failed',
      );

      await rm(lockPath, { force: true });
    }, 30000);
  });
});
