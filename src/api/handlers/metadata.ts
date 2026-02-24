/**
 * @module api/handlers/metadata
 * Fastify route handler for POST /metadata. Performs enrichment metadata updates via the document processor.
 */

import type { FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { DocumentProcessorInterface } from '../../processor';
import { wrapHandler } from './wrapHandler';

export interface MetadataRouteDeps {
  processor: DocumentProcessorInterface;
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
      await deps.processor.processMetadataUpdate(path, metadata);
      return { ok: true };
    },
    deps.logger,
    'Metadata update',
  );
}
