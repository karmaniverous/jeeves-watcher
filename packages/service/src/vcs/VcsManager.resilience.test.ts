/**
 * @module vcs/VcsManager.resilience.test
 * Commit-pipeline resilience tests for #249: no-op detection, missing-path
 * partitioning, retry predicate, time-based circuit breaker, and stale git
 * operation reporting. All tests run real git against temp repos.
 */

import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { VcsConfig } from '@karmaniverous/jeeves-watcher-core';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execFileAsync } from '../test/git';
import { initRepo } from './vcsBootstrap';
import { VcsManager } from './VcsManager';

function makeConfig(overrides: Partial<VcsConfig> = {}): VcsConfig {
  return {
    enabled: true,
    commitThrottleMs: 60000,
    maxBatchSize: 1000,
    staleLockThresholdMs: 600000,
    maxConsecutiveFailures: 5,
    circuitBreakerCooldownMs: 300000,
    branch: 'master',
    ...overrides,
  };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
}

async function commitCount(cwd: string): Promise<number> {
  try {
    return parseInt((await git(cwd, 'rev-list', '--count', 'HEAD')).trim(), 10);
  } catch {
    return 0;
  }
}

async function commitAll(cwd: string, message: string): Promise<void> {
  await git(cwd, 'add', '-A');
  await git(cwd, 'commit', '-m', message);
}

/**
 * Make every `git commit` fail deterministically (not an index.lock error):
 * require signing with a GPG program that doesn't exist.
 */
async function breakCommits(cwd: string): Promise<void> {
  await git(cwd, 'config', 'commit.gpgSign', 'true');
  await git(cwd, 'config', 'gpg.program', 'jeeves-no-such-gpg-program');
}

async function fixCommits(cwd: string): Promise<void> {
  await git(cwd, 'config', 'commit.gpgSign', 'false');
}

/** Poll until `check` returns true or the timeout elapses. */
async function waitFor(
  check: () => Promise<boolean> | boolean,
  timeoutMs = 10000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('waitFor timed out');
}

function countCalls(
  spy: { mock: { calls: unknown[][] } },
  message: string,
): number {
  return spy.mock.calls.filter((call) =>
    call.some((arg) => typeof arg === 'string' && arg.includes(message)),
  ).length;
}

