/**
 * @module vcs/RootGitLock
 * Per-root, in-process FIFO async mutex serialising the watcher's own git work on a root: batch commits (with push), squash, untracking and temp-file sweeps (D66, D81). Never re-entered. Logs long waits and holds (D102).
 *
 * It cannot exclude other processes (people and agents run git in the same
 * repositories), so everything done under it must also be safe without it.
 */

import type pino from 'pino';

/** A wait longer than this is logged as a warning (D102). */
export const LOCK_WAIT_WARN_MS = 10_000;

/** A hold longer than this is logged as a warning (D102). */
export const LOCK_HOLD_WARN_MS = 5 * 60_000;

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
  async run<T>(operation: string, work: () => Promise<T>): Promise<T> {
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
    await previous;
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
