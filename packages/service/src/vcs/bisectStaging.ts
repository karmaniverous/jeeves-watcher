/**
 * @module vcs/bisectStaging
 * Staging bisection under a time budget (D72): a staging attempt that times out is split in halves and retried, until single paths; the whole batch never spends more than three times its first timeout (at most 30 minutes). Pure orchestration over an injected attempt.
 */

import { isGitTimeout } from './gitProcess';

/** Ceiling of a batch's bisection budget. */
export const BISECTION_BUDGET_MAX_MS = 30 * 60_000;

/**
 * Stage a set of paths with per-call timeouts; resolves with the over-cap
 * tracked paths (see `stageBatch`).
 */
export type StagingAttempt = (
  paths: string[],
  timeoutFor: (paths: number) => number,
) => Promise<string[]>;

/** Outcome of {@link stageWithBisection}. */
export interface BisectionResult {
  /** Over-cap tracked paths reported by the successful attempts. */
  overCap: string[];
  /** Paths not staged (they timed out alone, or the budget ran out). */
  unstaged: string[];
}

/** Options of {@link stageWithBisection}. */
export interface BisectionOptions {
  /** Path-list timeout. */
  timeoutFor: (paths: number) => number;
  /** Clock (tests). */
  now?: () => number;
  /** Called after each timed-out attempt (cleanup, logging). */
  onTimeout?: (paths: readonly string[]) => void;
  /**
   * Epoch ms the batch must end by, when set by the caller (one deadline
   * across a batch's retries, D72); default {@link bisectionDeadline}.
   */
  deadline?: number;
}

/**
 * End of a batch's staging budget: three times the batch's first timeout,
 * at most {@link BISECTION_BUDGET_MAX_MS}, from now.
 *
 * @param count - Paths in the batch.
 * @param timeoutFor - Path-list timeout.
 * @param now - Clock.
 * @returns Epoch ms.
 */
export function bisectionDeadline(
  count: number,
  timeoutFor: (paths: number) => number,
  now: () => number = Date.now,
): number {
  return now() + Math.min(BISECTION_BUDGET_MAX_MS, 3 * timeoutFor(count));
}

/**
 * Stage `files`, bisecting on timeouts. Only a git timeout splits an
 * attempt; any other failure propagates (D20 applies to the batch). Each
 * call's timeout is capped by the budget left, so the root's lock is
 * released within the budget.
 *
 * @param files - The batch.
 * @param attempt - Stages a subset.
 * @param options - Timeout function, clock and timeout hook.
 * @returns Over-cap paths and the paths left unstaged.
 */
export async function stageWithBisection(
  files: string[],
  attempt: StagingAttempt,
  options: BisectionOptions,
): Promise<BisectionResult> {
  const now = options.now ?? Date.now;
  const deadline =
    options.deadline ??
    bisectionDeadline(files.length, options.timeoutFor, now);
  const capped = (paths: number) =>
    Math.max(1, Math.min(options.timeoutFor(paths), deadline - now()));
  const result: BisectionResult = { overCap: [], unstaged: [] };

  const run = async (paths: string[]): Promise<void> => {
    if (paths.length === 0) return;
    if (now() >= deadline) {
      result.unstaged.push(...paths);
      return;
    }
    try {
      result.overCap.push(...(await attempt(paths, capped)));
    } catch (error) {
      if (!isGitTimeout(error)) throw error;
      options.onTimeout?.(paths);
      if (paths.length === 1) {
        result.unstaged.push(...paths);
        return;
      }
      const middle = Math.ceil(paths.length / 2);
      await run(paths.slice(0, middle));
      await run(paths.slice(middle));
    }
  };

  await run(files);
  return result;
}
