/**
 * @module processor/metadataRefresh
 * Metadata-only updates: when a document's content hash is unchanged but its projected metadata differs, update payloads with set-payload and remove keys no longer projected with delete-payload (no re-embed). Qdrant I/O.
 */

import { isReservedPayloadField } from '@karmaniverous/jeeves-watcher-core';
import { isEqual } from 'radash';

import type { VectorStore } from '../vectorStore';
import { getChunkCount } from './chunkIds';
import { documentChunkIds } from './documentIdentity';
import { withIssueType } from './issueRecording';
import { FIELD_MODIFIED_AT } from './payloadFields';
import type { ResolvedDocument } from './resolvers/types';
import { withSystemFields } from './systemFields';

/** How stored metadata compares with freshly projected metadata. */
export interface MetadataDiff {
  /** Whether any projected value differs from the stored one. */
  changed: boolean;
  /** Stored non-system keys that are no longer projected. */
  removed: string[];
}

/**
 * Compare a stored chunk-0 payload with the metadata that would be written.
 *
 * @param existing - Stored chunk-0 payload.
 * @param next - Metadata to write (system-field safe, incl. identity fields).
 * @returns Whether any value differs, and the stored non-system keys that
 *   are no longer projected (to be removed with delete-payload).
 */
export function diffMetadata(
  existing: Record<string, unknown>,
  next: Record<string, unknown>,
): MetadataDiff {
  const removed = Object.keys(existing).filter(
    (key) => !isReservedPayloadField(key) && !(key in next),
  );
  const changed = Object.entries(next).some(
    ([key, value]) => !isEqual(existing[key], value),
  );
  return { changed, removed };
}

/**
 * Refresh payload metadata of an unchanged-content document: changed values
 * are written with set-payload and keys no longer projected are removed with
 * delete-payload, on every chunk. Nothing is re-embedded.
 *
 * @param vectorStore - The vector store.
 * @param document - The resolved document.
 * @param existing - Its stored chunk-0 payload (same content hash).
 * @returns `updated` after a payload write; `same` when nothing differs.
 * @throws ProcessingFailure `upsert_error` when a payload write fails.
 */
export async function refreshMetadata(
  vectorStore: VectorStore,
  document: ResolvedDocument,
  existing: Record<string, unknown>,
): Promise<'same' | 'updated'> {
  const { identity, metadata, matchedRules } = document;
  const next = withSystemFields(metadata, identity, matchedRules);
  const { changed, removed } = diffMetadata(existing, next);
  if (!changed && removed.length === 0) return 'same';

  const { modifiedAt } = await document.dates(existing);
  const ids = documentChunkIds(identity, getChunkCount(existing));
  await withIssueType('upsert_error', async () => {
    await vectorStore.setPayload(ids, {
      ...next,
      [FIELD_MODIFIED_AT]: modifiedAt,
    });
    if (removed.length > 0) await vectorStore.deletePayload(ids, removed);
  });
  return 'updated';
}
