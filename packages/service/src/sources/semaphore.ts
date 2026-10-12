/**
 * @module sources/semaphore
 * Minimal counting semaphore (FIFO waiters) used to cap parallel callbacks per source. In-memory; no I/O.
 */

/** A counting semaphore with FIFO hand-off. */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  /**
   * @param limit - Maximum concurrent holders (positive integer).
   */
  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError('Semaphore limit must be a positive integer');
    }
    this.available = limit;
  }

  /**
   * Run a task while holding a slot; the slot is released when the task
   * settles, whether it resolves or rejects.
   *
   * @param task - The work to run.
   * @returns The task's result.
   */
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    // Hand the slot straight to the next waiter; otherwise return it.
    if (next) next();
    else this.available += 1;
  }
}
