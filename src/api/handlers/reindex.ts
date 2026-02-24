/**
 * @module api/handlers/reindex
 * Fastify route handler for POST /reindex. Reprocesses all watched files through the processor.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import type { DocumentProcessor } from '../../processor';
import { processAllFiles } from '../processAllFiles';
import { wrapHandler } from './wrapHandler';

export interface ReindexRouteDeps {
  config: JeevesWatcherConfig;
  processor: DocumentProcessor;
  logger: pino.Logger;
}

/**
 * Create handler for POST /reindex.
 *
 * @param deps - Route dependencies.
 */
export function createReindexHandler(deps: ReindexRouteDeps) {
  return wrapHandler(
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const count = await processAllFiles(
        deps.config.watch.paths,
        deps.config.watch.ignored,
        deps.processor,
        'processFile',
      );
      return await reply.status(200).send({ ok: true, filesIndexed: count });
    },
    deps.logger,
    'Reindex',
  );
}
