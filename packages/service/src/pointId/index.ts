/**
 * @module pointId
 * Generates deterministic UUIDv5 point IDs for file paths and chunk indices. Pure function: normalizes paths, returns stable IDs. No I/O.
 */
import { v5 as uuidV5 } from 'uuid';

import { normalizePath } from '../util/normalizePath';

/** Namespace UUID for jeeves-watcher point IDs. */
const NAMESPACE = '6a6f686e-6761-4c74-ad6a-656576657321';

/**
 * Generate a deterministic UUID v5 point ID for a file (and optional chunk index).
 *
 * @param filePath - The file path.
 * @param chunkIndex - Optional chunk index within the file.
 * @returns A deterministic UUID v5 string.
 */
export function pointId(filePath: string, chunkIndex?: number): string {
  const key =
    chunkIndex !== undefined
      ? `${normalizePath(filePath)}#${String(chunkIndex)}`
      : normalizePath(filePath);
  return uuidV5(key, NAMESPACE);
}

/**
 * Generate a deterministic UUID v5 point ID for a chunk of a source document.
 * The reference is used exactly as given (no normalisation), so source IDs are
 * case-sensitive; the namespace and `#<chunk>` suffix match {@link pointId}.
 *
 * @param reference - The exact `<name>://<id>` reference.
 * @param chunkIndex - Chunk index within the document.
 * @returns A deterministic UUID v5 string.
 */
export function sourcePointId(reference: string, chunkIndex: number): string {
  return uuidV5(`${reference}#${String(chunkIndex)}`, NAMESPACE);
}
