/**
 * @module api/reindexCallback
 * Fires the optional `reindex.callbackUrl` completion webhook (POST JSON) with exponential-backoff retry. Network I/O via fetch.
 */

import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import { normalizeError } from '../util/normalizeError';
import { retry } from '../util/retry';

/** Fire reindex callback with exponential backoff retry. */
async function fireCallback(
  url: string,
  payload: Record<string, unknown>,
  logger: pino.Logger,
): Promise<void> {
  await retry(
    async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Non-OK response: ${String(response.status)}`);
      }
    },
    {
      attempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 4000,
      onRetry: ({ attempt, error }) => {
        logger.warn(
          { attempt, err: normalizeError(error), url },
          'Reindex callback failed; will retry',
        );
      },
    },
  );
}

/**
 * Report a finished reindex to `reindex.callbackUrl`, when configured.
 *
 * @param config - Service config (reads `reindex.callbackUrl`).
 * @param payload - Callback body.
 * @param logger - Logger for retry warnings.
 */
export async function reportReindexCompletion(
  config: JeevesWatcherConfig,
  payload: Record<string, unknown>,
  logger: pino.Logger,
): Promise<void> {
  if (config.reindex?.callbackUrl) {
    await fireCallback(config.reindex.callbackUrl, payload, logger);
  }
}
