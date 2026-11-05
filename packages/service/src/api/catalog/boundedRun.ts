/**
 * @module api/catalog/boundedRun
 * Run keyed tasks a few at a time within a time budget (spec Design 12, D96): each task gets the whole seconds left as its timeout; once the budget is spent no task starts and in-flight results are discarded, and the caller learns which keys were not finished. The first task failure inside the budget is thrown. Timers only.
 */

/** One keyed task; `run` receives the seconds left in the budget (at least 1). */
export interface BoundedTask<T> {
  /** Key reported in `pending` when the task did not finish in time. */
  key: string;
  /** Start the task. */
  run: (timeoutS: number) => Promise<T>;
}

/** Limits of {@link runBounded}. */
export interface BoundedRunOptions {
  /** Most tasks running at once. */
  concurrency: number;
  /** Time budget for the whole run, ms. */
  budgetMs: number;
  /** Clock (ms); defaults to `Date.now`. */
  now?: () => number;
}

/** Outcome of {@link runBounded}. */
export interface BoundedRunResult<T> {
  /** Results of the tasks that finished within the budget, by key. */
  results: Map<string, T>;
  /** Keys of the tasks not finished within the budget, in task order. */
  pending: string[];
}

/** What {@link withinBudget} resolves to when the budget ran out first. */
export const OUT_OF_BUDGET: unique symbol = Symbol('out of budget');

/**
 * Wait for a promise for at most `budgetMs` (its result is discarded past
 * that).
 *
 * @param promise - The work.
 * @param budgetMs - Time left, ms.
 * @returns Its result, or {@link OUT_OF_BUDGET}.
 */
export async function withinBudget<T>(
  promise: Promise<T>,
  budgetMs: number,
): Promise<T | typeof OUT_OF_BUDGET> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const out = new Promise<typeof OUT_OF_BUDGET>((resolve) => {
    timer = setTimeout(
      () => {
        resolve(OUT_OF_BUDGET);
      },
      Math.max(0, budgetMs),
    );
  });
  try {
    return await Promise.race([promise, out]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run tasks at most `concurrency` at a time within `budgetMs`.
 *
 * @param tasks - The tasks, started in order.
 * @param options - Concurrency, budget and clock.
 * @returns The finished results and the keys left pending.
 * @throws The first task error raised within the budget.
 */
export async function runBounded<T>(
  tasks: ReadonlyArray<BoundedTask<T>>,
  options: BoundedRunOptions,
): Promise<BoundedRunResult<T>> {
  const now = options.now ?? Date.now;
  const deadline = now() + options.budgetMs;
  const results = new Map<string, T>();
  let next = 0;
  let stopped = false;
  // Read through a call: another worker or the budget may stop the run
  // while this worker awaits its task.
  const isStopped = (): boolean => stopped;
  let failure: { error: unknown } | undefined;
  // Settles as soon as one task fails: the other workers' in-flight tasks
  // may still be running, and their results no longer matter.
  let signalFailure: () => void = () => undefined;
  const failed = new Promise<void>((resolve) => {
    signalFailure = resolve;
  });

  const worker = async (): Promise<void> => {
    while (!isStopped() && now() < deadline && next < tasks.length) {
      const task = tasks[next++];
      const timeoutS = Math.max(1, Math.ceil((deadline - now()) / 1000));
      try {
        const result = await task.run(timeoutS);
        if (!isStopped()) results.set(task.key, result);
      } catch (error) {
        if (!isStopped()) {
          failure = { error };
          stopped = true;
          signalFailure();
        }
      }
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, Math.max(0, deadline - now()));
  });
  const workers = Array.from(
    { length: Math.min(options.concurrency, tasks.length) },
    worker,
  );
  await Promise.race([Promise.all(workers), budget, failed]);
  stopped = true;
  clearTimeout(timer);

  if (failure) throw failure.error;
  return {
    results,
    pending: tasks.map((t) => t.key).filter((key) => !results.has(key)),
  };
}
