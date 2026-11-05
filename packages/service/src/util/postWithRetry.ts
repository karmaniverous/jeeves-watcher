/**
 * @module util/postWithRetry
 * POST a JSON payload with retry (3 attempts, 1 s base, 4 s cap) and a 10 s timeout per attempt (D138, D180); a failed delivery is logged, never thrown. Shared by the reindex callback and the embedding alert. Network I/O via fetch.
 */

import type pino from 'pino';

import { normalizeError } from './normalizeError';
import { retry } from './retry';

/** Longest wait for one attempt; a timed-out attempt counts as failed. */
export const POST_ATTEMPT_TIMEOUT_MS = 10_000;

/** Retry policy of every webhook delivery. */
export const POST_RETRY = { attempts: 3, baseDelayMs: 1000, maxDelayMs: 4000 };

/** Options of {@link postWithRetry}. */
export interface PostWithRetryOptions {
  /** What is being delivered, in log messages (default `Webhook`). */
  label?: string;
  /** Extra fields on the log lines. */
  logFields?: Record<string, unknown>;
  /** Per-attempt timeout (default {@link POST_ATTEMPT_TIMEOUT_MS}; tests). */
  timeoutMs?: number;
  /** Retry delays (default {@link POST_RETRY}; tests). */
  retry?: Partial<typeof POST_RETRY>;
}

/**
 * POST `payload` as JSON to `url`. A non-2xx response, a network error and a
 * timed-out attempt each count as a failed attempt. Never rejects.
 *
 * @param url - Destination.
 * @param payload - JSON body.
 * @param logger - Logger for retry warnings and the final failure.
 * @param options - Label, log fields, timeout and retry overrides.
 * @returns True when an attempt succeeded; false when every attempt failed.
 */
export async function postWithRetry(
  url: string,
  payload: Record<string, unknown>,
  logger: pino.Logger,
  options: PostWithRetryOptions = {},
): Promise<boolean> {
  const label = options.label ?? 'Webhook';
  const timeoutMs = options.timeoutMs ?? POST_ATTEMPT_TIMEOUT_MS;
  const fields = { url, ...options.logFields };
  try {
    await retry(
      async () => {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
          throw new Error(`Non-OK response: ${String(response.status)}`);
        }
      },
      {
        ...POST_RETRY,
        ...options.retry,
        onRetry: ({ attempt, error }) => {
          logger.warn(
            { attempt, err: normalizeError(error), ...fields },
            `${label} failed; will retry`,
          );
        },
      },
    );
    return true;
  } catch (error) {
    logger.error(
      { err: normalizeError(error), ...fields },
      `${label} delivery failed; giving up`,
    );
    return false;
  }
}
