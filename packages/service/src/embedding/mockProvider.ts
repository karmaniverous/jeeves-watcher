/**
 * @module embedding/mockProvider
 * Mock embedding provider for testing and development.
 */

import { createHash } from 'node:crypto';

import type { EmbeddingConfig } from '../config/types';
import type { EmbeddingProvider } from './types';

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

/**
 * Create a mock provider from configuration.
 *
 * @param config - The embedding configuration.
 * @returns A mock {@link EmbeddingProvider}.
 */
export function createMockFromConfig(
  config: EmbeddingConfig,
): EmbeddingProvider {
  const dimensions = config.dimensions ?? 768;
  return createMockProvider(dimensions);
}
