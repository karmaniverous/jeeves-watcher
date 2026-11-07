/**
 * @module embedding/rateLimitedProvider
 * Shared limiter wrapping an EmbeddingProvider: at most `rateLimitPerMinute` items (texts) in any 60 s, internal provider retries included; a 429 pauses all callers (fail fast beyond the ceiling); bounded retries. Sleeps via timers; no other I/O.
 *
 * Rate: every request takes one unit per text it embeds, from a sliding
 * 60-second window ({@link ItemRateWindow}), because providers meter
 * embedding quota per item (Gemini `batchEmbedContents` counts each
 * content). A batch larger than the limit is split into requests that fit.
 *
 * 429 handling: the pause is the provider's requested delay (`Retry-After`,
 * or Google's `RetryInfo.retryDelay`) or the exponential backoff from
 * `baseBackoffMs` (capped at `maxBackoffMs`), whichever is longer. A hint
 * shorter than the backoff (Gemini answers a per-minute quota with
 * `retryDelay: "0s"`) would otherwise spend every attempt within one quota
 * minute. The pause holds every caller. A requested delay over
 * `maxBackoffMs` is not waited for: the call fails at once with
 * `EmbeddingUnavailableError` (carrying `retryAfterMs`), and every other
 * call fails the same way until the pause has fully passed (even once the
 * time left has dropped below `maxBackoffMs`). The service passes
 * {@link embeddingPauseCeilingMs} as `maxBackoffMs`, so a per-minute quota's
 * delay (up to 65 s) is always waited for.
 *
 * A stored pause is capped at 5 minutes (B6, Design 8) and then expires: the
 * first call after it probes the provider, so a long `Retry-After` never
 * keeps the service failing until a restart. A success never lifts a pause:
 * a call is only sent once every earlier pause has expired, and a pause that
 * another call's 429 set while it was in flight must still hold for every
 * caller.
 */

import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';
import { computeDelayMs } from '../util/retry';
import { sleep } from '../util/sleep';
import { ItemRateWindow } from './itemRateWindow';
import {
  EmbeddingRateLimitError,
  EmbeddingUnavailableError,
} from './rateLimitError';
import type { EmbeddingProvider, EmbedOptions } from './types';

/**
 * Default provider attempts per call when the caller sets no budget: the
 * backoff between 7 attempts (1+2+4+8+16+32 s = 63 s) outlasts a
 * per-minute quota window.
 */
const DEFAULT_ATTEMPTS = 7;

/** Base pause after a 429 (doubles per attempt). */
const DEFAULT_BASE_BACKOFF_MS = 1000;

/** Longest stored provider pause; the first call after it is the probe. */
export const MAX_STORED_BACKOFF_MS = 5 * 60_000;

/** Shortest 429 pause ceiling: a per-minute quota's delay is always waited for. */
const MIN_PAUSE_CEILING_MS = 65_000;

/**
 * The longest 429 pause the service waits for: the root `maxBackoffMs`,
 * but never under {@link MIN_PAUSE_CEILING_MS}. Longer delays (a daily
 * quota) fail fast.
 *
 * @param maxBackoffMs - The configured root `maxBackoffMs`.
 * @returns The ceiling in ms.
 */
export function embeddingPauseCeilingMs(maxBackoffMs: number): number {
  return Math.max(maxBackoffMs, MIN_PAUSE_CEILING_MS);
}

/** Options for {@link RateLimitedEmbeddingProvider}. */
export interface RateLimitedEmbeddingProviderOptions {
  /**
   * Embeddings (items: texts) per minute; no 60 s span holds more, and a
   * batch larger than this is split. Unset or 0 means no rate limit (429
   * pauses still apply).
   */
  rateLimitPerMinute?: number;
  /**
   * Longest 429 pause waited for, in ms. A longer requested delay fails the
   * call fast with `EmbeddingUnavailableError`; computed backoff is capped.
   */
  maxBackoffMs: number;
  /** Default provider attempts per call. Default: 7. */
  attempts?: number;
  /** Base pause after a 429, in ms (doubles per attempt). Default: 1000. */
  baseBackoffMs?: number;
  /** Logger for pause warnings. */
  logger?: pino.Logger;
}

/**
 * An {@link EmbeddingProvider} decorator that draws every request from one
 * shared item budget. Created once at startup and shared by the watch
 * queue, reindex and search, so all paths spend the same budget.
 */
export class RateLimitedEmbeddingProvider implements EmbeddingProvider {
  /** Dimensions of the wrapped provider. */
  readonly dimensions: number;

