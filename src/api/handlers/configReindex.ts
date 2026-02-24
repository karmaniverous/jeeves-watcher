/**
 * @module api/handlers/configReindex
 * Fastify route handler for POST /config-reindex. Triggers an async reindex job scoped to rules or full processing.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import type { DocumentProcessor } from '../../processor';
import { normalizeError } from '../../util/normalizeError';
import type { ReindexTracker } from '../ReindexTracker';
import { processAllFiles } from '../processAllFiles';

export interface ConfigReindexRouteDeps {
  config: JeevesWatcherConfig;
  processor: DocumentProcessor;
  logger: pino.Logger;
  reindexTracker: ReindexTracker;
}

type ConfigReindexRequest = FastifyRequest<{
  Body: { scope?: 'rules' | 'full' };
}>;

/** Fire reindex callback with exponential backoff retry. */
async function fireCallback(
  url: string,
  payload: Record<string, unknown>,
  logger: pino.Logger,
): Promise<void> {
  const maxAttempts = 3;
  let delayMs = 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.ok) return;
      logger.warn(
        { attempt, status: response.status, url },
        'Reindex callback non-OK response',
      );
    } catch (error) {
      logger.warn(
        { attempt, err: normalizeError(error), url },
        'Reindex callback failed',
      );
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
  logger.error({ url }, 'Reindex callback exhausted all retry attempts');
}

/**
 * Create handler for POST /config-reindex.
 *
 * @param deps - Route dependencies.
 */
export function createConfigReindexHandler(deps: ConfigReindexRouteDeps) {
  return async (request: ConfigReindexRequest, reply: FastifyReply) => {
    try {
      const scope = request.body.scope ?? 'rules';

      deps.reindexTracker.start(scope);

      // Return immediately and run async
      void (async () => {
        const startTime = Date.now();
        try {
          const method =
            scope === 'rules' ? 'processRulesUpdate' : 'processFile';
          const count = await processAllFiles(
            deps.config.watch.paths,
            deps.config.watch.ignored,
            deps.processor,
            method,
          );

          const durationMs = Date.now() - startTime;
          deps.logger.info(
            { scope, filesProcessed: count, durationMs },
            `Config reindex (${scope}) completed`,
          );

          deps.reindexTracker.complete();

          // Fire callback if configured
          if (deps.config.reindex?.callbackUrl) {
            await fireCallback(
              deps.config.reindex.callbackUrl,
              { scope, filesProcessed: count, durationMs, errors: [] },
              deps.logger,
            );
          }
        } catch (error) {
          const durationMs = Date.now() - startTime;
          deps.logger.error(
            { err: normalizeError(error), scope },
            'Config reindex failed',
          );
          deps.reindexTracker.complete();

          if (deps.config.reindex?.callbackUrl) {
            await fireCallback(
              deps.config.reindex.callbackUrl,
              {
                scope,
                filesProcessed: 0,
                durationMs,
                errors: [normalizeError(error).message],
              },
              deps.logger,
            );
          }
        }
      })();

      return await reply.status(200).send({ status: 'started', scope });
    } catch (error) {
      deps.logger.error(
        { err: normalizeError(error) },
        'Config reindex request failed',
      );
      return await reply.status(500).send({ error: 'Internal server error' });
    }
  };
}
