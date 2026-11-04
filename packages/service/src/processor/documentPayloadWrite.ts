/**
 * @module processor/documentPayloadWrite
 * Write payload to every point of one document (D139, D154): one by-filter write when the document's field (file_path, or source) has a ready keyword index, otherwise ID addressing over the chunk-0 count, limited to the IDs that exist. Qdrant I/O.
 *
 * The ID fallback also covers a document left in the claim state by a
 * failed streamed write (D105): chunk 0 counts the high-water mark, some of
 * whose IDs may not exist, and a set-payload on a missing ID would fail.
 */

import type { VectorStore } from '../vectorStore';
import { getChunkCount } from './chunkIds';
import {
  documentChunkIds,
  type DocumentIdentity,
  identityPayload,
} from './documentIdentity';
import {
  FIELD_FILE_PATH,
  FIELD_SOURCE,
  SOURCE_POINT_CONDITIONS,
} from './payloadFields';

/** The vector-store operations a document payload write uses. */
export type DocumentPayloadStore = Pick<
  VectorStore,
  | 'keywordIndexReady'
  | 'setPayloadWhere'
  | 'deletePayloadWhere'
  | 'existingIds'
  | 'setPayload'
  | 'deletePayload'
>;

/** The change to write. */
export interface DocumentPayloadChange {
  /** Payload fields to set on every point. */
  set: Record<string, unknown>;
  /** Payload keys to remove from every point. */
  remove?: string[];
}

/**
 * The filter selecting exactly the document's points, when its field has a
 * ready keyword index; otherwise `undefined` (use IDs).
 *
 * @param store - The vector store (index readiness).
 * @param identity - The document identity.
 * @param chunk0 - The stored chunk-0 payload: its `file_path` (stored
 *   casing, which point IDs ignore but a keyword match does not) is matched.
 * @returns A Qdrant filter, or `undefined`.
 */
export function documentFilter(
  store: Pick<VectorStore, 'keywordIndexReady'>,
  identity: DocumentIdentity,
  chunk0: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (identity.kind === 'file') {
    if (!store.keywordIndexReady(FIELD_FILE_PATH)) return undefined;
    const stored = chunk0[FIELD_FILE_PATH];
    const value =
      typeof stored === 'string'
        ? stored
        : identityPayload(identity)[FIELD_FILE_PATH];
    return { must: [{ key: FIELD_FILE_PATH, match: { value } }] };
  }
  if (!store.keywordIndexReady(FIELD_SOURCE)) return undefined;
  return {
    must: [
      { key: FIELD_SOURCE, match: { value: identity.ref } },
      ...SOURCE_POINT_CONDITIONS.must,
    ],
    must_not: SOURCE_POINT_CONDITIONS.must_not,
  };
}

/**
 * Apply `change` to every point of the document.
 *
 * @param store - The vector store.
 * @param identity - The stored document identity.
 * @param chunk0 - The stored chunk-0 payload (chunk count for ID addressing).
 * @param change - Fields to set and keys to remove.
 * @returns The addressing used: `filter`, or `ids` with how many points.
 */
export async function writeDocumentPayload(
  store: DocumentPayloadStore,
  identity: DocumentIdentity,
  chunk0: Record<string, unknown>,
  change: DocumentPayloadChange,
): Promise<{ by: 'filter' } | { by: 'ids'; points: number }> {
  const remove = change.remove ?? [];
  const filter = documentFilter(store, identity, chunk0);
  if (filter) {
    await store.setPayloadWhere(filter, change.set);
    if (remove.length > 0) await store.deletePayloadWhere(filter, remove);
    return { by: 'filter' };
  }
  const ids = await store.existingIds(
    documentChunkIds(identity, getChunkCount(chunk0)),
  );
  await store.setPayload(ids, change.set);
  if (remove.length > 0) await store.deletePayload(ids, remove);
  return { by: 'ids', points: ids.length };
}
