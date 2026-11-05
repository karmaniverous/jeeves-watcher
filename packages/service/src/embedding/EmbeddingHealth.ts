/**
 * @module embedding/EmbeddingHealth
 * Embedding health (D86, D88, D89): wraps the shared rate-limited provider and tracks ok/failing (3+ failures since the last success and 60 s without one), with transition logs and alerts. Health shows codes, never provider text.
 *
 * A rate-limit wait that later succeeds is not a failure; any error a call
 * throws (including a fail-fast `EmbeddingUnavailableError`) is. The first
 * success returns the state to `ok`.
 */

import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';
import { EmbeddingUnavailableError } from './rateLimitError';
import type { EmbeddingProvider, EmbedOptions } from './types';

/** Failures since the last success needed to turn `failing`. */
export const FAILING_MIN_FAILURES = 3;

/** Time without a success needed to turn `failing` (ms). */
export const FAILING_MIN_MS = 60_000;

/** Embedding health state. */
export type EmbeddingHealthState = 'ok' | 'failing';

/** The most recent embedding error: when, and a machine-readable code. */
export interface EmbeddingErrorSummary {
  /** ISO timestamp. */
  at: string;
  /** `rate_limited`, `timeout`, `http_<status>`, `network` or `error`. */
  code: string;
}

/** `GET /status` `health.embedding`. */
export interface EmbeddingHealthSnapshot {
  /** `ok` or `failing`. */
  state: EmbeddingHealthState;
  /** Last successful call (ISO), `null` before the first. */
  lastSuccessAt: string | null;
  /** Most recent error, `null` if none yet. */
  lastError: EmbeddingErrorSummary | null;
  /** When the state turned `failing` (ISO), `null` while `ok`. */
  failingSince: string | null;
  /** End of the stored provider back-off (ISO), `null` if none. */
  backoffUntil: string | null;
}

/** A state change, as alerted (`embedding_failed` / `embedding_recovered`). */
export interface EmbeddingTransition {
  /** The event. */
  event: 'embedding_failed' | 'embedding_recovered';
  /** When (ISO). */
  at: string;
  /** When the outage began (ISO). */
  failingSince: string;
  /** The outage's most recent error, if any. */
  lastError?: EmbeddingErrorSummary;
}

/** The provider wrapped: a provider that may report its stored back-off. */
export type HealthTrackedProvider = EmbeddingProvider & {
  readonly backoffUntilMs?: number;
};

/** Options of {@link EmbeddingHealth}. */
export interface EmbeddingHealthOptions {
  /** Logger for the transition lines. */
  logger: pino.Logger;
  /** Called on each transition (e.g. the alert POST); never awaited. */
  onTransition?: (transition: EmbeddingTransition) => void;
  /** Clock (epoch ms); tests inject a fake one. */
  now?: () => number;
}

/**
 * The code of an embedding error (no provider text).
 *
 * @param error - What the call threw.
 * @returns `rate_limited`, `timeout`, `http_<status>`, `network` or `error`.
 */
export function embeddingErrorCode(error: unknown): string {
  if (error instanceof EmbeddingUnavailableError) return 'rate_limited';
  if (!(error instanceof Error)) return 'error';
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return 'timeout';
  }
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') return `http_${String(status)}`;
  const fromMessage = /\bAPI error (\d{3})\b/u.exec(error.message);
  if (fromMessage) return `http_${fromMessage[1]}`;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && /^E[A-Z]+$/u.test(code)) return 'network';
  return 'error';
}

/** Health-tracking decorator of the shared embedding provider. */
export class EmbeddingHealth implements EmbeddingProvider {
  /** Dimensions of the wrapped provider. */
  readonly dimensions: number;

  private readonly now: () => number;
  private readonly startedAtMs: number;
  private state: EmbeddingHealthState = 'ok';
  private lastSuccessMs: number | undefined;
  private lastError: EmbeddingErrorSummary | undefined;
  private failingSinceMs: number | undefined;
  private failures = 0;

  /**
   * @param inner - The shared (rate-limited) provider.
   * @param options - Logger, transition callback, clock.
   */
  constructor(
    private readonly inner: HealthTrackedProvider,
    private readonly options: EmbeddingHealthOptions,
  ) {
    this.dimensions = inner.dimensions;
    this.now = options.now ?? Date.now;
    this.startedAtMs = this.now();
  }

  /** {@inheritDoc EmbeddingProvider.embed} */
  async embed(texts: string[], options?: EmbedOptions): Promise<number[][]> {
    try {
      const vectors = await this.inner.embed(texts, options);
      this.recordSuccess();
      return vectors;
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  /** @returns The health snapshot (`GET /status` `health.embedding`). */
  snapshot(): EmbeddingHealthSnapshot {
    const backoff = this.inner.backoffUntilMs;
    return {
      state: this.state,
      lastSuccessAt: iso(this.lastSuccessMs),
      lastError: this.lastError ?? null,
      failingSince: iso(this.failingSinceMs),
      backoffUntil: iso(backoff),
    };
  }

  /** Record a successful call. */
  private recordSuccess(): void {
    const now = this.now();
    this.lastSuccessMs = now;
    this.failures = 0;
    if (this.state === 'failing') {
      const failingSince = this.failingSinceMs ?? now;
      this.state = 'ok';
      this.failingSinceMs = undefined;
      this.options.logger.info(
        { failingSince: new Date(failingSince).toISOString() },
        'Embedding provider recovered',
      );
      this.transition('embedding_recovered', now, failingSince);
    }
  }

  /** Record a failed call. */
  private recordFailure(error: unknown): void {
    const now = this.now();
    this.lastError = {
      at: new Date(now).toISOString(),
      code: embeddingErrorCode(error),
    };
    this.failures++;
    if (
      this.state === 'ok' &&
      this.failures >= FAILING_MIN_FAILURES &&
      now - (this.lastSuccessMs ?? this.startedAtMs) >= FAILING_MIN_MS
    ) {
      this.state = 'failing';
      this.failingSinceMs = now;
      this.options.logger.error(
        {
          failures: this.failures,
          lastSuccessAt: iso(this.lastSuccessMs),
          code: this.lastError.code,
          err: normalizeError(error),
        },
        'Embedding provider failing',
      );
      this.transition('embedding_failed', now, now);
    }
  }

  private transition(
    event: EmbeddingTransition['event'],
    now: number,
    failingSince: number,
  ): void {
    this.options.onTransition?.({
      event,
      at: new Date(now).toISOString(),
      failingSince: new Date(failingSince).toISOString(),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    });
  }
}

/** ISO form of an epoch-ms time, or `null`. */
function iso(ms: number | undefined): string | null {
  return ms === undefined ? null : new Date(ms).toISOString();
}
