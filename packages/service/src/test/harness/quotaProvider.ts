/**
 * @module test/harness/quotaProvider
 * Fake embedding provider metering a per-minute quota per item, like Gemini: a request whose texts would push the last 60 s past the quota is answered 429 (EmbeddingRateLimitError) with a chosen or exact retry delay. Can be armed to fail one request transiently and retry internally through `beforeRetry`. Records every request. No I/O.
 */

import { RATE_WINDOW_MS } from '../../embedding/itemRateWindow';
import { EmbeddingRateLimitError } from '../../embedding/rateLimitError';
import type { EmbeddingProvider } from '../../embedding/types';
import { sleep } from '../../util/sleep';

/** One request that reached the fake. */
export interface QuotaRequest {
  /** `Date.now()` when it arrived. */
  at: number;
  /** Texts it carried. */
  count: number;
  /** How it was answered. */
  outcome: 'ok' | 'rate-limited' | 'transient';
}

/** Options for {@link quotaProvider}. */
export interface QuotaProviderOptions {
  /** Items accepted in any 60 s. */
  quotaPerMinute: number;
  /**
   * Retry delay sent with a 429: a fixed ms value (Gemini sends `0` for a
   * per-minute quota) or `'exact'` (the time until the request would fit).
   */
  retryDelay: number | 'exact';
}

/** The fake provider and its record. */
export interface QuotaProvider {
  /** The provider to wrap in the limiter. */
  provider: EmbeddingProvider;
  /** Every request, in arrival order. */
  requests: QuotaRequest[];
  /** Most accepted items in any 60 s span so far. */
  peakItemsPerMinute: () => number;
  /**
   * Fail the next request with a transient (non-429) error; the fake then
   * waits `delayMs` and retries internally after awaiting `beforeRetry`,
   * as the Gemini provider does.
   */
  failTransientlyNext: (delayMs: number) => void;
}

/** Accepted items in the 60 s ending at `atMs`. */
function itemsInWindow(requests: QuotaRequest[], atMs: number): number {
  return requests
    .filter(
      (r) => r.outcome === 'ok' && r.at > atMs - RATE_WINDOW_MS && r.at <= atMs,
    )
    .reduce((sum, r) => sum + r.count, 0);
}

/**
 * Create a quota-metering fake provider (2-d vectors).
 *
 * @param options - Quota and retry delay.
 * @returns The fake and its record.
 */
export function quotaProvider(options: QuotaProviderOptions): QuotaProvider {
  const requests: QuotaRequest[] = [];
  let transientDelayMs: number | undefined;

  /** Answer one request against the quota. */
  const answer = (texts: string[]): number[][] => {
    const now = Date.now();
    const used = itemsInWindow(requests, now);
    if (used + texts.length > options.quotaPerMinute) {
      requests.push({ at: now, count: texts.length, outcome: 'rate-limited' });
      throw new EmbeddingRateLimitError(
        'Gemini API error 429: RESOURCE_EXHAUSTED',
        options.retryDelay === 'exact'
          ? exactDelayMs(texts.length, now)
          : options.retryDelay,
      );
    }
    requests.push({ at: now, count: texts.length, outcome: 'ok' });
    return texts.map(() => [0.1, 0.2]);
  };

  /** Time until `count` more items fit the quota window. */
  const exactDelayMs = (count: number, now: number): number => {
    const accepted = requests.filter(
      (r) => r.outcome === 'ok' && r.at > now - RATE_WINDOW_MS,
    );
    let excess = itemsInWindow(requests, now) + count - options.quotaPerMinute;
    for (const r of accepted) {
      excess -= r.count;
      if (excess <= 0) return r.at + RATE_WINDOW_MS - now;
    }
    return RATE_WINDOW_MS;
  };

  const provider: EmbeddingProvider = {
    dimensions: 2,
    embed: async (texts, embedOptions = {}) => {
      if (transientDelayMs !== undefined) {
        const delayMs = transientDelayMs;
        transientDelayMs = undefined;
        requests.push({
          at: Date.now(),
          count: texts.length,
          outcome: 'transient',
        });
        await sleep(delayMs);
        await embedOptions.beforeRetry?.();
      }
      return answer(texts);
    },
  };

  return {
    provider,
    requests,
    peakItemsPerMinute: () =>
      Math.max(
        0,
        ...requests
          .filter((r) => r.outcome === 'ok')
          .map((r) => itemsInWindow(requests, r.at)),
      ),
    failTransientlyNext: (delayMs) => {
      transientDelayMs = delayMs;
    },
  };
}
