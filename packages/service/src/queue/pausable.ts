/**
 * @module queue/pausable
 * The pause/resume/quiesce surface shared by the file event queue and the source notify queue, and a combinator that drives several queues as one (used by prune). No I/O.
 */

/**
 * A queue that can stop starting new work, resume, and report when its
 * in-flight work has finished. Prune uses this to quiesce every writer
 * before it computes and executes its plan.
 */
export interface PausableQueue {
  /** Stop starting new work; enqueues are still accepted. */
  pause(): void;
  /** Resume starting work. */
  resume(): void;
  /** Resolve once no work is in flight (queued work may remain). */
  waitForIdleWorkers(): Promise<void>;
}

/**
 * Combine queues so that pausing, resuming and waiting apply to all of them.
 *
 * @param queues - The queues to drive together (undefined entries are skipped).
 * @returns A single {@link PausableQueue}.
 */
export function combinePausableQueues(
  ...queues: Array<PausableQueue | undefined>
): PausableQueue {
  const members = queues.filter((q): q is PausableQueue => q !== undefined);
  return {
    pause: () => {
      for (const queue of members) queue.pause();
    },
    resume: () => {
      for (const queue of members) queue.resume();
    },
    waitForIdleWorkers: async () => {
      await Promise.all(members.map((queue) => queue.waitForIdleWorkers()));
    },
  };
}
