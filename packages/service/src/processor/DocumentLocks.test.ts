/**
 * @module processor/DocumentLocks.test
 * Per-document locks (D98, D118): same key serialised, different keys concurrent, bounded wait throws DocumentLockTimeoutError, idle keys dropped, sorted multi-key acquisition (no deadlock), file keys normalised, long-hold warning.
 */

import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  API_LOCK_RETRY_AFTER_S,
  API_LOCK_WAIT_MS,
  DOCUMENT_LOCK_HOLD_WARN_MS,
  DocumentLocks,
  DocumentLockTimeoutError,
  fileLockKey,
} from './DocumentLocks';

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

describe('DocumentLocks', () => {
  it('serialises runs of one key and runs different keys concurrently', async () => {
    const locks = new DocumentLocks(logger);
    const order: string[] = [];
    const gate = deferred();
    const a1 = locks.run('a', 'process', async () => {
      order.push('a1:start');
      await gate.promise;
      order.push('a1:end');
    });
    const a2 = locks.run('a', 'process', () => {
      order.push('a2');
      return Promise.resolve();
    });
    const b = locks.run('b', 'process', () => {
      order.push('b');
      return Promise.resolve();
    });
    await b;
    expect(order).toEqual(['a1:start', 'b']);
    gate.resolve();
    await Promise.all([a1, a2]);
    expect(order).toEqual(['a1:start', 'b', 'a1:end', 'a2']);
  });

  it('drops a key once idle', async () => {
    const locks = new DocumentLocks(logger);
    const gate = deferred();
    const run = locks.run('a', 'process', () => gate.promise);
    expect(locks.size).toBe(1);
    gate.resolve();
    await run;
    expect(locks.size).toBe(0);
  });

  it('gives up a bounded wait with DocumentLockTimeoutError, running nothing', async () => {
    vi.useFakeTimers();
    const locks = new DocumentLocks(logger);
    const gate = deferred();
    const holder = locks.run('a', 'process', () => gate.promise);
    const work = vi.fn(() => Promise.resolve());
    const waiter = locks
      .run('a', 'setMetadata', work, { lockWaitMs: API_LOCK_WAIT_MS })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(API_LOCK_WAIT_MS - 1);
    expect(work).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const error = await waiter;
    expect(error).toBeInstanceOf(DocumentLockTimeoutError);
    expect(error).toMatchObject({
      key: 'a',
      operation: 'setMetadata',
      waitMs: 10_000,
    });
    expect(work).not.toHaveBeenCalled();
    gate.resolve();
    await holder;
    await vi.advanceTimersByTimeAsync(0);
    expect(locks.size).toBe(0);
  });

  it('a bounded wait that is granted in time runs the work', async () => {
    const locks = new DocumentLocks(logger);
    const gate = deferred();
    const holder = locks.run('a', 'process', () => gate.promise);
    const waiter = locks.run('a', 'setMetadata', () => Promise.resolve(7), {
      lockWaitMs: 5_000,
    });
    gate.resolve();
    await holder;
    await expect(waiter).resolves.toBe(7);
  });

  it('runAll takes keys in sorted order, so crossing moves do not deadlock', async () => {
    const locks = new DocumentLocks(logger);
    const order: string[] = [];
    const ab = locks.runAll(['b', 'a'], 'move', () => {
      order.push('b->a');
      return Promise.resolve();
    });
    const ba = locks.runAll(['a', 'b'], 'move', () => {
      order.push('a->b');
      return Promise.resolve();
    });
    await Promise.all([ab, ba]);
    expect(order).toEqual(['b->a', 'a->b']);
    expect(locks.size).toBe(0);
  });

  it('runAll takes a duplicate key once', async () => {
    const locks = new DocumentLocks(logger);
    await expect(
      locks.runAll(['a', 'a'], 'move', () => Promise.resolve('ok')),
    ).resolves.toBe('ok');
  });

  it('runAll holds every key while the work runs', async () => {
    const locks = new DocumentLocks(logger);
    const gate = deferred();
    const move = locks.runAll(['x', 'y'], 'move', () => gate.promise);
    await Promise.resolve();
    const other = vi.fn(() => Promise.resolve());
    const waitY = locks.run('y', 'process', other);
    await new Promise((r) => setTimeout(r, 5));
    expect(other).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all([move, waitY]);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('warns when a document lock is held over 5 minutes, naming the key', async () => {
    vi.useFakeTimers();
    const warnLogger = pino({ level: 'silent' });
    const warn = vi.spyOn(warnLogger, 'warn');
    const locks = new DocumentLocks(warnLogger);
    const gate = deferred();
    const run = locks.run('src://1', 'process', () => gate.promise);
    await vi.advanceTimersByTimeAsync(DOCUMENT_LOCK_HOLD_WARN_MS);
    expect(warn).toHaveBeenCalledWith(
      { key: 'src://1', operation: 'process', holdMs: 300_000 },
      'Document lock held over 5 minutes',
    );
    gate.resolve();
    await run;
  });

  it('API constants are 10 s and Retry-After 10', () => {
    expect(API_LOCK_WAIT_MS).toBe(10_000);
    expect(API_LOCK_RETRY_AFTER_S).toBe(10);
  });
});

describe('fileLockKey', () => {
  it('normalises case and separators like point IDs', () => {
    expect(fileLockKey('D:\\Docs\\A.md')).toBe(fileLockKey('d:/docs/a.md'));
  });
});
