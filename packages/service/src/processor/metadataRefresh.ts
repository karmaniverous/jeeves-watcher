/**
 * @module processor/metadataRefresh
 * Metadata-only updates: when a document's content hash is unchanged but its projected metadata differs, update payloads with setPayload (no re-embed). Qdrant I/O.
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
export type MetadataDiff = 'same' | 'changed' | 'keysRemoved';

/**
 * Compare a stored chunk-0 payload with the metadata that would be written.
 *
 * @param existing - Stored chunk-0 payload.
 * @param next - Metadata to write (system-field safe, incl. identity fields).
 * @returns `keysRemoved` when a stored non-system key is no longer projected
 *   (`setPayload` cannot remove it), `changed` when any value differs,
 *   otherwise `same`.
 */
export function diffMetadata(
  existing: Record<string, unknown>,
  next: Record<string, unknown>,
): MetadataDiff {
  for (const key of Object.keys(existing)) {
    if (!isReservedPayloadField(key) && !(key in next)) return 'keysRemoved';
  }
  const changed = Object.entries(next).some(
    ([key, value]) => !isEqual(existing[key], value),
  );
  return changed ? 'changed' : 'same';
}

/**
 * Refresh payload metadata of an unchanged-content document.
 *
 * @param vectorStore - The vector store.
 * @param document - The resolved document.
 * @param existing - Its stored chunk-0 payload (same content hash).
 * @returns `updated` after a `setPayload` on every chunk; `same` when nothing
 *   differs; `keysRemoved` when a full rewrite is needed.
 */
export async function refreshMetadata(
  vectorStore: VectorStore,
  document: ResolvedDocument,
  existing: Record<string, unknown>,
): Promise<'same' | 'updated' | 'keysRemoved'> {
  const next = withSystemFields(document.metadataWithRules, document.identity);
  const diff = diffMetadata(existing, next);
  if (diff !== 'changed') return diff;

  const { modifiedAt } = await document.dates(existing);
  const ids = documentChunkIds(document.identity, getChunkCount(existing));
  await withIssueType('upsert_error', () =>
    vectorStore.setPayload(ids, { ...next, [FIELD_MODIFIED_AT]: modifiedAt }),
  );
  return 'updated';
}
