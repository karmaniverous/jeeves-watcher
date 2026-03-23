/**
 * @module api/handlers/rebuildMetadata
 * Fastify route handler for POST /rebuild-metadata. Rebuilds enrichment store from vector store payloads.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';
import { omit } from 'radash';

import type { EnrichmentStoreInterface } from '../../enrichment';
import {
  FIELD_FILE_PATH,
  SYSTEM_METADATA_KEYS,
} from '../../processor/payloadFields';
import type { VectorStore } from '../../vectorStore';
import { wrapHandler } from './wrapHandler';

interface RebuildMetadataRouteDeps {
  enrichmentStore?: EnrichmentStoreInterface;
  vectorStore: VectorStore;
  logger: pino.Logger;
}

/**
 * Create handler for POST /rebuild-metadata.
 *
 * @param deps - Route dependencies.
 */
export function createRebuildMetadataHandler(deps: RebuildMetadataRouteDeps) {
  return wrapHandler(
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const systemKeys = [...SYSTEM_METADATA_KEYS];

      for await (const point of deps.vectorStore.scroll()) {
        const payload = point.payload;
        const filePath = payload[FIELD_FILE_PATH];
        if (typeof filePath !== 'string' || filePath.length === 0) continue;

        const enrichment = omit(payload, systemKeys);
        deps.enrichmentStore?.set(filePath, enrichment);
      }

      return await reply.status(200).send({ ok: true });
    },
    deps.logger,
    'Rebuild metadata',
  );
}
