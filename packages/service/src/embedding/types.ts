/**
 * @module embedding/types
 * Embedding provider type definitions.
 */

import type pino from 'pino';

import type { EmbeddingConfig } from '../config/types';

/**
 * An embedding provider that converts text into vector representations.
 */
export interface EmbeddingProvider {
  /** Generate embedding vectors for the given texts. */
  embed(texts: string[]): Promise<number[][]>;
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
