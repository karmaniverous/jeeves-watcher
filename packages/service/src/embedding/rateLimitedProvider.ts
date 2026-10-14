/**
 * @module embedding/rateLimitedProvider
 * Shared token-bucket limiter wrapping an EmbeddingProvider: one token per HTTP request (internal provider retries included), 429 Retry-After pauses all callers (fail fast beyond maxBackoffMs), bounded retries. Sleeps via timers; no other I/O.
 *
 * 429 handling: a `Retry-After` within `maxBackoffMs` is honoured in full and
 * pauses every caller. A longer `Retry-After` is not waited for: the call
 * fails at once with `EmbeddingUnavailableError` (carrying `retryAfterMs`)
 * instead of retrying early and burning attempts, and every other call fails
 * the same way until the provider's pause has fully passed (even once the
 * time left has dropped below `maxBackoffMs`). Without `Retry-After`,
 * the pause backs off exponentially from `baseBackoffMs`, capped at
 * `maxBackoffMs`.
 */

import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';
import { computeDelayMs } from '../util/retry';
import { sleep } from '../util/sleep';
import {
  EmbeddingRateLimitError,
  EmbeddingUnavailableError,
} from './rateLimitError';
import type { EmbeddingProvider, EmbedOptions } from './types';

/** Default provider attempts per call when the caller sets no budget. */
const DEFAULT_ATTEMPTS = 5;

/** Base pause after a 429 without `Retry-After` (doubles per attempt). */
const DEFAULT_BASE_BACKOFF_MS = 1000;

/** Options for {@link RateLimitedEmbeddingProvider}. */
export interface RateLimitedEmbeddingProviderOptions {
  /**
   * Embedding requests (embed() calls) per minute; also the burst size.
   * Unset means no request-rate limit (429 pauses still apply).
   */
  rateLimitPerMinute?: number;
  /**
   * Longest 429 pause waited for, in ms. A longer `Retry-After` fails the
   * call fast with `EmbeddingUnavailableError`; computed backoff is capped.
   */
  maxBackoffMs: number;
  /** Default provider attempts per call. Default: 5. */
  attempts?: number;
  /** Base pause after a 429 without `Retry-After`, in ms. Default: 1000. */
  baseBackoffMs?: number;
  /** Logger for pause warnings. */
  logger?: pino.Logger;
}

/**
 * An {@link EmbeddingProvider} decorator that draws every request from one
 * shared token bucket. Created once at startup and shared by the watch
 * queue, reindex and search, so all paths spend the same budget.
 */
export class RateLimitedEmbeddingProvider implements EmbeddingProvider {
  /** Dimensions of the wrapped provider. */
  readonly dimensions: number;

  private readonly inner: EmbeddingProvider;
  private readonly rateLimitPerMinute: number | undefined;
  private readonly maxBackoffMs: number;
  private readonly attempts: number;
  private readonly baseBackoffMs: number;
  private readonly logger: pino.Logger | undefined;

  private tokens: number;
  private lastRefillMs = Date.now();
  private pausedUntilMs = 0;
  /**
   * End of the latest pause that was over `maxBackoffMs` when requested.
   * Until then every caller fails fast, even once the remaining time has
   * dropped below `maxBackoffMs`.
   */
  private failFastUntilMs = 0;

  /**
   * @param inner - The provider to rate-limit.
   * @param options - Limiter settings.
   */
  constructor(
    inner: EmbeddingProvider,
    options: RateLimitedEmbeddingProviderOptions,
  ) {
    this.inner = inner;
    this.dimensions = inner.dimensions;
    this.rateLimitPerMinute =
      options.rateLimitPerMinute !== undefined && options.rateLimitPerMinute > 0
        ? options.rateLimitPerMinute
        : undefined;
    this.maxBackoffMs = Math.max(0, options.maxBackoffMs);
    this.attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.logger = options.logger;
    this.tokens = this.rateLimitPerMinute ?? Number.POSITIVE_INFINITY;
  }

