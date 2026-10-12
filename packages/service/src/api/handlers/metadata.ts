/**
 * @module api/handlers/metadata
 * Fastify route handler for POST /metadata. Performs enrichment metadata updates via the document processor, for a file path or a source reference.
 */

import { metadataRequestSchema } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import type { DocumentProcessorInterface } from '../../processor';
import { hasSourceOperations } from '../../processor/SourceOperations';
import {
  validateMetadataPayload,
  validateSourceMetadataPayload,
} from './metadataValidation';
import { parseBody } from './parseBody';
import { wrapHandler } from './wrapHandler';

interface MetadataRouteDeps {
  processor: DocumentProcessorInterface;
  getConfig: () => JeevesWatcherConfig;
  logger: pino.Logger;
  configDir?: string;
}

type MetadataRequest = FastifyRequest<{ Body: unknown }>;

/**
 * Enrich a source document. The designated rule comes from the stored
 * chunk-0 point (`404` when not indexed; nothing is stored then) and the
 * metadata is validated against that rule's schema.
 *
 * @param deps - Route dependencies.
 * @param ref - The exact `<name>://<id>` reference.
 * @param metadata - Enrichment metadata.
 * @param reply - Fastify reply.
 * @returns The response body, or the sent reply.
 */
async function updateSourceMetadata(
  deps: MetadataRouteDeps,
  ref: string,
  metadata: Record<string, unknown>,
  reply: FastifyReply,
) {
  if (!hasSourceOperations(deps.processor)) {
    return reply.code(503).send({
      error: 'Not available',
      message: 'Source documents are not supported by this instance.',
    });
  }
  const ops = deps.processor.sourceOperations();
  const rule = await ops.storedRule(ref);
  if (rule === null) {
    return reply.code(404).send({ error: 'Source document not indexed' });
  }
  const validation = validateSourceMetadataPayload(
    deps.getConfig(),
    rule,
    metadata,
    deps.configDir,
  );
  if (!validation.ok) {
    return reply
      .code(400)
      .send({ error: validation.error, details: validation.details });
  }
  if ((await ops.updateMetadata(ref, metadata)) === null) {
    return reply.code(404).send({ error: 'Source document not indexed' });
  }
  return { ok: true, matched_rules: validation.matchedRules };
}

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
      const { path, source, metadata } = body;
      if (source !== undefined) {
        return updateSourceMetadata(deps, source, metadata, reply);
      }
      if (path === undefined) return; // unreachable: exactly one is required

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
