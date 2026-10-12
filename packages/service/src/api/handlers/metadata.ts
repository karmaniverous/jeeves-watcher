/**
 * @module api/handlers/metadata
 * Fastify route handler for POST /metadata. Performs enrichment metadata updates via the document processor.
 */

import { metadataRequestSchema } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import type { DocumentProcessorInterface } from '../../processor';
import { validateMetadataPayload } from './metadataValidation';
import { parseBody, rejectUnsupportedSource } from './parseBody';
import { wrapHandler } from './wrapHandler';

interface MetadataRouteDeps {
  processor: DocumentProcessorInterface;
  getConfig: () => JeevesWatcherConfig;
  logger: pino.Logger;
  configDir?: string;
}

type MetadataRequest = FastifyRequest<{ Body: unknown }>;

/**
 * Create handler for POST /metadata.
 *
 * @param deps - Route dependencies.
 */
export function createMetadataHandler(deps: MetadataRouteDeps) {
  return wrapHandler(
    async (request: MetadataRequest, reply) => {
      const body = parseBody(metadataRequestSchema, request.body, reply);
      if (!body) return;
      const { path, metadata } = body;
      if (path === undefined) {
        rejectUnsupportedSource(reply, 'POST /metadata');
        return;
      }

      const validation = validateMetadataPayload(
        deps.getConfig(),
        path,
        metadata,
        deps.configDir,
      );
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
