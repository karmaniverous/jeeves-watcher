/**
 * @module processor/metadataRefresh
 * Metadata-only updates (no re-embed): diff projected metadata against the stored chunk-0 payload, write changed values with set-payload and remove keys no longer projected with delete-payload. Used for unchanged-content source documents and file rules re-apply. Qdrant I/O.
 */

import { isReservedPayloadField } from '@karmaniverous/jeeves-watcher-core';
import { isEqual } from 'radash';

import type { VectorStore } from '../vectorStore';
import { getChunkCount } from './chunkIds';
import { documentChunkIds, type DocumentIdentity } from './documentIdentity';
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

/** Outcome of a metadata-only write. */
export type MetadataWriteOutcome = 'same' | 'updated';

/**
 * Write projected metadata to every chunk of an indexed document without
 * re-embedding: changed values with set-payload, stored non-system keys no
 * longer projected removed with delete-payload. Nothing is written when
 * nothing differs.
 *
 * @param vectorStore - The vector store.
 * @param identity - The document identity (chunk IDs).
 * @param next - Metadata to write (from {@link withSystemFields}).
 * @param existing - The stored chunk-0 payload (chunk count, diff base).
 * @param extra - Extra fields written with a change only (e.g. `modified_at`),
 *   computed only when something differs.
 * @returns `updated` after a payload write; `same` when nothing differs.
 * @throws ProcessingFailure `upsert_error` when a payload write fails.
 */
export async function writeProjectedMetadata(
  vectorStore: VectorStore,
  identity: DocumentIdentity,
  next: Record<string, unknown>,
  existing: Record<string, unknown>,
  extra?: () => Promise<Record<string, unknown>>,
): Promise<MetadataWriteOutcome> {
  const { changed, removed } = diffMetadata(existing, next);
  if (!changed && removed.length === 0) return 'same';

  const fields = extra ? await extra() : {};
  const ids = documentChunkIds(identity, getChunkCount(existing));
  await withIssueType('upsert_error', async () => {
    await vectorStore.setPayload(ids, { ...next, ...fields });
    if (removed.length > 0) await vectorStore.deletePayload(ids, removed);
  });
  return 'updated';
}

/**
 * Refresh payload metadata of an unchanged-content document (see
 * {@link writeProjectedMetadata}); a change also refreshes `modified_at`.
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
): Promise<MetadataWriteOutcome> {
  const { identity, metadata, matchedRules } = document;
  const next = withSystemFields(metadata, identity, matchedRules);
  return writeProjectedMetadata(
    vectorStore,
    identity,
    next,
    existing,
    async () => {
      const { modifiedAt } = await document.dates(existing);
      return { [FIELD_MODIFIED_AT]: modifiedAt };
    },
  );
}
