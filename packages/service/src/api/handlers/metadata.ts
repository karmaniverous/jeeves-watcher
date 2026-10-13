/**
 * @module api/handlers/metadata
 * Fastify route handler for POST /metadata. Performs enrichment metadata updates via the document processor, for a file path or a source reference.
 */

import {
  documentTarget,
  metadataRequestSchema,
} from '@karmaniverous/jeeves-watcher-core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import type { DocumentProcessorInterface } from '../../processor';
import { hasSourceOperations } from '../../processor/SourceOperations';
import { sendError, sendSourcesNotAvailable } from '../sendError';
import {
  validateMetadataPayload,
  validateSourceMetadataPayload,
} from './metadataValidation';
import { parseBody } from './parseBody';
import { wrapHandler } from './wrapHandler';

/** Dependencies of the POST /metadata handler. */
export interface MetadataRouteDeps {
  /** Document processor. */
  processor: DocumentProcessorInterface;
  /** Live config getter. */
  getConfig: () => JeevesWatcherConfig;
  /** Logger. */
  logger: pino.Logger;
  /** Config directory (schema file references). */
  configDir?: string;
}

type MetadataRequest = FastifyRequest<{ Body: unknown }>;

/** Send `404 source_not_indexed`. */
const sendNotIndexed = (reply: FastifyReply) =>
  sendError(reply, 'source_not_indexed', 'Source document not indexed');

/** Send `400 invalid_request` for failed metadata validation. */
const sendInvalid = (
  reply: FastifyReply,
  validation: { error: string; details?: unknown },
) =>
  sendError(reply, 'invalid_request', validation.error, {
    details: validation.details,
  });

/**
 * Enrich a source document. The designated rule comes from the stored
 * chunk-0 point (`404` when not indexed; nothing is stored then) and the
 * metadata is validated against that rule's schema, resolved by the
 * processor's own lookup (config or virtual rule).
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
    return sendSourcesNotAvailable(reply);
  }
  const ops = deps.processor.sourceOperations();
  const rule = await ops.storedRule(ref);
  if (rule === null) return sendNotIndexed(reply);
  const validation = validateSourceMetadataPayload(
    deps.getConfig(),
    ops.compiledRule(rule),
    metadata,
    deps.configDir,
  );
  if (!validation.ok) return sendInvalid(reply, validation);
  if ((await ops.updateMetadata(ref, metadata)) === null) {
    return sendNotIndexed(reply);
  }
  return { ok: true, matched_rules: validation.matchedRules };
}

/**
 * Create handler for POST /metadata (`path` or `source`). Values that do not
 * match the declared property types are `400 invalid_request` with
 * per-property `details`.
 *
 * @param deps - Route dependencies.
 * @returns Fastify route handler.
 */
export function createMetadataHandler(deps: MetadataRouteDeps) {
  return wrapHandler(
    async (request: MetadataRequest, reply) => {
      const body = parseBody(metadataRequestSchema, request.body);
      const { metadata } = body;
      const target = documentTarget(body);
      if (target.kind === 'source') {
        return updateSourceMetadata(deps, target.source, metadata, reply);
      }
      const { path } = target;

      const validation = validateMetadataPayload(
        deps.getConfig(),
        path,
        metadata,
        deps.configDir,
      );
      if (!validation.ok) return sendInvalid(reply, validation);

      await deps.processor.processMetadataUpdate(path, metadata);
      return { ok: true, matched_rules: validation.matchedRules };
    },
    deps.logger,
    'Metadata update',
  );
}