  private readonly inner: EmbeddingProvider;
  private readonly window: ItemRateWindow | undefined;
  private readonly maxBackoffMs: number;
  private readonly attempts: number;
  private readonly baseBackoffMs: number;
  private readonly logger: pino.Logger | undefined;

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
    this.window =
      options.rateLimitPerMinute !== undefined && options.rateLimitPerMinute > 0
        ? new ItemRateWindow(options.rateLimitPerMinute)
        : undefined;
    this.maxBackoffMs = Math.max(0, options.maxBackoffMs);
    this.attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.logger = options.logger;
  }

  /**
   * End of the stored provider back-off (epoch ms), or `undefined` when
   * none is in force (`GET /status` `health.embedding.backoffUntil`).
   */
  get backoffUntilMs(): number | undefined {
    const until = Math.max(this.pausedUntilMs, this.failFastUntilMs);
    return until > Date.now() ? until : undefined;
  }

  /**
   * Embed texts, waiting for rate budget and retrying 429s within the
   * call's budget. A batch over the per-minute limit is sent as several
   * requests, in order; the budget covers them all.
   *
   * @param texts - Texts to embed.
   * @param options - Per-call attempt and wait budget.
   * @returns The embedding vectors, one per text, in order.
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

    const size = this.window?.limit ?? texts.length;
    if (texts.length <= size) {
      return this.embedRequest(texts, attempts, deadlineMs);
    }
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += size) {
      const slice = texts.slice(start, start + size);
      vectors.push(...(await this.embedRequest(slice, attempts, deadlineMs)));
    }
    return vectors;
  }

  /** One provider request (with its 429 retries) for texts that fit the window. */
  private async embedRequest(
    texts: string[],
    attempts: number,
    deadlineMs: number | undefined,
  ): Promise<number[][]> {
    let lastError: EmbeddingRateLimitError | undefined;
    // Each internal provider retry is a request too: it takes its items
    // and waits out any pause, like the first.
    const beforeRetry = () => this.acquire(texts.length, deadlineMs, lastError);
    for (let attempt = 1; ; attempt++) {
      await this.acquire(texts.length, deadlineMs, lastError);
      try {
        return await this.inner.embed(texts, { beforeRetry });
      } catch (error) {
        if (!(error instanceof EmbeddingRateLimitError)) throw error;
        lastError = error;
        this.pauseFor(error, attempt, attempts);
        if (attempt >= attempts) {
          throw new EmbeddingUnavailableError(
            `Embedding provider still rate-limited after ${String(attempts)} attempts: ${error.message}`,
            { cause: error, retryAfterMs: this.pauseRemainingMs(Date.now()) },
          );
        }
      }
    }
  }

  /**
   * Pause every caller after a 429: the requested delay or the exponential
   * backoff (capped at `maxBackoffMs`), whichever is longer.
   *
   * @throws EmbeddingUnavailableError when the requested delay exceeds `maxBackoffMs`.
   */
  private pauseFor(
    error: EmbeddingRateLimitError,
    attempt: number,
    attempts: number,
  ): void {
    const { retryAfterMs } = error;
    const pauseMs = Math.max(
      retryAfterMs ?? 0,
      computeDelayMs(attempt, this.baseBackoffMs, this.maxBackoffMs),
    );
    const now = Date.now();
    const storedMs = Math.min(pauseMs, MAX_STORED_BACKOFF_MS);
    this.pausedUntilMs = Math.max(this.pausedUntilMs, now + storedMs);
    if (pauseMs > this.maxBackoffMs) {
      this.failFastUntilMs = Math.max(this.failFastUntilMs, now + storedMs);
    }

    this.logger?.warn(
      {
        attempt,
        attempts,
        pauseMs,
        retryAfterMs,
        err: normalizeError(error),
      },
      'Embedding provider rate-limited; pausing all embedding requests',
    );
    if (pauseMs > this.maxBackoffMs) {
      throw this.pauseTooLong(pauseMs, error, storedMs);
    }
  }

  /**
   * The fail-fast error for a provider pause requested longer than
   * `maxBackoffMs`; `retryAfterMs` is when the next call probes (the
   * stored, capped pause), default `waitMs`.
   */
  private pauseTooLong(
    waitMs: number,
    cause: EmbeddingRateLimitError | undefined,
    retryAfterMs = waitMs,
  ): EmbeddingUnavailableError {
    return new EmbeddingUnavailableError(
      `Embedding provider asked to wait ${String(waitMs)} ms, more than maxBackoffMs (${String(this.maxBackoffMs)} ms)`,
      { cause, retryAfterMs },
    );
  }

  /** Milliseconds until the current 429 pause ends (0 when not paused). */
  private pauseRemainingMs(nowMs: number): number {
    return Math.max(0, this.pausedUntilMs - nowMs);
  }

  /**
   * Wait until the limiter is not paused and `count` items fit the rate
   * window, then take them. Fails fast when the wait would pass the
   * deadline.
   */
  private async acquire(
    count: number,
    deadlineMs: number | undefined,
    cause: EmbeddingRateLimitError | undefined,
  ): Promise<void> {
    for (;;) {
      const now = Date.now();
      const pauseMs = this.pauseRemainingMs(now);
      if (pauseMs > this.maxBackoffMs || now < this.failFastUntilMs) {
        throw this.pauseTooLong(pauseMs, cause);
      }
      const waitMs = Math.max(pauseMs, this.window?.waitMs(count, now) ?? 0);

      if (waitMs === 0) {
        this.window?.take(count, now);
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
