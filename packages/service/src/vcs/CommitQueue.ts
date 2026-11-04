/**
 * @module vcs/CommitQueue
 * The pending-file queue of one VCS root: a set of paths, a throttle (not a debounce), batches of at most maxBatchSize chained one after another under RootGitLock, and an in-hold flush for squash (D101). No I/O of its own besides logging a batch that throws.
 */

import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';
import type { RootGitLock } from './RootGitLock';

/** Collaborators of a {@link CommitQueue}. */
export interface CommitQueueOptions {
  /** Most files per batch. */
  maxBatchSize: number;
  /** Throttle interval: pending files commit this long after the first. */
  throttleMs: number;
  /** Called when the throttle fires (the owner flushes). */
  onThrottle: () => void;
  /** The root's lock; each chained batch takes it. */
  lock: RootGitLock;
  /**
   * Commit one batch while the lock is held. Resolves false when the batch
   * failed (it is then put back with {@link CommitQueue.retain}).
   */
  commit: (batch: string[]) => Promise<boolean>;
  /** Repository root, for the log line of a batch that throws. */
  root: string;
  /** Logs a batch that throws instead of resolving false (a bug). */
  logger: pino.Logger;
  /** Called when a batch throws, so the owner can count the failure. */
  onThrow?: (message: string, pendingCount: number) => void;
}

/** Pending files and the batch chain of one root. */
export class CommitQueue {
  private readonly pending = new Set<string>();
  private throttleTimer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<void> = Promise.resolve();
  private inFlight = 0;

  constructor(private readonly options: CommitQueueOptions) {}

  /** Files queued or in flight, not yet committed. */
  get backlog(): number {
    return this.pending.size + this.inFlight;
  }

  /** Files queued, not yet in a batch. */
  get queued(): number {
    return this.pending.size;
  }

  /**
   * Queue a file. A full batch is committed at once; otherwise the throttle
   * timer starts (if not already running).
   *
   * @param filePath - Absolute path.
   */
  add(filePath: string): void {
    this.pending.add(filePath);
    if (this.pending.size >= this.options.maxBatchSize) {
      this.clearThrottle();
      this.enqueue(this.take());
      if (this.pending.size > 0) this.startThrottle();
      return;
    }
    this.startThrottle();
  }

  /**
   * Put files back (after a failed batch). Pending is a set, so this cannot
   * grow it past the distinct paths seen.
   *
   * @param files - Absolute paths.
   */
  retain(files: readonly string[]): void {
    for (const f of files) this.pending.add(f);
  }

  /** Commit every pending file now, in batches, and await the chain. */
  async flush(): Promise<void> {
    this.clearThrottle();
    while (this.pending.size > 0) this.enqueue(this.take());
    await this.chain;
  }

  /**
   * Commit every pending file inside a hold the caller already has (the
   * squash flush): the same commit path, without taking the lock again.
   *
   * @returns false as soon as a batch fails.
   */
  async flushInHold(): Promise<boolean> {
    this.clearThrottle();
    while (this.pending.size > 0) {
      const batch = this.take();
      this.inFlight += batch.length;
      try {
        if (!(await this.options.commit(batch))) return false;
      } finally {
        this.inFlight -= batch.length;
      }
    }
    return true;
  }

  /**
   * Start the throttle timer unless it is running (throttle, not debounce).
   */
  startThrottle(): void {
    if (this.throttleTimer !== undefined) return;
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = undefined;
      this.options.onThrottle();
    }, this.options.throttleMs);
  }

  /** Stop the throttle timer. */
  clearThrottle(): void {
    if (this.throttleTimer === undefined) return;
    clearTimeout(this.throttleTimer);
    this.throttleTimer = undefined;
  }

  /** Take up to maxBatchSize files from the pending set. */
  private take(): string[] {
    const batch = [...this.pending].slice(0, this.options.maxBatchSize);
    for (const item of batch) this.pending.delete(item);
    return batch;
  }

  /** Chain a batch behind the in-flight one; it takes the lock. */
  private enqueue(batch: string[]): void {
    this.inFlight += batch.length;
    this.chain = this.chain.then(async () => {
      try {
        await this.options.lock.run('commit', () => this.options.commit(batch));
      } catch (error) {
        // Keep the chain resolved, or every later batch would be skipped.
        this.retain(batch);
        this.options.logger.error(
          { root: this.options.root, err: normalizeError(error) },
          'VCS batch threw; its files are kept for the next one',
        );
        this.options.onThrow?.(
          normalizeError(error).message,
          this.pending.size,
        );
        // Retry at the next throttle, not only at the next file change.
        this.startThrottle();
      } finally {
        this.inFlight -= batch.length;
      }
    });
  }
}
