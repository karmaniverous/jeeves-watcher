/**
 * @module util/retry
 * Small async retry helper with exponential backoff. Side effects: sleeps between attempts; can invoke onRetry callback for logging.
 */

import { sleep } from './sleep';

interface RetryOptions {
  /** Maximum number of attempts (including the first try). */
  attempts: number;
  /** Base delay in milliseconds for exponential backoff (attempt 1 uses baseDelayMs). */
  baseDelayMs: number;
  /** Maximum delay in milliseconds between attempts. */
  maxDelayMs: number;
  /** Random jitter factor in [0, jitter], applied to delay (e.g., 0.2 means up to +20%). */
  jitter?: number;
  /** Called before sleeping between retries (not called on final failure). */
  onRetry?: (context: {
    attempt: number;
    attempts: number;
    delayMs: number;
    error: unknown;
  }) => void;
  /**
   * Decide whether a given error is worth retrying. Defaults to retrying
   * every error (preserves prior behaviour for existing callers). Return
   * false to fail fast on the first attempt instead of exhausting
   * `attempts` on a deterministic error.
   */
  shouldRetry?: (error: unknown) => boolean;
  /** Optional signal to cancel retry sleep. */
  signal?: AbortSignal;
}

/** Retry timing: attempt count and backoff (see {@link retry}). */
export type RetryPolicy = Pick<
  RetryOptions,
  'attempts' | 'baseDelayMs' | 'maxDelayMs' | 'jitter'
>;

/**
 * The retry policy for transient network failures of a single remote call
 * (Qdrant writes, embedding HTTP requests): 5 attempts, exponential backoff
 * from 500 ms capped at 10 s, up to +20% jitter.
 */
export const NETWORK_RETRY_POLICY: Readonly<RetryPolicy> = {
  attempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  jitter: 0.2,
};

/**
 * Exponential backoff delay before retrying after a failed attempt:
 * `baseDelayMs * 2^(attempt - 1)`, capped at `maxDelayMs`, then increased by
 * a random factor in `[0, jitter]`.
 *
 * @param attempt - The 1-based attempt that failed.
 * @param baseDelayMs - Delay after the first failure.
 * @param maxDelayMs - Cap before jitter.
 * @param jitter - Random jitter factor (0 for none).
 * @returns The delay in milliseconds (rounded).
 */
export function computeDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter = 0,
): number {
  const exp = Math.max(0, attempt - 1);
  const raw = Math.min(maxDelayMs, baseDelayMs * 2 ** exp);
  const factor = jitter > 0 ? 1 + Math.random() * jitter : 1;
  return Math.round(raw * factor);
}

/**
 * Retry an async operation using exponential backoff.
 *
 * @param fn - Operation to execute.
 * @param options - Retry policy.
 * @returns The operation result.
 */
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const attempts = Math.max(1, options.attempts);

  const shouldRetry = options.shouldRetry ?? (() => true);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const isLast = attempt >= attempts;
      if (isLast || !shouldRetry(error)) break;

      const delayMs = computeDelayMs(
        attempt,
        options.baseDelayMs,
        options.maxDelayMs,
        options.jitter,
      );

      options.onRetry?.({ attempt, attempts, delayMs, error });
      await sleep(delayMs, options.signal);
    }
  }

  throw lastError;
}
