/**
 * @module embedding/geminiProvider
 * Gemini embedding provider using the Google Generative AI REST API directly.
 */

import type pino from 'pino';

import type { EmbeddingConfig } from '../config/types';
import { getLogger } from '../util/logger';
import { normalizeError } from '../util/normalizeError';
import { retry } from '../util/retry';
import type { EmbeddingProvider } from './types';

/** Shape of a single embedding request within a batch. */
interface EmbedRequest {
  model: string;
  content: { parts: Array<{ text: string }> };
}

/** Shape of the batchEmbedContents API response. */
interface BatchEmbedResponse {
  embeddings: Array<{ values: number[] }>;
}

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Create a Gemini embedding provider using the Google Generative AI REST API.
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
  const model = config.model;
  const apiKey = config.apiKey;
  const log = getLogger(logger);

  const url = `${GEMINI_API_BASE}/models/${model}:batchEmbedContents?key=${apiKey}`;

  return {
    dimensions,
    async embed(texts: string[]): Promise<number[][]> {
      const vectors = await retry(
        async (attempt) => {
          if (attempt > 1) {
            log.warn(
              { attempt, provider: 'gemini', model },
              'Retrying embedding request',
            );
          }

          const requests: EmbedRequest[] = texts.map((text) => ({
            model: `models/${model}`,
            content: { parts: [{ text }] },
          }));

          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests }),
          });

          if (!response.ok) {
            const body = await response.text();
            throw new Error(
              `Gemini API error ${String(response.status)}: ${body}`,
            );
          }

          const data = (await response.json()) as BatchEmbedResponse;
          return data.embeddings.map((e) => e.values);
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
                model,
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
