/**
 * @module api/handlers/metadata
 * Fastify route handler for POST /metadata. Performs enrichment metadata updates via the document processor.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { DocumentProcessor } from '../../processor';
import { normalizeError } from '../../util/normalizeError';

export interface MetadataRouteDeps {
  processor: DocumentProcessor;
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
  return async (request: MetadataRequest, reply: FastifyReply) => {
    try {
      const { path, metadata } = request.body;
      await deps.processor.processMetadataUpdate(path, metadata);
      return { ok: true };
    } catch (error) {
      deps.logger.error(
        { err: normalizeError(error) },
        'Metadata update failed',
      );
      return reply.status(500).send({ error: 'Internal server error' });
    }
  };
}
