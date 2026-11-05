/**
 * @module util/FifoLock
 * In-process FIFO async mutex with an optional bounded wait, long-wait and long-hold warnings, and an idle check; shared by RootGitLock (D102) and the per-document locks (D98). Never re-entered.
 */

import type pino from 'pino';

/** Construction options of {@link FifoLock}. */
export interface FifoLockOptions {
  /** Logger for the warnings. */
  logger: pino.Logger;
  /** Fields naming the lock in every warning (e.g. `{ root }`, `{ key }`). */
  logFields: Record<string, unknown>;
  /** Lock name used in warning messages (e.g. `RootGitLock`). */
  name: string;
  /** A wait longer than this is logged (omit: waits are never logged). */
  waitWarnMs?: number;
  /** A hold longer than this is logged. */
  holdWarnMs: number;
  /** The error thrown when a bounded wait runs out. */
  timeoutError: (
    operation: string,
    waitMs: number,
    heldBy: string | undefined,
  ) => Error;
  /** Called whenever the lock becomes idle (nothing holds or waits). */
  onIdle?: () => void;
}

/** Human form of a duration in warning messages (`10 s`, `5 minutes`). */
function describeMs(ms: number): string {
  return ms % 60_000 === 0 && ms >= 60_000
    ? `${String(ms / 60_000)} minutes`
    : `${String(ms / 1000)} s`;
}

/** FIFO mutex. */
export class FifoLock {
  private tail: Promise<void> = Promise.resolve();
  private holder: string | undefined;
  private pending = 0;

  /** @param options - See {@link FifoLockOptions}. */
  constructor(private readonly options: FifoLockOptions) {}

  /** The operation holding the lock, if any. */
  get heldBy(): string | undefined {
    return this.holder;
  }

  /**
   * Run `work` while holding the lock. Callers queue in arrival order; the
   * lock is released when `work` settles, whatever its outcome. With
   * `waitMs`, a caller that does not acquire the lock in time never runs
   * `work` and throws the configured timeout error; its place in the queue
   * passes straight on, so later callers keep their order.
   *
   * @param operation - Operation name, for warnings and {@link heldBy}.
   * @param work - The work to run under the lock (must not take it again).
   * @param waitMs - Longest wait for the lock (omit: unbounded).
   * @returns What `work` returns.
   */
  async run<T>(
    operation: string,
    work: () => Promise<T>,
    waitMs?: number,
  ): Promise<T> {
    const { logger, logFields, name, waitWarnMs, holdWarnMs } = this.options;
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.pending++;

    const waitTimer =
      waitWarnMs === undefined
        ? undefined
        : setTimeout(() => {
            logger.warn(
              {
                ...logFields,
                operation,
                heldBy: this.holder,
                waitMs: waitWarnMs,
              },
              `Waiting over ${describeMs(waitWarnMs)} for ${name}`,
            );
          }, waitWarnMs);
    waitTimer?.unref();
    if (waitMs === undefined) {
      await previous;
    } else if (!(await acquireWithin(previous, waitMs))) {
      clearTimeout(waitTimer);
      const heldBy = this.holder;
      void previous.then(() => {
        this.leave();
        release();
      });
      throw this.options.timeoutError(operation, waitMs, heldBy);
    }
    clearTimeout(waitTimer);
    this.holder = operation;
    const holdTimer = setTimeout(() => {
      logger.warn(
        { ...logFields, operation, holdMs: holdWarnMs },
        `${name} held over ${describeMs(holdWarnMs)}`,
      );
    }, holdWarnMs);
    holdTimer.unref();
    try {
      return await work();
    } finally {
      clearTimeout(holdTimer);
      this.holder = undefined;
      this.leave();
      release();
    }
  }

  /** One caller leaves the queue; report idleness. */
  private leave(): void {
    this.pending--;
    if (this.pending === 0) this.options.onIdle?.();
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
