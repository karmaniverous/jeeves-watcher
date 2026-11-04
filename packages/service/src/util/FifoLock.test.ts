/**
 * @module util/FifoLock.test
 * FifoLock: optional wait warning, idle notification on release and after a timed-out wait, timeout error factory. FIFO order and the RootGitLock messages are covered by vcs/RootGitLock.test.
 */

import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FifoLock, type FifoLockOptions } from './FifoLock';

/** A promise with its resolver. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeLock(overrides: Partial<FifoLockOptions> = {}): {
  lock: FifoLock;
  warn: ReturnType<typeof vi.fn>;
  onIdle: ReturnType<typeof vi.fn>;
} {
  const logger = pino({ level: 'silent' });
  const warn = vi.spyOn(logger, 'warn');
  const onIdle = vi.fn();
  const lock = new FifoLock({
    logger,
    logFields: { key: 'k' },
    name: 'Test lock',
    holdWarnMs: 60_000,
    timeoutError: (operation, waitMs, heldBy) =>
      new Error(`${operation}/${String(waitMs)}/${heldBy ?? '-'}`),
    onIdle,
    ...overrides,
  });
  return { lock, warn: warn as never, onIdle };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('FifoLock', () => {
  it('never logs a wait when waitWarnMs is omitted', async () => {
    vi.useFakeTimers();
    const { lock, warn } = makeLock();
    const gate = deferred();
    const first = lock.run('a', () => gate.promise);
    const second = lock.run('b', () => Promise.resolve());
    await vi.advanceTimersByTimeAsync(59_000);
    expect(warn).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all([first, second]);
  });

  it('logs a hold over holdWarnMs with the lock fields, in minutes', async () => {
    vi.useFakeTimers();
    const { lock, warn } = makeLock();
    const gate = deferred();
    const run = lock.run('slow', () => gate.promise);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(warn).toHaveBeenCalledWith(
      { key: 'k', operation: 'slow', holdMs: 60_000 },
      'Test lock held over 1 minutes',
    );
    gate.resolve();
    await run;
  });

  it('logs a wait over waitWarnMs in seconds', async () => {
    vi.useFakeTimers();
    const { lock, warn } = makeLock({ waitWarnMs: 1500 });
    const gate = deferred();
    const first = lock.run('a', () => gate.promise);
    const second = lock.run('b', () => Promise.resolve());
    await vi.advanceTimersByTimeAsync(1500);
    expect(warn).toHaveBeenCalledWith(
      { key: 'k', operation: 'b', heldBy: 'a', waitMs: 1500 },
      'Waiting over 1.5 s for Test lock',
    );
    gate.resolve();
    await Promise.all([first, second]);
  });

  it('reports idle once the last holder releases', async () => {
    const { lock, onIdle } = makeLock();
    const gate = deferred();
    const first = lock.run('a', () => gate.promise);
    const second = lock.run('b', () => Promise.resolve());
    gate.resolve();
    await first;
    await second;
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('reports idle after a timed-out waiter once its turn passes', async () => {
    vi.useFakeTimers();
    const { lock, onIdle } = makeLock();
    const gate = deferred();
    const holder = lock.run('holder', () => gate.promise);
    const waiter = lock.run('waiter', () => Promise.resolve('ran'), 100);
    const outcome = waiter.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(100);
    const error = await outcome;
    expect(error).toEqual(new Error('waiter/100/holder'));
    expect(onIdle).not.toHaveBeenCalled();
    gate.resolve();
    await holder;
    await vi.advanceTimersByTimeAsync(0);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('reports idle when work throws', async () => {
    const { lock, onIdle } = makeLock();
    await expect(
      lock.run('boom', () => Promise.reject(new Error('x'))),
    ).rejects.toThrow('x');
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});
