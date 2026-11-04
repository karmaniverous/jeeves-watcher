/**
 * @module vcs/RootGitLock.test
 * RootGitLock (D66, D81, D102): FIFO order, release on throw, holder tracking, and the long-wait and long-hold warnings.
 */

import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LOCK_HOLD_WARN_MS,
  LOCK_WAIT_WARN_MS,
  RootGitLock,
} from './RootGitLock';

const logger = pino({ level: 'silent' });

/** A promise with its resolver. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('RootGitLock', () => {
  it('runs holders one at a time in arrival order', async () => {
    const lock = new RootGitLock('/r', logger);
    const order: string[] = [];
    const gate = deferred();

    const first = lock.run('commit', async () => {
      order.push('commit:start');
      await gate.promise;
      order.push('commit:end');
    });
    const second = lock.run('squash', () => {
      order.push('squash');
      return Promise.resolve();
    });
    const third = lock.run('sweep', () => {
      order.push('sweep');
      return Promise.resolve();
    });
    await Promise.resolve();
    expect(lock.heldBy).toBe('commit');

    gate.resolve();
    await Promise.all([first, second, third]);

    expect(order).toEqual(['commit:start', 'commit:end', 'squash', 'sweep']);
    expect(lock.heldBy).toBeUndefined();
  });

  it('releases when the work throws and returns the work result otherwise', async () => {
    const lock = new RootGitLock('/r', logger);

    await expect(
      lock.run('commit', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    await expect(lock.run('squash', () => Promise.resolve(42))).resolves.toBe(
      42,
    );
  });

  it('warns when a wait passes 10 s and when a hold passes 5 minutes (D102)', async () => {
    vi.useFakeTimers();
    const warnLogger = pino({ level: 'silent' });
    const warn = vi.spyOn(warnLogger, 'warn');
    const lock = new RootGitLock('/r', warnLogger);
    const gate = deferred();

    const holder = lock.run('squash', () => gate.promise);
    const waiter = lock.run('commit', () => Promise.resolve());
    await vi.advanceTimersByTimeAsync(LOCK_WAIT_WARN_MS);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        root: '/r',
        operation: 'commit',
        heldBy: 'squash',
      }),
      'Waiting over 10 s for RootGitLock',
    );

    await vi.advanceTimersByTimeAsync(LOCK_HOLD_WARN_MS - LOCK_WAIT_WARN_MS);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ root: '/r', operation: 'squash' }),
      'RootGitLock held over 5 minutes',
    );

    gate.resolve();
    await Promise.all([holder, waiter]);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
