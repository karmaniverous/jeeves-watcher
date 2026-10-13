/**
 * @module embedding/types
 * Embedding provider type definitions.
 */

import type pino from 'pino';

import type { EmbeddingConfig } from '../config/types';

/**
 * Per-call budget for the shared rate limiter. Providers that do not
 * rate-limit ignore the budget; providers that retry internally await
 * `beforeRetry` before each retry.
 *
 * The budget bounds the limiter, not the provider's own network retries:
 * each of the `attempts` provider calls may itself retry a transient
 * (non-429) failure up to `NETWORK_RETRY_POLICY.attempts` times in all, with
 * backoff sleeps, so one `embed()` can issue up to `attempts` x 5 HTTP
 * requests.
 */
export interface EmbedOptions {
  /**
   * Maximum provider calls for this call: a 429 ends a provider call and
   * costs one attempt. Transient network retries inside a provider call do
   * not count against it (see the interface note).
   */
  attempts?: number;
  /**
   * Maximum total time to wait for the limiter (token or `Retry-After`
   * pause), in ms. When a wait would exceed it, the call fails fast. The
   * provider's own network-retry backoff sleeps are not counted.
   */
  maxWaitMs?: number;
  /**
   * Awaited by a provider before each retry it makes internally (any HTTP
   * request after the first of an `embed()` call), so every request draws
   * from the shared limiter. Supplied by the rate-limited wrapper; it may
   * reject (e.g. `EmbeddingUnavailableError`), which the provider must
   * propagate without retrying.
   */
  beforeRetry?: () => Promise<void>;
}

/**
 * An embedding provider that converts text into vector representations.
 */
export interface EmbeddingProvider {
  /** Generate embedding vectors for the given texts (one provider request). */
  embed(texts: string[], options?: EmbedOptions): Promise<number[][]>;
  /** The dimensionality of the embedding vectors. */
  dimensions: number;
}

/**
 * Factory function for creating embedding providers.
 */
export type ProviderFactory = (
  config: EmbeddingConfig,
  logger?: pino.Logger,
) => EmbeddingProvider;
