/**
 * @module api/handlers/configReindex
 * Fastify route handler for POST /config-reindex. Triggers an async reindex job scoped to rules or full processing.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import type { DocumentProcessor } from '../../processor';
import { normalizeError } from '../../util/normalizeError';
import { executeReindex } from '../executeReindex';
import type { ReindexTracker } from '../ReindexTracker';

export interface ConfigReindexRouteDeps {
  config: JeevesWatcherConfig;
  processor: DocumentProcessor;
  logger: pino.Logger;
  reindexTracker: ReindexTracker;
}

type ConfigReindexRequest = FastifyRequest<{
  Body: { scope?: 'rules' | 'full' };
}>;

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
      void executeReindex(
        {
          config: deps.config,
          processor: deps.processor,
          logger: deps.logger,
          reindexTracker: deps.reindexTracker,
        },
        scope,
      );

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