describe('VcsManager resilience (#249)', () => {
  let tempDir: string;
  let manager: VcsManager | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vcs-resilience-'));
    await initRepo(tempDir);
    await git(tempDir, 'config', 'user.email', 'test@test.com');
    await git(tempDir, 'config', 'user.name', 'Test');
    manager = undefined;
  });

  afterEach(async () => {
    await manager?.stop();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('no-op detection', () => {
    it('treats an empty batch with untracked noise outside the batch as a no-op', async () => {
      const file = join(tempDir, 'a.txt');
      await writeFile(file, 'a', 'utf8');
      await commitAll(tempDir, 'initial');
      // Untracked files outside the batch (e.g. non-watched *.pdf)
      await writeFile(join(tempDir, 'noise.pdf'), 'noise', 'utf8');

      const logger = pino({ level: 'silent' });
      const infoSpy = vi.spyOn(logger, 'info');
      const errorSpy = vi.spyOn(logger, 'error');
      manager = new VcsManager(tempDir, makeConfig(), logger);
      await manager.start();
      manager.endBaseline();

      manager.fileChanged(file); // unchanged content
      await manager.flush();

      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ root: tempDir }),
        'VCS commit skipped — nothing staged',
      );
      expect(countCalls(errorSpy, 'VCS commit failed')).toBe(0);
      expect(manager.breakerState.consecutiveFailures).toBe(0);
      expect(await commitCount(tempDir)).toBe(1);
    });

    it('treats an empty batch with an unstaged tracked deletion outside the batch as a no-op', async () => {
      const a = join(tempDir, 'a.txt');
      const b = join(tempDir, 'b.txt');
      await writeFile(a, 'a', 'utf8');
      await writeFile(b, 'b', 'utf8');
      await commitAll(tempDir, 'initial');
      await rm(b); // unstaged deletion, never reported to the manager

      const logger = pino({ level: 'silent' });
      const errorSpy = vi.spyOn(logger, 'error');
      manager = new VcsManager(tempDir, makeConfig(), logger);
      await manager.start();
      manager.endBaseline();

      manager.fileChanged(a);
      await manager.flush();

      expect(countCalls(errorSpy, 'VCS commit failed')).toBe(0);
      expect(manager.breakerState.consecutiveFailures).toBe(0);
      expect(await commitCount(tempDir)).toBe(1);
    });
  });

  describe('missing paths in a batch', () => {
    it('drops a vanished untracked path and still commits the rest', async () => {
      const logger = pino({ level: 'silent' });
      const errorSpy = vi.spyOn(logger, 'error');
      manager = new VcsManager(tempDir, makeConfig(), logger);
      await manager.start();
      manager.endBaseline();

      const real = join(tempDir, 'real.txt');
      await writeFile(real, 'real', 'utf8');
      // Never tracked, and gone (its directory too)
      const ghost = join(tempDir, 'gone-dir', 'ghost.json');
      manager.fileChanged(ghost);
      manager.fileChanged(real);
      await manager.flush();

      expect(countCalls(errorSpy, 'VCS commit failed')).toBe(0);
      expect(await commitCount(tempDir)).toBe(1);
      expect(await git(tempDir, 'ls-files')).toContain('real.txt');
      expect(manager.breakerState.pendingCount).toBe(0);
    });

    it('records the deletion of a tracked path alongside other changes', async () => {
      const doomed = join(tempDir, 'doomed.txt');
      await writeFile(doomed, 'bye', 'utf8');
      await commitAll(tempDir, 'initial');

      const logger = pino({ level: 'silent' });
      const errorSpy = vi.spyOn(logger, 'error');
      manager = new VcsManager(tempDir, makeConfig(), logger);
      await manager.start();
      manager.endBaseline();

      await rm(doomed);
      const added = join(tempDir, 'added.txt');
      await writeFile(added, 'hi', 'utf8');
      manager.handleUnlink(doomed);
      manager.fileChanged(added);
      await manager.flush();

      expect(countCalls(errorSpy, 'VCS commit failed')).toBe(0);
      expect(await commitCount(tempDir)).toBe(2);
      const tracked = await git(tempDir, 'ls-files');
      expect(tracked).not.toContain('doomed.txt');
      expect(tracked).toContain('added.txt');
      expect(await git(tempDir, 'status', '--porcelain')).toBe('');
    });
  });

  describe('startup deletion reconciliation', () => {
    it('adds in-scope tracked deletions to pending and commits them', async () => {
      const keep = join(tempDir, 'keep.txt');
      const gone = join(tempDir, 'sub', 'gone.txt');
      const outOfScope = join(tempDir, 'other.md');
      await mkdir(join(tempDir, 'sub'));
      await writeFile(keep, 'keep', 'utf8');
      await writeFile(gone, 'gone', 'utf8');
      await writeFile(outOfScope, 'md', 'utf8');
      await commitAll(tempDir, 'initial');

      // Deleted while the watcher wasn't running
      await rm(gone);
      await rm(outOfScope);

      manager = new VcsManager(
        tempDir,
        makeConfig(),
        pino({ level: 'silent' }),
      );
      await manager.start();
      await manager.reconcileDeletions((p) => p.endsWith('.txt'));
      expect(manager.breakerState.pendingCount).toBe(1);
      await manager.flush();

      expect(await commitCount(tempDir)).toBe(2);
      expect(await git(tempDir, 'log', '-1', '--format=%s')).toContain(
        'baseline:',
      );
      const tracked = await git(tempDir, 'ls-files');
      expect(tracked).not.toContain('sub/gone.txt');
      expect(tracked).toContain('keep.txt');
      // Out-of-scope deletion is left alone
      expect(tracked).toContain('other.md');
    });
  });

  describe('retry predicate', () => {
    it('fails fast on a non-lock error (single attempt, no lock warning)', async () => {
      await breakCommits(tempDir);
      const logger = pino({ level: 'silent' });
      const warnSpy = vi.spyOn(logger, 'warn');
      const errorSpy = vi.spyOn(logger, 'error');
      manager = new VcsManager(tempDir, makeConfig(), logger);
      await manager.start();
      manager.endBaseline();

      const file = join(tempDir, 'x.txt');
      await writeFile(file, 'x', 'utf8');
      manager.fileChanged(file);
      await manager.flush();

      expect(countCalls(warnSpy, 'index.lock contention, retrying')).toBe(0);
      expect(countCalls(errorSpy, 'VCS commit failed')).toBe(1);
      expect(manager.breakerState.consecutiveFailures).toBe(1);
      expect(manager.breakerState.lastError).toBeTruthy();
      expect(manager.breakerState.pendingCount).toBe(1);
    });

    it('still retries on index.lock contention', async () => {
      const logger = pino({ level: 'silent' });
      const warnSpy = vi.spyOn(logger, 'warn');
      manager = new VcsManager(tempDir, makeConfig(), logger);
      await manager.start();
      manager.endBaseline();

      const lockPath = join(tempDir, '.git', 'index.lock');
      await writeFile(lockPath, '', 'utf8');
      const file = join(tempDir, 'lock.txt');
      await writeFile(file, 'x', 'utf8');
      manager.fileChanged(file);
      setTimeout(() => {
        void rm(lockPath, { force: true });
      }, 300);
      await manager.flush();

      expect(
        countCalls(warnSpy, 'index.lock contention, retrying'),
      ).toBeGreaterThan(0);
      expect(await commitCount(tempDir)).toBe(1);
    }, 30000);
  });

  describe('circuit breaker', () => {
    it('re-queues on trip and recovers after cooldown without a new file event', async () => {
      await breakCommits(tempDir);
      const logger = pino({ level: 'silent' });
      const errorSpy = vi.spyOn(logger, 'error');
      manager = new VcsManager(
        tempDir,
        makeConfig({
          maxConsecutiveFailures: 2,
          circuitBreakerCooldownMs: 1000,
        }),
        logger,
      );
      await manager.start();
      manager.endBaseline();

      const file = join(tempDir, 'cb.txt');
      await writeFile(file, 'x', 'utf8');
      manager.fileChanged(file);
      await manager.flush(); // fail 1
      await manager.flush(); // fail 2 → trips

      const tripped = manager.breakerState;
      expect(tripped.tripped).toBe(true);
      expect(tripped.trippedAt).not.toBeNull();
      expect(tripped.consecutiveFailures).toBe(2);
      expect(tripped.pendingCount).toBe(1);
      expect(tripped.lastError).toBeTruthy();

      // While cooling down, a flush re-queues without a commit attempt.
      await manager.flush();
      expect(countCalls(errorSpy, 'VCS commit failed')).toBe(2);
      expect(manager.breakerState.pendingCount).toBe(1);

      // Fix the cause. No new file event: the cooldown timer must retry.
      await fixCommits(tempDir);
      await waitFor(async () => (await commitCount(tempDir)) === 1);
      await manager.flush();

      expect(manager.breakerState).toEqual({
        consecutiveFailures: 0,
        tripped: false,
        trippedAt: null,
        lastError: null,
        pendingCount: 0,
      });
    }, 30000);

    it('re-arms after a failed half-open attempt (one attempt per cooldown)', async () => {
      await breakCommits(tempDir);
      const logger = pino({ level: 'silent' });
      const errorSpy = vi.spyOn(logger, 'error');
      manager = new VcsManager(
        tempDir,
        makeConfig({
          maxConsecutiveFailures: 2,
          circuitBreakerCooldownMs: 1000,
        }),
        logger,
      );
      await manager.start();
      manager.endBaseline();

      const file = join(tempDir, 'rearm.txt');
      await writeFile(file, 'x', 'utf8');
      manager.fileChanged(file);
      await manager.flush();
      await manager.flush(); // trips
      const firstTrip = manager.breakerState.trippedAt;
      expect(firstTrip).not.toBeNull();

      // Half-open attempt fires from the timer and fails → re-armed.
      await waitFor(() => countCalls(errorSpy, 'VCS commit failed') === 3);
      await manager.flush();
      const state = manager.breakerState;
      expect(state.tripped).toBe(true);
      expect(state.pendingCount).toBe(1);
      expect(Date.parse(state.trippedAt ?? '')).toBeGreaterThan(
        Date.parse(firstTrip ?? ''),
      );

      // Only one attempt per cooldown window.
      await new Promise((r) => setTimeout(r, 300));
      expect(countCalls(errorSpy, 'VCS commit failed')).toBe(3);
    }, 30000);

    it('never drops files beyond maxBatchSize while cooling down', async () => {
      await breakCommits(tempDir);
      const logger = pino({ level: 'silent' });
      manager = new VcsManager(
        tempDir,
        makeConfig({
          maxBatchSize: 3,
          maxConsecutiveFailures: 1,
          circuitBreakerCooldownMs: 1000,
        }),
        logger,
      );
      await manager.start();
      manager.endBaseline();

      const first = join(tempDir, 'f0.txt');
      await writeFile(first, 'x', 'utf8');
      manager.fileChanged(first);
      await manager.flush(); // fails once → trips
      expect(manager.breakerState.tripped).toBe(true);

      // More changes arrive while cooling down; the flush batch exceeds the
      // re-queue cap, but nothing may be discarded.
      const names = ['f1.txt', 'f2.txt', 'f3.txt', 'f4.txt', 'f5.txt'];
      for (const name of names) {
        const p = join(tempDir, name);
        await writeFile(p, 'x', 'utf8');
        manager.fileChanged(p);
      }
      await manager.flush();
      expect(manager.breakerState.pendingCount).toBe(6);

      await fixCommits(tempDir);
      await waitFor(async () => (await commitCount(tempDir)) === 1);
      await manager.flush();
      const tracked = await git(tempDir, 'ls-files');
      for (const name of ['f0.txt', ...names]) {
        expect(tracked).toContain(name);
      }
    }, 30000);
  });

  describe('stale git operation on start', () => {
    it('reports (and never clears) an abandoned cherry-pick sequencer', async () => {
      const sequencer = join(tempDir, '.git', 'sequencer');
      await mkdir(sequencer);
      const logger = pino({ level: 'silent' });
      const errorSpy = vi.spyOn(logger, 'error');
      manager = new VcsManager(tempDir, makeConfig(), logger);
      await manager.start();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ root: tempDir, marker: 'sequencer' }),
        expect.stringContaining('Stale in-progress git operation detected'),
      );
      // Report only: the state is left in place.
      await expect(access(sequencer)).resolves.toBeUndefined();
    });
  });
});
