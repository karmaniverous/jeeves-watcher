/**
 * @module embedding/rateLimitedProvider
 * Shared token-bucket limiter wrapping an EmbeddingProvider: one token per embed() request (batch), 429 Retry-After pauses all callers, bounded retries. Sleeps via timers; no other I/O.
 */

import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';
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
  /** Cap on any single 429 pause, in ms (`Retry-After` included). */
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
    for (let attempt = 1; attempt <= attempts; attempt++) {
      await this.acquire(deadlineMs, lastError);
      try {
        return await this.inner.embed(texts);
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

  /** Pause every caller after a 429, honouring `Retry-After` up to the cap. */
  private pauseFor(
    error: EmbeddingRateLimitError,
    attempt: number,
    attempts: number,
  ): void {
    const requested =
      error.retryAfterMs ?? this.baseBackoffMs * 2 ** (attempt - 1);
    const pauseMs = Math.min(requested, this.maxBackoffMs);
    const now = Date.now();
    this.pausedUntilMs = Math.max(this.pausedUntilMs, now + pauseMs);

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
      const waitMs = Math.max(this.pauseRemainingMs(now), this.tokenWaitMs());

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
