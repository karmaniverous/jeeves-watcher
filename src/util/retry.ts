/**
 * @module util/retry
 * Small async retry helper with exponential backoff. Side effects: sleeps between attempts; can invoke onRetry callback for logging.
 */

export interface RetryOptions {
  /** Maximum number of attempts (including the first try). */
  attempts: number;
  /** Base delay in milliseconds for exponential backoff (attempt 1 => baseDelayMs). */
  baseDelayMs: number;
  /** Maximum delay in milliseconds between attempts. */
  maxDelayMs: number;
  /** Random jitter factor in [0, jitter], applied to delay (e.g., 0.2 => up to +20%). */
  jitter?: number;
  /** Called before sleeping between retries (not called on final failure). */
  onRetry?: (context: {
    attempt: number;
    attempts: number;
    delayMs: number;
    error: unknown;
  }) => void;
  /** Optional signal to cancel retry sleep. */
  signal?: AbortSignal;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(new Error('Retry sleep aborted'));
    };

    const cleanup = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function computeDelayMs(
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

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const isLast = attempt >= attempts;
      if (isLast) break;

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
