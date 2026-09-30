/**
 * @module vcs/VcsManager.circuitBreaker.test
 * VcsManager circuit breaker behavior: trips after N consecutive failures
 * and retains pending files, does not reset on fileChanged while tripped,
 * resets the failure counter after a successful commit, re-queued files
 * commit on the next flush without needing a new fileChanged (Bug 2), and
 * a "nothing to commit" git error is excluded from the failure count
 * (Bug 5).
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

  describe('circuit breaker', () => {
    it('trips after N consecutive failures and retains pending files', async () => {
      const logger = pino({ level: 'silent' });
      const errorSpy = vi.spyOn(logger, 'error');

      const config = makeConfig({
        maxConsecutiveFailures: 2,
        staleLockThresholdMs: 600000,
      });
      const manager = new VcsManager(tempDir, config, logger);
      await manager.start();

      const lockPath = join(tempDir, '.git', 'index.lock');
      await writeFile(lockPath, '', 'utf8');

      // First failure — re-queues
      const file1 = join(tempDir, 'cb1.txt');
      await writeFile(file1, 'content', 'utf8');
      manager.fileChanged(file1);
      await manager.flush();

      // Second failure — re-queues, counter = 2 → trips
      await manager.flush();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          root: tempDir,
        }),
        expect.stringContaining('circuit breaker tripped'),
      );

      // Tripped: a further flush re-queues without attempting a commit, and
      // the file is retained (never discarded). See #249.
      await manager.flush();
      expect(manager.breakerState).toMatchObject({
        tripped: true,
        consecutiveFailures: 2,
        pendingCount: 1,
      });

      await manager.stop();
      await rm(lockPath, { force: true });
    }, 30000);

    it('does not reset the circuit breaker when fileChanged is called after tripping', async () => {
      const logger = pino({ level: 'silent' });
      const infoSpy = vi.spyOn(logger, 'info');

      const config = makeConfig({
        maxConsecutiveFailures: 2,
        staleLockThresholdMs: 600000,
      });
      const manager = new VcsManager(tempDir, config, logger);
      await manager.start();

      const lockPath = join(tempDir, '.git', 'index.lock');
      await writeFile(lockPath, '', 'utf8');

      // Two failures to trip the breaker
      const file1 = join(tempDir, 'cbreset1.txt');
      await writeFile(file1, 'content', 'utf8');
      manager.fileChanged(file1);
      await manager.flush();
      await manager.flush();

      // A new file change must NOT reset the breaker (recovery is time-based)
      const file2 = join(tempDir, 'cbreset2.txt');
      await writeFile(file2, 'content', 'utf8');
      manager.fileChanged(file2);

      expect(infoSpy).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('circuit breaker reset'),
      );
      expect(manager.breakerState.tripped).toBe(true);
      expect(manager.breakerState.pendingCount).toBe(2);

      await manager.stop();
      await rm(lockPath, { force: true });
    }, 30000);

    it('resets counter after a successful commit', async () => {
      const logger = pino({ level: 'silent' });
      const errorSpy = vi.spyOn(logger, 'error');

      const config = makeConfig({
        maxConsecutiveFailures: 2,
        staleLockThresholdMs: 600000,
      });
      const manager = new VcsManager(tempDir, config, logger);
      await manager.start();

      const lockPath = join(tempDir, '.git', 'index.lock');
      await writeFile(lockPath, '', 'utf8');

      // Fail once
      const file1 = join(tempDir, 'reset1.txt');
      await writeFile(file1, 'content', 'utf8');
      manager.fileChanged(file1);
      await manager.flush(); // counter=1
      expect(manager.breakerState.consecutiveFailures).toBe(1);

      // Remove lock and succeed — counter resets to 0
      await rm(lockPath, { force: true });
      await manager.flush();

      expect(await commitCount(tempDir)).toBe(1);
      expect(manager.breakerState.consecutiveFailures).toBe(0);
      expect(manager.breakerState.lastError).toBeNull();

      // Create lock again: one failure must NOT trip (counter was reset)
      await writeFile(lockPath, '', 'utf8');
      const file2 = join(tempDir, 'reset2.txt');
      await writeFile(file2, 'content', 'utf8');
      manager.fileChanged(file2);
      await manager.flush(); // fail 1 → counter=1
      expect(manager.breakerState.tripped).toBe(false);

      await manager.flush(); // fail 2 → counter=2 → trips
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ root: tempDir }),
        expect.stringContaining('circuit breaker tripped'),
      );
      expect(manager.breakerState.tripped).toBe(true);

      await manager.stop();
      await rm(lockPath, { force: true });
    }, 60000);
  });

  describe('retry timer after failure (Bug 2)', () => {
    it('re-queued files commit on next flush without needing fileChanged', async () => {
      const config = makeConfig({
        staleLockThresholdMs: 600000,
      });
      const logger = pino({ level: 'silent' });
      const manager = new VcsManager(tempDir, config, logger);
      await manager.start();
      manager.endBaseline();

      // Create index.lock to force failure
      const lockPath = join(tempDir, '.git', 'index.lock');
      await writeFile(lockPath, '', 'utf8');

      const filePath = join(tempDir, 'retry-timer.txt');
      await writeFile(filePath, 'content', 'utf8');
      manager.fileChanged(filePath);

      // Flush triggers commitBatch which fails and re-queues
      await manager.flush();

      // Remove lock so next attempt succeeds
      await rm(lockPath, { force: true });

      // Without Bug 2 fix, re-queued files would sit forever.
      // With the fix, resetThrottle() was called, so flush() finds them.
      await manager.flush();

      // The re-queued file should have committed successfully
      expect(await commitCount(tempDir)).toBe(1);
    }, 30000);
  });

  describe('nothing to commit exclusion (Bug 5)', () => {
    it('does not increment circuit breaker on nothing-to-commit error', async () => {
      const logger = pino({ level: 'silent' });
      const infoSpy = vi.spyOn(logger, 'info');

      const config = makeConfig({ maxConsecutiveFailures: 2 });
      const manager = new VcsManager(tempDir, config, logger);
      await manager.start();
      manager.endBaseline();

      // Create and commit a file, then try to commit the same file without changes
      const filePath = join(tempDir, 'no-change.txt');
      await writeFile(filePath, 'content', 'utf8');
      await execFileAsync('git', ['add', '.'], { cwd: tempDir });
      await execFileAsync('git', ['commit', '-m', 'initial'], {
        cwd: tempDir,
      });

      // File hasn't changed but we report it — git commit will say "nothing to commit"
      manager.fileChanged(filePath);
      await manager.flush();

      // Should log info about nothing to commit, not error
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ root: tempDir }),
        expect.stringContaining('nothing staged'),
      );

      // Circuit breaker should NOT have been tripped
      // Verify by adding a real change that should succeed
      const file2 = join(tempDir, 'real-change.txt');
      await writeFile(file2, 'new content', 'utf8');
      manager.fileChanged(file2);
      await manager.flush();

      expect(await commitCount(tempDir)).toBe(2);
    }, 30000);
  });
});
