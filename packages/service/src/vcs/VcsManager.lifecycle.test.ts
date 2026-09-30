/**
 * @module vcs/VcsManager.lifecycle.test
 * VcsManager lifecycle edge cases: startup continues even when orphan
 * branch recovery throws (Bug 6), and pause/resume drains pending commits
 * on pause, blocks new commits while paused, and flushes accumulated
 * changes on resume (Bug 3).
 */

import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  commitCount,
  makeFastVcsConfig as makeConfig,
  makeTempRepo,
} from '../test/vcsRepo';
import * as vcsBootstrap from './vcsBootstrap';
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

  describe('start orphan recovery resilience (Bug 6)', () => {
    it('continues startup when orphan recovery throws', async () => {
      const logger = pino({ level: 'silent' });
      const errorSpy = vi.spyOn(logger, 'error');

      // Make detectAndRecoverOrphanBranch throw
      vi.spyOn(
        vcsBootstrap,
        'detectAndRecoverOrphanBranch',
      ).mockRejectedValueOnce(new Error('git not available'));

      const manager = new VcsManager(tempDir, makeConfig(), logger);
      await manager.start();

      // Should have logged the error
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ root: tempDir }),
        'Orphan branch recovery failed — continuing with current state',
      );

      // Manager should still be functional
      manager.endBaseline();
      const filePath = join(tempDir, 'after-recovery-fail.txt');
      await writeFile(filePath, 'content', 'utf8');
      manager.fileChanged(filePath);
      await manager.flush();

      expect(await commitCount(tempDir)).toBe(1);
    });
  });

  describe('pause/resume (Bug 3)', () => {
    it('pause drains pending commits then blocks new commits', async () => {
      const manager = new VcsManager(tempDir, makeConfig(), silentLogger);
      await manager.start();
      manager.endBaseline();

      // Add a file and pause — pause calls flush internally
      const file1 = join(tempDir, 'pre-pause.txt');
      await writeFile(file1, 'content', 'utf8');
      manager.fileChanged(file1);

      await manager.pause();

      // The file should have been committed during pause's flush
      expect(await commitCount(tempDir)).toBe(1);

      // While paused, add another file and flush — should NOT commit
      const file2 = join(tempDir, 'during-pause.txt');
      await writeFile(file2, 'content', 'utf8');
      manager.fileChanged(file2);
      await manager.flush();

      // Still 1 commit — the paused file was re-queued
      expect(await commitCount(tempDir)).toBe(1);

      // Resume and flush — now the file should commit
      manager.resume();
      await manager.flush();

      expect(await commitCount(tempDir)).toBe(2);
    });

    it('resume commits pending files accumulated during pause', async () => {
      const config = makeConfig({ commitThrottleMs: 100 });
      const manager = new VcsManager(tempDir, config, silentLogger);
      await manager.start();
      manager.endBaseline();

      await manager.pause();

      // Add file while paused
      const filePath = join(tempDir, 'resume-timer.txt');
      await writeFile(filePath, 'content', 'utf8');
      manager.fileChanged(filePath);

      // Resume should eventually commit via throttle timer
      manager.resume();

      // Wait for throttle to fire and commit
      await new Promise((r) => {
        setTimeout(r, 300);
      });
      await manager.flush();

      expect(await commitCount(tempDir)).toBe(1);
    }, 10000);
  });
});
