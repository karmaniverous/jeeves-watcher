/**
 * @module vcs/VcsManager.breaker.test
 * Failure handling in the VcsManager commit pipeline (#249): only
 * index.lock contention is retried, failed batches are retained in full,
 * flush commits in maxBatchSize chunks, pendingCount includes in-flight
 * files, and the circuit breaker recovers on a timer. Real git, temp repos.
 */

import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { VcsConfig } from '@karmaniverous/jeeves-watcher-core';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  breakCommits,
  commitCount,
  countCalls,
  fixCommits,
  git,
  type LogSpy,
  makeTempRepo,
  makeVcsConfig,
  waitFor,
} from '../test/vcsRepo';
import { VcsManager } from './VcsManager';

describe('VcsManager failure handling (#249)', () => {
  let tempDir: string;
  let manager: VcsManager | undefined;

  async function startManager(overrides: Partial<VcsConfig> = {}): Promise<{
    warn: LogSpy;
    error: LogSpy;
  }> {
    const logger = pino({ level: 'silent' });
    const warn = vi.spyOn(logger, 'warn');
    const error = vi.spyOn(logger, 'error');
    manager = new VcsManager(tempDir, makeVcsConfig(overrides), logger);
    await manager.start();
    manager.endBaseline();
    return { warn, error };
  }

  /** Write files and report them to the manager. */
  async function change(names: string[]): Promise<void> {
    for (const name of names) {
      const p = join(tempDir, name);
      await writeFile(p, name, 'utf8');
      manager?.fileChanged(p);
    }
  }

  beforeEach(async () => {
    tempDir = await makeTempRepo('vcs-breaker-');
    manager = undefined;
  });

  afterEach(async () => {
    await manager?.stop();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('retry predicate', () => {
    it('fails fast on a non-lock error: one attempt, real message, file retained', async () => {
      await breakCommits(tempDir);
      const spies = await startManager();

      await change(['x.txt']);
      await manager?.flush();

      expect(countCalls(spies.warn, 'index.lock contention, retrying')).toBe(0);
      expect(countCalls(spies.error, 'VCS commit failed')).toBe(1);
      const state = manager?.breakerState;
      expect(state?.consecutiveFailures).toBe(1);
      expect(state?.lastError).toMatch(/gpg|sign/i);
      expect(state?.pendingCount).toBe(1);
    });

    it('retries index.lock contention, counts the batch as in flight meanwhile, then commits', async () => {
      const spies = await startManager();
      const lockPath = join(tempDir, '.git', 'index.lock');
      await writeFile(lockPath, '', 'utf8');

      await change(['lock.txt']);
      const flushing = manager?.flush();
      await waitFor(
        () => countCalls(spies.warn, 'index.lock contention, retrying') > 0,
      );
      // Taken from pending but not committed: still reported as backlog.
      expect(manager?.breakerState.pendingCount).toBe(1);

      await rm(lockPath, { force: true });
      await flushing;

      expect(await commitCount(tempDir)).toBe(1);
      expect(manager?.breakerState.pendingCount).toBe(0);
    }, 30000);
  });

  describe('batching and retention', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => `${n}.txt`);

    it('commits in chunks of at most maxBatchSize', async () => {
      await startManager({ maxBatchSize: 3 });

      // fileChanged commits a chunk each time pending reaches 3; flush
      // commits the remainder.
      await change(names);
      await manager?.flush();

      const hashes = (await git(tempDir, 'log', '--format=%H', '--reverse'))
        .trim()
        .split('\n');
      const sizes: number[] = [];
      for (const hash of hashes) {
        const files = await git(
          tempDir,
          'show',
          '--name-only',
          '--format=',
          hash,
        );
        sizes.push(files.trim().split('\n').length);
      }
      expect(sizes).toEqual([3, 3, 1]);
    }, 30000);

    it('retains every file of every failed chunk (no re-queue cap)', async () => {
      await breakCommits(tempDir);
      const spies = await startManager({
        maxBatchSize: 3,
        maxConsecutiveFailures: 100,
      });

      await change(names);
      await manager?.flush();

      expect(
        countCalls(spies.error, 'VCS commit failed'),
      ).toBeGreaterThanOrEqual(3);
      expect(manager?.breakerState.pendingCount).toBe(7);

      // Files staged by failed attempts stay in the index, so the recovery
      // commit may sweep up more than one chunk; nothing may be lost.
      await fixCommits(tempDir);
      await manager?.flush();

      expect(
        (await git(tempDir, 'ls-files')).trim().split('\n').sort(),
      ).toEqual(names);
      expect(manager?.breakerState.pendingCount).toBe(0);
    }, 30000);
  });

  describe('circuit breaker', () => {
    it('retains work on trip and recovers after cooldown without a new file event', async () => {
      await breakCommits(tempDir);
      const spies = await startManager({
        maxConsecutiveFailures: 2,
        circuitBreakerCooldownMs: 1000,
      });

      await change(['cb.txt']);
      await manager?.flush(); // fail 1
      await manager?.flush(); // fail 2 → trips

      const tripped = manager?.breakerState;
      expect(tripped).toMatchObject({
        consecutiveFailures: 2,
        tripped: true,
        pendingCount: 1,
      });
      expect(tripped?.trippedAt).not.toBeNull();
      expect(countCalls(spies.error, 'circuit breaker tripped')).toBe(1);

      // While cooling down, flush and new events retain without attempting.
      await change(['late.txt']);
      await manager?.flush();
      expect(countCalls(spies.error, 'VCS commit failed')).toBe(2);
      expect(manager?.breakerState.pendingCount).toBe(2);

      // Fix the cause. No new file event: the cooldown timer must retry.
      await fixCommits(tempDir);
      await waitFor(async () => (await commitCount(tempDir)) === 1);
      await manager?.flush();

      expect(manager?.breakerState).toEqual({
        consecutiveFailures: 0,
        tripped: false,
        trippedAt: null,
        lastError: null,
        pendingCount: 0,
      });
      expect(
        (await git(tempDir, 'ls-files')).trim().split('\n').sort(),
      ).toEqual(['cb.txt', 'late.txt']);
    }, 30000);

    it('re-arms after a failed half-open attempt (one attempt per cooldown)', async () => {
      await breakCommits(tempDir);
      const spies = await startManager({
        maxConsecutiveFailures: 2,
        circuitBreakerCooldownMs: 1000,
      });

      await change(['rearm.txt']);
      await manager?.flush();
      await manager?.flush(); // trips
      const firstTrip = manager?.breakerState.trippedAt ?? '';
      expect(firstTrip).not.toBe('');

      // The half-open attempt fires from the timer and fails → re-armed.
      await waitFor(() => countCalls(spies.error, 'VCS commit failed') === 3);
      await manager?.flush();
      const state = manager?.breakerState;
      expect(state?.tripped).toBe(true);
      expect(state?.pendingCount).toBe(1);
      expect(Date.parse(state?.trippedAt ?? '')).toBeGreaterThan(
        Date.parse(firstTrip),
      );

      // No second attempt inside the new cooldown window.
      await new Promise((r) => setTimeout(r, 300));
      expect(countCalls(spies.error, 'VCS commit failed')).toBe(3);
    }, 30000);

    it('retains a large backlog while cooling down and commits all of it on recovery', async () => {
      await breakCommits(tempDir);
      await startManager({
        maxBatchSize: 3,
        maxConsecutiveFailures: 1,
        circuitBreakerCooldownMs: 1000,
      });

      await change(['f0.txt']);
      await manager?.flush(); // trips
      expect(manager?.breakerState.tripped).toBe(true);

      const names = ['f1.txt', 'f2.txt', 'f3.txt', 'f4.txt', 'f5.txt'];
      await change(names);
      await manager?.flush();
      expect(manager?.breakerState.pendingCount).toBe(6);

      await fixCommits(tempDir);
      await waitFor(() => manager?.breakerState.tripped === false);
      await manager?.flush();

      // 6 files in maxBatchSize-3 chunks.
      expect(await commitCount(tempDir)).toBe(2);
      expect(
        (await git(tempDir, 'ls-files')).trim().split('\n').sort(),
      ).toEqual(['f0.txt', ...names]);
    }, 30000);
  });
});
