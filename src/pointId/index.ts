/**
 * @module pointId
 * Generates deterministic UUIDv5 point IDs for file paths and chunk indices. Pure function: normalizes paths, returns stable IDs. No I/O.
 */
import { v5 as uuidV5 } from 'uuid';

/** Namespace UUID for jeeves-watcher point IDs. */
const NAMESPACE = '6a6f686e-6761-4c74-ad6a-656576657321';

/**
 * Normalise a file path for deterministic point ID generation.
 *
 * @param filePath - The original file path.
 * @returns The normalised path string.
 */
function normalisePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase();
}

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
      ? `${normalisePath(filePath)}#${String(chunkIndex)}`
      : normalisePath(filePath);
  return uuidV5(key, NAMESPACE);
}
