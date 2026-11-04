/**
 * @module vcs/RootGitLock
 * Per-root, in-process FIFO async mutex serialising the watcher's own git work on a root: batch commits (with push), squash, untracking and temp-file sweeps (D66, D81). Never re-entered. Logs long waits and holds; an API route's wait is bounded (D102).
 *
 * It cannot exclude other processes (people and agents run git in the same
 * repositories), so everything done under it must also be safe without it.
 */

import type pino from 'pino';

/** A wait longer than this is logged as a warning (D102). */
export const LOCK_WAIT_WARN_MS = 10_000;

/** A hold longer than this is logged as a warning (D102). */
export const LOCK_HOLD_WARN_MS = 5 * 60_000;

/** Longest an API route waits for the lock before answering `503` (D102). */
export const ROUTE_LOCK_WAIT_MS = 30_000;

/** Thrown by {@link RootGitLock.runWithin} when the lock is not acquired in time. */
export class LockWaitTimeoutError extends Error {
  /**
   * @param root - Repository root.
   * @param operation - The operation that gave up.
   * @param waitMs - How long it waited.
   * @param heldBy - The operation holding the lock at that moment.
   */
  constructor(
    readonly root: string,
    readonly operation: string,
    readonly waitMs: number,
    readonly heldBy: string | undefined,
  ) {
    super(
      `RootGitLock on ${root} not acquired by ${operation} within ${String(waitMs)} ms (held by ${heldBy ?? 'a queued operation'})`,
    );
    this.name = 'LockWaitTimeoutError';
  }
}

/** FIFO mutex for one VCS root. */
export class RootGitLock {
  private tail: Promise<void> = Promise.resolve();
  private holder: string | undefined;

  /**
   * @param root - Repository root (named in warnings).
   * @param logger - Logger for long-wait and long-hold warnings.
   */
  constructor(
    private readonly root: string,
    private readonly logger: pino.Logger,
  ) {}

  /** The operation holding the lock, if any. */
  get heldBy(): string | undefined {
    return this.holder;
  }

  /**
   * Run `work` while holding the lock. Callers queue in arrival order; the
   * lock is released when `work` settles, whatever its outcome.
   *
   * @param operation - Operation name, for warnings and {@link heldBy}.
   * @param work - The work to run under the lock (must not take it again).
   * @returns What `work` returns.
   */
  run<T>(operation: string, work: () => Promise<T>): Promise<T> {
    return this.queue(operation, work, undefined);
  }

  /**
   * {@link run}, giving up when the lock is not acquired within `waitMs`
   * (D102). A caller that gives up never runs `work`; its place in the
   * queue passes straight on, so later callers keep their order.
   *
   * @param operation - Operation name, for warnings and {@link heldBy}.
   * @param waitMs - Longest wait for the lock.
   * @param work - The work to run under the lock (must not take it again).
   * @returns What `work` returns.
   * @throws LockWaitTimeoutError when the wait runs out.
   */
  runWithin<T>(
    operation: string,
    waitMs: number,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.queue(operation, work, waitMs);
  }

  private async queue<T>(
    operation: string,
    work: () => Promise<T>,
    waitMs: number | undefined,
  ): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    const waitTimer = setTimeout(() => {
      this.logger.warn(
        {
          root: this.root,
          operation,
          heldBy: this.holder,
          waitMs: LOCK_WAIT_WARN_MS,
        },
        'Waiting over 10 s for RootGitLock',
      );
    }, LOCK_WAIT_WARN_MS);
    waitTimer.unref();
    if (waitMs === undefined) {
      await previous;
    } else if (!(await acquireWithin(previous, waitMs))) {
      clearTimeout(waitTimer);
      const heldBy = this.holder;
      void previous.then(release);
      throw new LockWaitTimeoutError(this.root, operation, waitMs, heldBy);
    }
    clearTimeout(waitTimer);
    this.holder = operation;
    const holdTimer = setTimeout(() => {
      this.logger.warn(
        { root: this.root, operation, holdMs: LOCK_HOLD_WARN_MS },
        'RootGitLock held over 5 minutes',
      );
    }, LOCK_HOLD_WARN_MS);
    holdTimer.unref();
    try {
      return await work();
    } finally {
      clearTimeout(holdTimer);
      this.holder = undefined;
      release();
    }
  }
}

/**
 * Wait for the previous holder to release, at most `waitMs`.
 *
 * @returns true once the previous holder released; false if the wait ran out.
 */
function acquireWithin(
  previous: Promise<void>,
  waitMs: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, waitMs);
    void previous.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
