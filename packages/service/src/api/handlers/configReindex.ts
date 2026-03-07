/**
 * @module api/handlers/configReindex
 * Fastify route handler for POST /config-reindex. Triggers an async reindex job scoped to rules or full processing.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import type { IssuesManager } from '../../issues';
import type { DocumentProcessorInterface } from '../../processor';
import type { ValuesManager } from '../../values';
import { executeReindex } from '../executeReindex';
import type { ReindexTracker } from '../ReindexTracker';
import { wrapHandler } from './wrapHandler';

export interface ConfigReindexRouteDeps {
  config: JeevesWatcherConfig;
  processor: DocumentProcessorInterface;
  logger: pino.Logger;
  reindexTracker: ReindexTracker;
  valuesManager?: ValuesManager;
  issuesManager?: IssuesManager;
}

type ConfigReindexRequest = FastifyRequest<{
  Body: { scope?: 'issues' | 'full' };
}>;

/**
 * Create handler for POST /config-reindex.
 *
 * @param deps - Route dependencies.
 */
export function createConfigReindexHandler(deps: ConfigReindexRouteDeps) {
  return wrapHandler(
    async (request: ConfigReindexRequest, reply: FastifyReply) => {
      const scope = request.body.scope ?? 'issues';

      void executeReindex(
        {
          config: deps.config,
          processor: deps.processor,
          logger: deps.logger,
          reindexTracker: deps.reindexTracker,
          valuesManager: deps.valuesManager,
          issuesManager: deps.issuesManager,
        },
        scope,
      );

      return await reply.status(200).send({ status: 'started', scope });
    },
    deps.logger,
    'Config reindex request',
  );
}
