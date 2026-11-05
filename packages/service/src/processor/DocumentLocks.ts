/**
 * @module processor/DocumentLocks
 * One in-process FIFO lock per document key (D98): every process, delete, move, too_large and metadata change of a document runs under it. API routes wait at most 10 s, then 503 (D118). Idle locks are dropped.
 *
 * Keys: the normalised file path (the same normalisation as point IDs) or
 * the source reference. A move takes both keys in sorted order, so two moves
 * cannot deadlock.
 */

import type pino from 'pino';

import { FifoLock } from '../util/FifoLock';
import { normalizePath } from '../util/normalizePath';

/** Longest wait of an API route for one document lock (D118). */
export const API_LOCK_WAIT_MS = 10_000;

/** `Retry-After` (seconds) of the `503` that ends such a wait (D118). */
export const API_LOCK_RETRY_AFTER_S = 10;

/** A hold longer than this is logged as a warning (D98, as D102). */
export const DOCUMENT_LOCK_HOLD_WARN_MS = 5 * 60_000;

/** Options of one locked operation. */
export interface DocumentLockOptions {
  /** Longest wait for the lock (omit: unbounded, as for background work). */
  lockWaitMs?: number;
}

/** Thrown when a bounded wait for a document lock runs out (D118). */
export class DocumentLockTimeoutError extends Error {
  /**
   * @param key - The document key.
   * @param operation - The operation that gave up.
   * @param waitMs - How long it waited.
   */
  constructor(
    readonly key: string,
    readonly operation: string,
    readonly waitMs: number,
  ) {
    super(
      `Document ${key} is being processed; ${operation} did not get its lock within ${String(waitMs)} ms`,
    );
    this.name = 'DocumentLockTimeoutError';
  }
}

/**
 * The lock key of a file.
 *
 * @param filePath - The file path, as given.
 * @returns The normalised path (lower-case, forward slashes).
 */
export function fileLockKey(filePath: string): string {
  return normalizePath(filePath);
}

/** The per-document locks of one processor. */
export class DocumentLocks {
  private readonly locks = new Map<string, FifoLock>();

  /** @param logger - Logger for long-hold warnings. */
  constructor(private readonly logger: pino.Logger) {}

  /** Number of keys currently locked or waited for. */
  get size(): number {
    return this.locks.size;
  }

  /**
   * Run `work` under the lock of `key`.
   *
   * @param key - Document key ({@link fileLockKey} or a source reference).
   * @param operation - Operation name (warnings, timeout error).
   * @param work - The work (must not take the same key again).
   * @param options - Bounded wait.
   * @returns What `work` returns.
   * @throws DocumentLockTimeoutError when a bounded wait runs out.
   */
  run<T>(
    key: string,
    operation: string,
    work: () => Promise<T>,
    options: DocumentLockOptions = {},
  ): Promise<T> {
    return this.lockFor(key).run(operation, work, options.lockWaitMs);
  }

  /**
   * Run `work` holding the locks of every key, taken one at a time in sorted
   * order (duplicates once).
   *
   * @param keys - Document keys.
   * @param operation - Operation name.
   * @param work - The work.
   * @param options - Bounded wait (per lock).
   * @returns What `work` returns.
   */
  runAll<T>(
    keys: string[],
    operation: string,
    work: () => Promise<T>,
    options: DocumentLockOptions = {},
  ): Promise<T> {
    const sorted = [...new Set(keys)].sort();
    const nest = (index: number): Promise<T> =>
      index === sorted.length
        ? work()
        : this.run(sorted[index], operation, () => nest(index + 1), options);
    return nest(0);
  }

  private lockFor(key: string): FifoLock {
    const existing = this.locks.get(key);
    if (existing) return existing;
    const lock: FifoLock = new FifoLock({
      logger: this.logger,
      logFields: { key },
      name: 'Document lock',
      holdWarnMs: DOCUMENT_LOCK_HOLD_WARN_MS,
      timeoutError: (operation, waitMs) =>
        new DocumentLockTimeoutError(key, operation, waitMs),
      // An idle lock is unreachable afterwards: lockFor() and run() are
      // one synchronous step, so no caller can still hold this instance.
      onIdle: () => this.locks.delete(key),
    });
    this.locks.set(key, lock);
    return lock;
  }
}
