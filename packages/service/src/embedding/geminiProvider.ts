/**
 * @module embedding/geminiProvider
 * Gemini embedding provider using the Google Generative AI REST API directly.
 * Uses node:https with a keep-alive agent for reliable performance in
 * long-running processes (avoids undici/fetch event-loop contention).
 * HTTP 429 is not retried here: it surfaces as an EmbeddingRateLimitError
 * carrying `Retry-After`, for the shared limiter to handle. Other failures
 * are retried, each retry first awaiting the limiter's `beforeRetry` (one
 * token per HTTP request).
 */

import type { IncomingHttpHeaders } from 'node:http';
import https from 'node:https';

import type pino from 'pino';

import { EMBEDDING_DEFAULTS } from '../config/defaults';
import type { EmbeddingConfig } from '../config/types';
import { getLogger } from '../util/logger';
import { normalizeError } from '../util/normalizeError';
import { NETWORK_RETRY_POLICY, retry } from '../util/retry';
import {
  EmbeddingRateLimitError,
  EmbeddingUnavailableError,
  parseRetryAfterMs,
} from './rateLimitError';
import type { EmbeddingProvider, EmbedOptions } from './types';

/** Shape of a single embedding request within a batch (`EmbedContentRequest`). */
interface EmbedRequest {
  model: string;
  content: { parts: Array<{ text: string }> };
  /** Requested vector size (the configured `dimensions`). */
  outputDimensionality: number;
}

/** Shape of the batchEmbedContents API response. */
interface BatchEmbedResponse {
  embeddings: Array<{ values: number[] }>;
}

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Persistent HTTPS agent for connection reuse. */
const agent = new https.Agent({ keepAlive: true });

/** Make an HTTPS POST request using node:https (bypasses undici/fetch). */
function httpsPost(
  url: string,
  body: string,
): Promise<{
  status: number;
  body: string;
  headers: IncomingHttpHeaders;
}> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        agent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Create a Gemini embedding provider using the Google Generative AI REST API.
 * Every request asks for vectors of the configured `dimensions`
 * (`outputDimensionality`), so a size below the model's native one (e.g.
 * 768 for `gemini-embedding-001`, native 3072) is honoured; a response of
 * any other size fails.
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

  const dimensions = config.dimensions ?? EMBEDDING_DEFAULTS.dimensions;
  const model = config.model;
  const apiKey = config.apiKey;
  const log = getLogger(logger);

  const url = `${GEMINI_API_BASE}/models/${model}:batchEmbedContents?key=${apiKey}`;

  return {
    dimensions,
    async embed(
      texts: string[],
      options: EmbedOptions = {},
    ): Promise<number[][]> {
      const vectors = await retry(
        async (attempt) => {
          if (attempt > 1) {
            // Each retry is another request: draw from the shared limiter.
            await options.beforeRetry?.();
            log.warn(
              { attempt, provider: 'gemini', model },
              'Retrying embedding request',
            );
          }

          const requests: EmbedRequest[] = texts.map((text) => ({
            model: `models/${model}`,
            content: { parts: [{ text }] },
            outputDimensionality: dimensions,
          }));

          const response = await httpsPost(url, JSON.stringify({ requests }));

          if (response.status === 429) {
            throw new EmbeddingRateLimitError(
              `Gemini API error 429: ${response.body}`,
              parseRetryAfterMs(response.headers['retry-after'], response.body),
            );
          }

          if (response.status < 200 || response.status >= 300) {
            throw new Error(
              `Gemini API error ${String(response.status)}: ${response.body}`,
            );
          }

          const data = JSON.parse(response.body) as BatchEmbedResponse;
          return data.embeddings.map((e) => e.values);
        },
        {
          ...NETWORK_RETRY_POLICY,
          shouldRetry: (error) =>
            !(error instanceof EmbeddingRateLimitError) &&
            !(error instanceof EmbeddingUnavailableError),
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
