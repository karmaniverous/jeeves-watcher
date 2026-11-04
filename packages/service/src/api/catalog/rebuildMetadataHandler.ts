/**
 * @module api/catalog/rebuildMetadataHandler
 * Catalog handler for `POST /rebuild-metadata`: rebuilds the enrichment store from file point payloads, dropping every reserved system field. Each file's entry is written under its document lock (D98, unbounded wait, D118) from chunk 0 re-read inside the lock. Qdrant scroll and reads + SQLite writes.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';
import { isReservedPayloadField } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { EnrichmentStoreInterface } from '../../enrichment';
import { type DocumentLocks, fileLockKey } from '../../processor/DocumentLocks';
import {
  FIELD_CHUNK_INDEX,
  FIELD_FILE_PATH,
} from '../../processor/payloadFields';
import type { VectorStore } from '../../vectorStore';
import type { Entry } from './catalogEntry';
import { wrapCatalogHandler } from './wrapCatalogHandler';

/** Chunk 0 points only: one per document. */
const CHUNK_ZERO = { must: [{ key: FIELD_CHUNK_INDEX, match: { value: 0 } }] };

/** Dependencies for the catalog `rebuildMetadata` entry's handler. */
export interface CatalogRebuildMetadataDeps {
  /** Enrichment store to rebuild. */
  enrichmentStore?: EnrichmentStoreInterface;
  /** Vector store to scroll, and to re-read chunk 0 under the lock. */
  vectorStore: Pick<VectorStore, 'scroll' | 'getPayload'>;
  /** The processor's document locks; without them entries are unlocked. */
  documentLocks?: Pick<DocumentLocks, 'run'>;
  /** Logger. */
  logger: pino.Logger;
}

/**
 * Create the catalog handler for `POST /rebuild-metadata`: each file's
 * chunk 0 payload, minus the reserved system fields (core
 * `isReservedPayloadField`: identity, chunk, hash, date, line and
 * `matched_rules` fields), is written as the file's enrichment. The write
 * holds the file's document lock and re-reads chunk 0 inside it, so a
 * `setMetadata` that ran after the scroll read is never overwritten by a
 * stale entry.
 *
 * @param deps - Handler dependencies.
 * @returns The catalog handler.
 */
export function createCatalogRebuildMetadataHandler(
  deps: CatalogRebuildMetadataDeps,
): CatalogHandler<Entry<'rebuildMetadata'>> {
  const { enrichmentStore, vectorStore, documentLocks } = deps;
  const rebuildEntry = async (id: string, filePath: string) => {
    const payload = await vectorStore.getPayload(id);
    if (!payload) return;
    const enrichment = Object.fromEntries(
      Object.entries(payload).filter(([key]) => !isReservedPayloadField(key)),
    );
    enrichmentStore?.set(filePath, enrichment);
  };

  return wrapCatalogHandler<Entry<'rebuildMetadata'>>(
    async () => {
      // Chunk 0 is each document's authoritative payload (D87).
      for await (const point of vectorStore.scroll(CHUNK_ZERO)) {
        const filePath = point.payload[FIELD_FILE_PATH];
        if (typeof filePath !== 'string' || filePath.length === 0) continue;

        const work = () => rebuildEntry(point.id, filePath);
        await (documentLocks
          ? documentLocks.run(fileLockKey(filePath), 'rebuildMetadata', work)
          : work());
      }

      return { body: { ok: true } };
    },
    deps.logger,
    'Rebuild metadata',
  );
}
