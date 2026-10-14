/**
 * @module vectorStore/payload
 * Point payload operations on a Qdrant collection: read one point's payload, read points with vectors, merge fields into points (set-payload), and remove keys from points (delete-payload). Qdrant I/O.
 */

import type { QdrantClient } from '@qdrant/js-client-rest';

import type { VectorPoint } from './types';

/** The subset of the Qdrant client used for payload operations. */
export type PayloadClient = Pick<
  QdrantClient,
  'retrieve' | 'setPayload' | 'deletePayload'
>;

/**
 * Get the payload of a point by ID.
 *
 * @param client - Qdrant client.
 * @param collectionName - Collection.
 * @param id - The point ID.
 * @returns The payload, or `null` when the point doesn't exist.
 * @throws When the read fails (a failed read is never reported as "not
 * indexed"; callers tag and record it).
 */
export async function getPointPayload(
  client: Pick<PayloadClient, 'retrieve'>,
  collectionName: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const results = await client.retrieve(collectionName, {
    ids: [id],
    with_payload: true,
    with_vector: false,
  });
  if (results.length === 0) return null;
  return results[0].payload as Record<string, unknown>;
}

/**
 * Retrieve points with their vectors and payloads by ID.
 *
 * @param client - Qdrant client.
 * @param collectionName - Collection.
 * @param ids - The point IDs (no request when empty).
 * @returns Points with vectors; missing IDs (and points without a vector)
 *   are omitted.
 * @throws When the read fails (never reported as missing points).
 */
export async function getPointsWithVectors(
  client: Pick<PayloadClient, 'retrieve'>,
  collectionName: string,
  ids: string[],
): Promise<VectorPoint[]> {
  if (ids.length === 0) return [];
  const results = await client.retrieve(collectionName, {
    ids,
    with_payload: true,
    with_vector: true,
  });
  return results
    .filter((r) => r.vector != null)
    .map((r) => ({
      id: String(r.id),
      vector: r.vector as number[],
      payload: r.payload as Record<string, unknown>,
    }));
}

/**
 * Merge payload fields into points (Qdrant set-payload; other keys kept).
 *
 * @param client - Qdrant client.
 * @param collectionName - Collection.
 * @param ids - Point IDs (no-op when empty).
 * @param payload - Fields to set.
 */
export async function setPointsPayload(
  client: Pick<PayloadClient, 'setPayload'>,
  collectionName: string,
  ids: string[],
  payload: Record<string, unknown>,
): Promise<void> {
  if (ids.length === 0) return;
  await client.setPayload(collectionName, { wait: true, points: ids, payload });
}

/**
 * Remove payload keys from points (Qdrant delete-payload).
 *
 * @param client - Qdrant client.
 * @param collectionName - Collection.
 * @param ids - Point IDs (no-op when empty).
 * @param keys - Keys to remove (no-op when empty).
 */
export async function deletePointsPayload(
  client: Pick<PayloadClient, 'deletePayload'>,
  collectionName: string,
  ids: string[],
  keys: string[],
): Promise<void> {
  if (ids.length === 0 || keys.length === 0) return;
  await client.deletePayload(collectionName, { wait: true, points: ids, keys });
}
