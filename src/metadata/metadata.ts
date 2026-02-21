/**
 * @module metadata/metadata
 * Persists file metadata as .meta.json. I/O: reads/writes/deletes metadata files under metadataDir. Path mapping via SHA-256 hash.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Normalise a file path for deterministic mapping: lowercase, forward slashes, strip leading drive letter colon.
 *
 * @param filePath - The original file path.
 * @returns The normalised path string.
 */
function normalisePath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):/, (_m, letter: string) => letter.toLowerCase())
    .toLowerCase();
}

/**
 * Derive a deterministic `.meta.json` path for a given file.
 *
 * @param filePath - The watched file path.
 * @param metadataDir - The root metadata directory.
 * @returns The full path to the metadata file.
 */
export function metadataPath(filePath: string, metadataDir: string): string {
  const normalised = normalisePath(filePath);
  const hash = createHash('sha256').update(normalised, 'utf8').digest('hex');
  return join(metadataDir, `${hash}.meta.json`);
}

/**
 * Read persisted metadata for a file.
 *
 * @param filePath - The watched file path.
 * @param metadataDir - The root metadata directory.
 * @returns The parsed metadata object, or `null` if not found.
 */
export async function readMetadata(
  filePath: string,
  metadataDir: string,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(metadataPath(filePath, metadataDir), 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Write metadata for a file.
 *
 * @param filePath - The watched file path.
 * @param metadataDir - The root metadata directory.
 * @param metadata - The metadata to persist.
 */
export async function writeMetadata(
  filePath: string,
  metadataDir: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const dest = metadataPath(filePath, metadataDir);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, JSON.stringify(metadata, null, 2), 'utf8');
}

/**
 * Delete metadata for a file.
 *
 * @param filePath - The watched file path.
 * @param metadataDir - The root metadata directory.
 */
export async function deleteMetadata(
  filePath: string,
  metadataDir: string,
): Promise<void> {
  try {
    await rm(metadataPath(filePath, metadataDir));
  } catch {
    // Ignore if file doesn't exist.
  }
}
