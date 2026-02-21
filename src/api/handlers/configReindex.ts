/**
 * @module api/handlers/configReindex
 * Fastify route handler for POST /config-reindex. Triggers an async reindex job scoped to rules or full processing.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import type { DocumentProcessor } from '../../processor';
import { processAllFiles } from '../processAllFiles';

export interface ConfigReindexRouteDeps {
  config: JeevesWatcherConfig;
  processor: DocumentProcessor;
  logger: pino.Logger;
}

type ConfigReindexRequest = FastifyRequest<{ Body: { scope?: 'rules' | 'full' } }>;

/**
 * Create handler for POST /config-reindex.
 *
 * @param deps - Route dependencies.
 */
export function createConfigReindexHandler(deps: ConfigReindexRouteDeps) {
  return async (request: ConfigReindexRequest, reply: FastifyReply) => {
    try {
      const scope = request.body.scope ?? 'rules';

      // Return immediately and run async
      void (async () => {
        try {
          if (scope === 'rules') {
            const count = await processAllFiles(
              deps.config.watch.paths,
              deps.config.watch.ignored,
              deps.processor,
              'processRulesUpdate',
            );

            deps.logger.info(
              { scope, filesProcessed: count },
              'Config reindex (rules) completed',
            );
          } else {
            const count = await processAllFiles(
              deps.config.watch.paths,
              deps.config.watch.ignored,
              deps.processor,
              'processFile',
            );

            deps.logger.info(
              { scope, filesProcessed: count },
              'Config reindex (full) completed',
            );
          }
        } catch (error) {
          deps.logger.error({ error, scope }, 'Config reindex failed');
        }
      })();

      return await reply.status(200).send({ status: 'started', scope });
    } catch (error) {
      deps.logger.error({ error }, 'Config reindex request failed');
      return await reply.status(500).send({ error: 'Internal server error' });
    }
  };
}
