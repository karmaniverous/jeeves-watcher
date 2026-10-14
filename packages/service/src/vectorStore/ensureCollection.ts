/**
 * @module vectorStore/ensureCollection
 * Creates the Qdrant collection when missing (Cosine, configured dimensions), then ensures its payload indexes. Called once at startup; network I/O only.
 */

import type { PayloadIndexConfig } from '@karmaniverous/jeeves-watcher-core';
import type { QdrantClient } from '@qdrant/js-client-rest';
import type pino from 'pino';

import { ensurePayloadIndexes } from './payloadIndexes';

/** Options for {@link ensureCollection}. */
export interface EnsureCollectionOptions {
  /** Collection name. */
  collectionName: string;
  /** Vector dimensions used when the collection is created. */
  dimensions: number;
  /** Configured `vectorStore.payloadIndexes`. */
  payloadIndexes?: readonly PayloadIndexConfig[];
  /** Optional logger for index creation and mismatch warnings. */
  logger?: pino.Logger;
}

/**
 * Ensure the collection exists, then create any missing payload indexes
 * (configured plus system `source`/`source_rule`). Never drops indexes.
 *
 * @param client - Qdrant client.
 * @param options - Collection and index options.
 * @throws Error wrapping any Qdrant failure, naming the collection.
 */
export async function ensureCollection(
  client: QdrantClient,
  options: EnsureCollectionOptions,
): Promise<void> {
  const { collectionName, dimensions, payloadIndexes, logger } = options;
  try {
    const collections = await client.getCollections();
    const exists = collections.collections.some(
      (c) => c.name === collectionName,
    );
    if (!exists) {
      await client.createCollection(collectionName, {
        vectors: { size: dimensions, distance: 'Cosine' },
      });
    }
    await ensurePayloadIndexes(client, collectionName, payloadIndexes, logger);
  } catch (error) {
    throw new Error(
      `Failed to ensure collection "${collectionName}": ${String(error)}`,
      { cause: error },
    );
  }
}
