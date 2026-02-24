/**
 * @module api/handlers/rebuildMetadata
 * Fastify route handler for POST /rebuild-metadata. Recreates enrichment metadata files from vector store payloads.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';
import { omit } from 'radash';

import type { JeevesWatcherConfig } from '../../config/types';
import { writeMetadata } from '../../metadata';
import { SYSTEM_METADATA_KEYS } from '../../metadata/constants';
import { FIELD_FILE_PATH } from '../../processor/payloadFields';
import type { VectorStoreClient } from '../../vectorStore';
import { wrapHandler } from './wrapHandler';

export interface RebuildMetadataRouteDeps {
  config: JeevesWatcherConfig;
  vectorStore: VectorStoreClient;
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
      const metadataDir = deps.config.metadataDir ?? '.jeeves-metadata';
      const systemKeys = [...SYSTEM_METADATA_KEYS];

      for await (const point of deps.vectorStore.scroll()) {
        const payload = point.payload;
        const filePath = payload[FIELD_FILE_PATH];
        if (typeof filePath !== 'string' || filePath.length === 0) continue;

        const enrichment = omit(payload, systemKeys);
        await writeMetadata(filePath, metadataDir, enrichment);
      }

      return await reply.status(200).send({ ok: true });
    },
    deps.logger,
    'Rebuild metadata',
  );
}
