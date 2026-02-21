/**
 * @module embedding
 *
 * Embedding provider abstractions and registry-backed factory.
 */

import { createHash } from 'node:crypto';

import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';

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

/**
 * Create a Gemini embedding provider using the Google Generative AI SDK.
 *
 * @param config - The embedding configuration.
 * @returns A Gemini {@link EmbeddingProvider}.
 * @throws If the API key is missing.
 */
function createGeminiProvider(config: EmbeddingConfig): EmbeddingProvider {
  if (!config.apiKey) {
    throw new Error(
      'Gemini embedding provider requires config.embedding.apiKey',
    );
  }

  const dimensions = config.dimensions ?? 3072;
  const embedder = new GoogleGenerativeAIEmbeddings({
    apiKey: config.apiKey,
    model: config.model,
  });

  return {
    dimensions,
    async embed(texts: string[]): Promise<number[][]> {
      // embedDocuments returns vectors for multiple texts
      const vectors = await embedder.embedDocuments(texts);

      // Validate dimensions
      for (const vector of vectors) {
        if (vector.length !== dimensions) {
          throw new Error(
            `Gemini embedding returned invalid dimensions: expected ${String(dimensions)}, got ${String(vector.length)}`,
          );
        }
      }

      return vectors;
    },
  };
}

type ProviderFactory = (config: EmbeddingConfig) => EmbeddingProvider;

function createMockFromConfig(config: EmbeddingConfig): EmbeddingProvider {
  const dimensions = config.dimensions ?? 768;
  return createMockProvider(dimensions);
}

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
 * @returns An {@link EmbeddingProvider} instance.
 * @throws If the configured provider is not supported.
 */
export function createEmbeddingProvider(
  config: EmbeddingConfig,
): EmbeddingProvider {
  const factory = embeddingProviderRegistry.get(config.provider);
  if (!factory) {
    throw new Error(`Unsupported embedding provider: ${config.provider}`);
  }

  return factory(config);
}
