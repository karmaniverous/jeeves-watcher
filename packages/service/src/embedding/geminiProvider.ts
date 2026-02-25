/**
 * @module embedding/geminiProvider
 * Gemini embedding provider using Google Generative AI.
 */

import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import type pino from 'pino';

import type { EmbeddingConfig } from '../config/types';
import { getLogger } from '../util/logger';
import { normalizeError } from '../util/normalizeError';
import { retry } from '../util/retry';
import type { EmbeddingProvider } from './types';

/**
 * Create a Gemini embedding provider using the Google Generative AI SDK.
 *
 * @param config - The embedding configuration.
 * @param logger - Optional pino logger for retry warnings.
 * @returns A Gemini {@link EmbeddingProvider}.
 * @throws If the API key is missing.
 */
export function createGeminiProvider(
  config: EmbeddingConfig,
  logger?: pino.Logger,
): EmbeddingProvider {
  if (!config.apiKey) {
    throw new Error(
      'Gemini embedding provider requires config.embedding.apiKey',
    );
  }

  const dimensions = config.dimensions ?? 3072;
  const log = getLogger(logger);
  const embedder = new GoogleGenerativeAIEmbeddings({
    apiKey: config.apiKey,
    model: config.model,
  });

  return {
    dimensions,
    async embed(texts: string[]): Promise<number[][]> {
      const vectors = await retry(
        async (attempt) => {
          if (attempt > 1) {
            log.warn(
              { attempt, provider: 'gemini', model: config.model },
              'Retrying embedding request',
            );
          }

          // embedDocuments returns vectors for multiple texts
          return embedder.embedDocuments(texts);
        },
        {
          attempts: 5,
          baseDelayMs: 500,
          maxDelayMs: 10_000,
          jitter: 0.2,
          onRetry: ({ attempt, delayMs, error }) => {
            log.warn(
              {
                attempt,
                delayMs,
                provider: 'gemini',
                model: config.model,
                err: normalizeError(error),
              },
              'Embedding call failed; will retry',
            );
          },
        },
      );

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
