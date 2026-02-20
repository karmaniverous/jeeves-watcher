import { createHash } from 'node:crypto';

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
 * Create a mock embedding provider that generates deterministic vectors from content hashes.
 *
 * @param dimensions - The number of dimensions for the output vectors.
 * @returns A mock {@link EmbeddingProvider}.
 */
function createMockProvider(dimensions: number): EmbeddingProvider {
  return {
    dimensions,
    embed(texts: string[]): Promise<number[][]> {
      return Promise.resolve(
        texts.map((text) => {
          const hash = createHash('sha256').update(text, 'utf8').digest();
          const vector: number[] = [];
          for (let i = 0; i < dimensions; i++) {
            // Use bytes cyclically from the hash to generate deterministic floats in [-1, 1]
            const byte = hash[i % hash.length];
            vector.push(byte / 127.5 - 1);
          }
          return vector;
        }),
      );
    },
  };
}

// TODO: Implement Gemini provider using @langchain/google-genai

/**
 * Create an embedding provider based on the given configuration.
 *
 * @param config - The embedding configuration.
 * @returns An {@link EmbeddingProvider} instance.
 * @throws If the configured provider is not supported.
 */
export function createEmbeddingProvider(
  config: EmbeddingConfig,
): EmbeddingProvider {
  const dimensions = config.dimensions ?? 768;

  switch (config.provider) {
    case 'mock':
      return createMockProvider(dimensions);
    default:
      throw new Error(`Unsupported embedding provider: ${config.provider}`);
  }
}
