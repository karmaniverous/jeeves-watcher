/**
 * @module vectorStore/collectionInfo
 * Collection introspection helpers for Qdrant vector store.
 */

import type { QdrantClient } from '@qdrant/js-client-rest';

import { inferPayloadType } from './helpers';
import type { CollectionInfo, PayloadFieldSchema } from './types';

/**
 * Sample points and discover payload field names and inferred types.
 *
 * @param client - Qdrant client instance.
 * @param collectionName - Name of the Qdrant collection.
 * @param target - Object to populate with discovered fields.
 * @param sampleSize - Number of points to sample.
 */
export async function discoverPayloadFields(
  client: QdrantClient,
  collectionName: string,
  target: Record<string, PayloadFieldSchema>,
  sampleSize = 100,
): Promise<void> {
  const result = await client.scroll(collectionName, {
    limit: sampleSize,
    with_payload: true,
    with_vector: false,
  });

  for (const point of result.points) {
    const payload = point.payload as Record<string, unknown> | undefined;
    if (!payload) continue;
    for (const [key, value] of Object.entries(payload)) {
      if (key in target) continue;
      target[key] = { type: inferPayloadType(value) };
    }
  }
}

/**
 * Get collection info including point count, dimensions, and payload field schema.
 *
 * When Qdrant has payload indexes, uses `payload_schema` directly. Otherwise
 * samples points to discover fields and infer types.
 *
 * @param client - Qdrant client instance.
 * @param collectionName - Name of the Qdrant collection.
 */
export async function getCollectionInfo(
  client: QdrantClient,
  collectionName: string,
): Promise<CollectionInfo> {
  const info = await client.getCollection(collectionName);
  const pointCount = info.points_count ?? 0;
  const vectorsConfig = info.config.params.vectors;
  const dimensions =
    vectorsConfig !== undefined && 'size' in vectorsConfig
      ? (vectorsConfig as { size: number }).size
      : 0;

  const payloadFields: Record<string, PayloadFieldSchema> = {};
  const schemaEntries = Object.entries(info.payload_schema);
  if (schemaEntries.length > 0) {
    for (const [key, schema] of schemaEntries) {
      payloadFields[key] = {
        type: (schema as { data_type?: string }).data_type ?? 'unknown',
      };
    }
  } else if (pointCount > 0) {
    await discoverPayloadFields(client, collectionName, payloadFields);
  }

  return { pointCount, dimensions, payloadFields };
}
