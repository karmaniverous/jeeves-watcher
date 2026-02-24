/**
 * @module api/handlers/metadata
 * Fastify route handler for POST /metadata. Performs enrichment metadata updates via the document processor.
 */

import type { FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import type { DocumentProcessorInterface } from '../../processor';
import { wrapHandler } from './wrapHandler';

export interface MetadataRouteDeps {
  processor: DocumentProcessorInterface;
  config: JeevesWatcherConfig;
  logger: pino.Logger;
}

type MetadataRequest = FastifyRequest<{
  Body: { path: string; metadata: Record<string, unknown> };
}>;

/**
 * Create handler for POST /metadata.
 *
 * @param deps - Route dependencies.
 */
export function createMetadataHandler(deps: MetadataRouteDeps) {
  return wrapHandler(
    async (request: MetadataRequest) => {
      const { path, metadata } = request.body;
      // TODO: Add metadata validation against matched rule schemas (Phase 3 item 15)
      // For now, pass through to processor without validation
      await deps.processor.processMetadataUpdate(path, metadata);
      return { ok: true };
    },
    deps.logger,
    'Metadata update',
  );
}
