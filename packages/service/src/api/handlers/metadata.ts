/**
 * @module api/handlers/metadata
 * Fastify route handler for POST /metadata. Performs enrichment metadata updates via the document processor.
 */

import type { FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import type { DocumentProcessorInterface } from '../../processor';
import { validateMetadataPayload } from './metadataValidation';
import { wrapHandler } from './wrapHandler';

interface MetadataRouteDeps {
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
    async (request: MetadataRequest, reply) => {
      const { path, metadata } = request.body;

      const validation = validateMetadataPayload(deps.config, path, metadata);
      if (!validation.ok) {
        return reply
          .code(400)
          .send({ error: validation.error, details: validation.details });
      }

      await deps.processor.processMetadataUpdate(path, metadata);
      return { ok: true, matched_rules: validation.matchedRules };
    },
    deps.logger,
    'Metadata update',
  );
}
