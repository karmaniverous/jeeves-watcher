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
 */
export interface EmbedOptions {
  /** Maximum provider attempts for this call (429 retries included). */
  attempts?: number;
  /**
   * Maximum total time to wait for the limiter (token or `Retry-After`
   * pause), in ms. When a wait would exceed it, the call fails fast.
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
