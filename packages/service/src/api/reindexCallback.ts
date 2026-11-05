/**
 * @module api/reindexCallback
 * Fires the optional `reindex.callbackUrl` completion webhook (POST JSON) through postWithRetry (3 attempts, 10 s timeout each); delivery failures are logged, never thrown. Network I/O via fetch.
 */

import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import { postWithRetry } from '../util/postWithRetry';

/**
 * Report a finished reindex to `reindex.callbackUrl`, when configured. Never
 * rejects: when every attempt fails the failure is logged and the run's
 * result is unaffected (the callback is not re-sent with a failure payload,
 * since delivery itself is what failed).
 *
 * @param config - Service config (reads `reindex.callbackUrl`).
 * @param payload - Callback body.
 * @param logger - Logger for retry warnings and the final delivery failure.
 */
export async function reportReindexCompletion(
  config: JeevesWatcherConfig,
  payload: Record<string, unknown>,
  logger: pino.Logger,
): Promise<void> {
  const url = config.reindex?.callbackUrl;
  if (!url) return;
  await postWithRetry(url, payload, logger, {
    label: 'Reindex callback',
    logFields: { scope: payload['scope'] },
  });
}
