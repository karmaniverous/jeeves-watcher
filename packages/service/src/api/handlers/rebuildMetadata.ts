/**
 * @module api/handlers/rebuildMetadata
 * Fastify route handler for POST /rebuild-metadata. Rebuilds the enrichment store from file point payloads, dropping every reserved system field. Qdrant scroll + SQLite writes.
 */

import { isReservedPayloadField } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { EnrichmentStoreInterface } from '../../enrichment';
import { FIELD_FILE_PATH } from '../../processor/payloadFields';
import type { VectorStore } from '../../vectorStore';
import { wrapHandler } from './wrapHandler';

/** Dependencies of the POST /rebuild-metadata handler. */
interface RebuildMetadataRouteDeps {
  /** Enrichment store to rebuild. */
  enrichmentStore?: EnrichmentStoreInterface;
  /** Vector store to scroll. */
  vectorStore: Pick<VectorStore, 'scroll'>;
  /** Logger. */
  logger: pino.Logger;
}

/**
 * Create handler for POST /rebuild-metadata: every file point's payload,
 * minus the reserved system fields (core `isReservedPayloadField`: identity,
 * chunk, hash, date, line and `matched_rules` fields), is written as the
 * file's enrichment.
 *
 * @param deps - Route dependencies.
 * @returns Fastify route handler.
 */
export function createRebuildMetadataHandler(deps: RebuildMetadataRouteDeps) {
  return wrapHandler(
    async (_request: FastifyRequest, reply: FastifyReply) => {
      for await (const point of deps.vectorStore.scroll()) {
        const payload = point.payload;
        const filePath = payload[FIELD_FILE_PATH];
        if (typeof filePath !== 'string' || filePath.length === 0) continue;

        const enrichment = Object.fromEntries(
          Object.entries(payload).filter(
            ([key]) => !isReservedPayloadField(key),
          ),
        );
        deps.enrichmentStore?.set(filePath, enrichment);
      }

      return await reply.status(200).send({ ok: true });
    },
    deps.logger,
    'Rebuild metadata',
  );
}
