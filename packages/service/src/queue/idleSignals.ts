/**
 * @module queue/idleSignals
 * Waiter bookkeeping shared by the queues: promises for "no work in flight" (idle workers) and "nothing left at all" (drained), resolved when the owning queue reports its state. Pure, no I/O.
 */

/**
 * Drain and idle-worker waiters of a queue. The queue asks for a promise
 * with {@link waitForIdleWorkers} / {@link drain}, and calls {@link settle}
 * whenever its state may have changed.
 */
export class IdleSignals {
  private drainWaiters: Array<() => void> = [];
  private idleWaiters: Array<() => void> = [];

  /**
   * Resolve once no work is in flight.
   *
   * @param idleWorkers - Whether no work is in flight now.
   * @returns Resolves at once when idle; otherwise at the next idle {@link settle}.
   */
  waitForIdleWorkers(idleWorkers: boolean): Promise<void> {
    if (idleWorkers) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  /**
   * Resolve once the queue holds no work at all.
   *
   * @param drained - Whether the queue is drained now.
   * @returns Resolves at once when drained; otherwise at the next drained {@link settle}.
   */
  drain(drained: boolean): Promise<void> {
    if (drained) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.drainWaiters.push(resolve);
    });
  }

  /**
   * Resolve the waiters whose condition now holds.
   *
   * @param state - Whether no work is in flight, and whether nothing is left.
   */
  settle(state: { idleWorkers: boolean; drained: boolean }): void {
    if (state.idleWorkers) {
      const idle = this.idleWaiters;
      this.idleWaiters = [];
      for (const resolve of idle) resolve();
    }
    if (state.drained) {
      const drained = this.drainWaiters;
      this.drainWaiters = [];
      for (const resolve of drained) resolve();
    }
  }
}
