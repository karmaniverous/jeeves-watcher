/**
 * @module embedding/geminiProvider
 * Gemini embedding provider using the Google Generative AI REST API directly.
 * Uses node:https with a keep-alive agent for reliable performance in
 * long-running processes (avoids undici/fetch event-loop contention).
 */

import https from 'node:https';

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

/** Persistent HTTPS agent for connection reuse. */
const agent = new https.Agent({ keepAlive: true });

/** Make an HTTPS POST request using node:https (bypasses undici/fetch). */
function httpsPost(
  url: string,
  body: string,
): Promise<{ status: number; body: string }> {
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

          const response = await httpsPost(url, JSON.stringify({ requests }));

          if (response.status < 200 || response.status >= 300) {
            throw new Error(
              `Gemini API error ${String(response.status)}: ${response.body}`,
            );
          }

          const data = JSON.parse(response.body) as BatchEmbedResponse;
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
