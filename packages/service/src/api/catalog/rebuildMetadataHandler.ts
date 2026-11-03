/**
 * @module api/catalog/rebuildMetadataHandler
 * Catalog handler for `POST /rebuild-metadata`: rebuilds the enrichment store from file point payloads, dropping every reserved system field. Qdrant scroll + SQLite writes.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';
import { isReservedPayloadField } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { EnrichmentStoreInterface } from '../../enrichment';
import { FIELD_FILE_PATH } from '../../processor/payloadFields';
import type { VectorStore } from '../../vectorStore';
import type { Entry } from './catalogEntry';
import { wrapCatalogHandler } from './wrapCatalogHandler';

/** Dependencies for the catalog `rebuildMetadata` entry's handler. */
export interface CatalogRebuildMetadataDeps {
  /** Enrichment store to rebuild. */
  enrichmentStore?: EnrichmentStoreInterface;
  /** Vector store to scroll. */
  vectorStore: Pick<VectorStore, 'scroll'>;
  /** Logger. */
  logger: pino.Logger;
}

/**
 * Create the catalog handler for `POST /rebuild-metadata`: every file
 * point's payload, minus the reserved system fields (core
 * `isReservedPayloadField`: identity, chunk, hash, date, line and
 * `matched_rules` fields), is written as the file's enrichment.
 *
 * @param deps - Handler dependencies.
 * @returns The catalog handler.
 */
export function createCatalogRebuildMetadataHandler(
  deps: CatalogRebuildMetadataDeps,
): CatalogHandler<Entry<'rebuildMetadata'>> {
  return wrapCatalogHandler<Entry<'rebuildMetadata'>>(
    async () => {
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

      return { body: { ok: true } };
    },
    deps.logger,
    'Rebuild metadata',
  );
}
