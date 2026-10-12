/**
 * @module processor/documentIdentity
 * Document identity (file path or source reference + designated rule): store keys, point IDs, chunk IDs and identity payload fields. Pure, no I/O.
 */

import { sourceReferenceSchema } from '@karmaniverous/jeeves-watcher-core';
import { z } from 'zod';

import { pointId, sourcePointId } from '../pointId';
import { normalizeSlashes } from '../util/normalizeSlashes';
import { chunkIds } from './chunkIds';
import {
  FIELD_FILE_PATH,
  FIELD_SOURCE,
  FIELD_SOURCE_RULE,
} from './payloadFields';

/**
 * Identity of an indexed document. A file is keyed by its path (point IDs
 * normalised, case-insensitive); a source document by its exact reference
 * (case-sensitive) and carries its designated rule. Every point carries
 * exactly one of `file_path` or `source`.
 */
export const documentIdentitySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('file'),
    /** The file path. */
    filePath: z.string().min(1),
  }),
  z.object({
    kind: z.literal('source'),
    /** The exact `<name>://<id>` reference. */
    ref: sourceReferenceSchema,
    /** Designated rule name. */
    rule: z.string().min(1),
  }),
]);

/** Identity of an indexed document. */
export type DocumentIdentity = z.infer<typeof documentIdentitySchema>;

/**
 * Key used for the issues and enrichment stores: the file path, or the
 * reference verbatim.
 *
 * @param identity - The document identity.
 * @returns The store key.
 */
export function documentKey(identity: DocumentIdentity): string {
  return identity.kind === 'file' ? identity.filePath : identity.ref;
}

/**
 * Point ID of one chunk: `pointId(file_path, i)` for files (unchanged), the
 * un-normalised `sourcePointId(ref, i)` for source documents.
 *
 * @param identity - The document identity.
 * @param chunkIndex - Chunk index.
 * @returns The point ID.
 */
export function documentPointId(
  identity: DocumentIdentity,
  chunkIndex: number,
): string {
  return identity.kind === 'file'
    ? pointId(identity.filePath, chunkIndex)
    : sourcePointId(identity.ref, chunkIndex);
}

/**
 * Point IDs of all chunks of a document.
 *
 * @param identity - The document identity.
 * @param totalChunks - Number of chunks.
 * @returns The point IDs, in chunk order.
 */
export function documentChunkIds(
  identity: DocumentIdentity,
  totalChunks: number,
): string[] {
  if (identity.kind === 'file') return chunkIds(identity.filePath, totalChunks);
  return Array.from({ length: totalChunks }, (_, i) =>
    sourcePointId(identity.ref, i),
  );
}

/**
 * Identity payload fields: `file_path` for files; `source` and `source_rule`
 * for source documents (never `file_path`).
 *
 * @param identity - The document identity.
 * @returns The identity fields.
 */
export function identityPayload(
  identity: DocumentIdentity,
): Record<string, string> {
  return identity.kind === 'file'
    ? { [FIELD_FILE_PATH]: normalizeSlashes(identity.filePath) }
    : { [FIELD_SOURCE]: identity.ref, [FIELD_SOURCE_RULE]: identity.rule };
}

/**
 * Structured log fields naming the document.
 *
 * @param identity - The document identity.
 * @returns `{ filePath }` or `{ source }`.
 */
export function identityLogFields(
  identity: DocumentIdentity,
): Record<string, string> {
  return identity.kind === 'file'
    ? { filePath: identity.filePath }
    : { source: identity.ref };
}