  /**
   * Embed texts as one provider request, waiting for a token and retrying
   * 429s within the call's budget.
   *
   * @param texts - Texts to embed (one request, regardless of count).
   * @param options - Per-call attempt and wait budget.
   * @returns The embedding vectors.
   * @throws EmbeddingUnavailableError when the budget is exhausted.
   */
  async embed(
    texts: string[],
    options: EmbedOptions = {},
  ): Promise<number[][]> {
    const attempts = Math.max(1, options.attempts ?? this.attempts);
    const deadlineMs =
      options.maxWaitMs === undefined
        ? undefined
        : Date.now() + options.maxWaitMs;

    let lastError: EmbeddingRateLimitError | undefined;
    // Each internal provider retry is a request too: it takes a token.
    const beforeRetry = () => this.acquire(deadlineMs, lastError);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      await this.acquire(deadlineMs, lastError);
      try {
        return await this.inner.embed(texts, { beforeRetry });
      } catch (error) {
        if (!(error instanceof EmbeddingRateLimitError)) throw error;
        lastError = error;
        this.pauseFor(error, attempt, attempts);
      }
    }

    throw new EmbeddingUnavailableError(
      `Embedding provider still rate-limited after ${String(attempts)} attempts: ${lastError?.message ?? 'unknown error'}`,
      { cause: lastError, retryAfterMs: this.pauseRemainingMs(Date.now()) },
    );
  }

  /**
   * Pause every caller after a 429: `Retry-After` in full, or exponential
   * backoff capped at `maxBackoffMs`.
   *
   * @throws EmbeddingUnavailableError when `Retry-After` exceeds `maxBackoffMs`.
   */
  private pauseFor(
    error: EmbeddingRateLimitError,
    attempt: number,
    attempts: number,
  ): void {
    const { retryAfterMs } = error;
    const pauseMs =
      retryAfterMs ??
      computeDelayMs(attempt, this.baseBackoffMs, this.maxBackoffMs);
    const now = Date.now();
    this.pausedUntilMs = Math.max(this.pausedUntilMs, now + pauseMs);
    if (pauseMs > this.maxBackoffMs) {
      this.failFastUntilMs = Math.max(this.failFastUntilMs, now + pauseMs);
    }

    this.logger?.warn(
      {
        attempt,
        attempts,
        pauseMs,
        retryAfterMs: error.retryAfterMs,
        err: normalizeError(error),
      },
      'Embedding provider rate-limited; pausing all embedding requests',
    );
    if (pauseMs > this.maxBackoffMs) throw this.pauseTooLong(pauseMs, error);
  }

  /** The fail-fast error for a provider pause requested longer than `maxBackoffMs`. */
  private pauseTooLong(
    waitMs: number,
    cause: EmbeddingRateLimitError | undefined,
  ): EmbeddingUnavailableError {
    return new EmbeddingUnavailableError(
      `Embedding provider asked to wait ${String(waitMs)} ms, more than maxBackoffMs (${String(this.maxBackoffMs)} ms)`,
      { cause, retryAfterMs: waitMs },
    );
  }

  /** Milliseconds until the current 429 pause ends (0 when not paused). */
  private pauseRemainingMs(nowMs: number): number {
    return Math.max(0, this.pausedUntilMs - nowMs);
  }

  /** Refill the bucket for the time elapsed since the last refill. */
  private refill(nowMs: number): void {
    if (this.rateLimitPerMinute === undefined) return;
    const elapsed = Math.max(0, nowMs - this.lastRefillMs);
    this.tokens = Math.min(
      this.rateLimitPerMinute,
      this.tokens + (elapsed * this.rateLimitPerMinute) / 60_000,
    );
    this.lastRefillMs = nowMs;
  }

  /** Milliseconds until one whole token is available (0 if one is). */
  private tokenWaitMs(): number {
    if (this.rateLimitPerMinute === undefined || this.tokens >= 1) return 0;
    return Math.ceil(((1 - this.tokens) * 60_000) / this.rateLimitPerMinute);
  }

  /**
   * Wait until the limiter is not paused and a token is available, then
   * take the token. Fails fast when the wait would pass the deadline.
   */
  private async acquire(
    deadlineMs: number | undefined,
    cause: EmbeddingRateLimitError | undefined,
  ): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.refill(now);
      const pauseMs = this.pauseRemainingMs(now);
      if (pauseMs > this.maxBackoffMs || now < this.failFastUntilMs) {
        throw this.pauseTooLong(pauseMs, cause);
      }
      const waitMs = Math.max(pauseMs, this.tokenWaitMs());

      if (waitMs === 0) {
        this.tokens -= 1;
        return;
      }

      if (deadlineMs !== undefined && now + waitMs > deadlineMs) {
        throw new EmbeddingUnavailableError(
          `Embedding rate limit wait of ${String(waitMs)} ms exceeds the request budget`,
          { cause, retryAfterMs: waitMs },
        );
      }

      await sleep(waitMs);
    }
  }
}
