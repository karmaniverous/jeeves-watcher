/**
 * @module embedding
 *
 * Embedding provider abstractions and registry-backed factory.
 */

import type pino from 'pino';

import type { EmbeddingConfig } from '../config/types';
import { createGeminiProvider } from './geminiProvider';
import { createMockFromConfig } from './mockProvider';
import type { EmbeddingProvider, ProviderFactory } from './types';

// Re-export types for public API
export type { EmbeddingProvider, ProviderFactory };

const embeddingProviderRegistry = new Map<string, ProviderFactory>([
  ['mock', createMockFromConfig],
  ['gemini', createGeminiProvider],
]);

/**
 * Create an embedding provider based on the given configuration.
 *
 * Each provider is responsible for its own default dimensions.
 *
 * @param config - The embedding configuration.
 * @param logger - Optional pino logger for retry warnings.
 * @param additionalProviders - Optional map of additional provider factories to register.
 * @returns An {@link EmbeddingProvider} instance.
 * @throws If the configured provider is not supported.
 */
export function createEmbeddingProvider(
  config: EmbeddingConfig,
  logger?: pino.Logger,
  additionalProviders?: Map<string, ProviderFactory>,
): EmbeddingProvider {
  // Merge additional providers with built-in registry
  const registry = new Map(embeddingProviderRegistry);
  if (additionalProviders) {
    for (const [name, factory] of additionalProviders) {
      registry.set(name, factory);
    }
  }

  const factory = registry.get(config.provider);
  if (!factory) {
    throw new Error(`Unsupported embedding provider: ${config.provider}`);
  }

  return factory(config, logger);
}
