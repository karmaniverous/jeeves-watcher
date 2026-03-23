/**
 * @module hash
 * Provides SHA-256 content hashing. Pure functions: text hash and file hash. File hash does I/O.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * Compute a SHA-256 hex digest of the given text.
 *
 * @param text - The input text to hash.
 * @returns The hex-encoded SHA-256 hash.
 */
export function contentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Compute a SHA-256 hex digest of a file's raw bytes.
 *
 * @param filePath - Path to the file.
 * @returns The hex-encoded SHA-256 hash.
 */
export async function fileHash(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex');
}
