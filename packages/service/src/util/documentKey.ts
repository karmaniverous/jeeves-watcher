/**
 * @module util/documentKey
 * Keys for stores addressed by file path or source reference: `<name>://<id>` references are kept verbatim (case-sensitive); file paths are normalised. Pure.
 */

import { SOURCE_REFERENCE_PATTERN } from '@karmaniverous/jeeves-watcher-core';

import { normalizePath } from './normalizePath';

/**
 * Test whether a document key is a source reference (`<name>://<id>`) rather
 * than a file path. Source names are at least two characters, so a Windows
 * drive letter (`c:/…`) never matches.
 *
 * @param key - A file path or source reference.
 * @returns True for a source reference.
 */
export function isSourceReference(key: string): boolean {
  return SOURCE_REFERENCE_PATTERN.test(key);
}

/**
 * Normalise a document key for storage: source references unchanged, file
 * paths through {@link normalizePath} (lowercase, forward slashes).
 *
 * @param key - A file path or source reference.
 * @returns The storage key.
 */
export function normalizeDocumentKey(key: string): string {
  return isSourceReference(key) ? key : normalizePath(key);
}
