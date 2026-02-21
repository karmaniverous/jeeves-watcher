/**
 * @module hash
 * Provides SHA-256 content hashing. Pure function: given text string, returns hex digest. No I/O or side effects.
 */
import { createHash } from 'node:crypto';

/**
 * Compute a SHA-256 hex digest of the given text.
 *
 * @param text - The input text to hash.
 * @returns The hex-encoded SHA-256 hash.
 */
export function contentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
