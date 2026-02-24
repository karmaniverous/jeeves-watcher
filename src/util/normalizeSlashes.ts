/**
 * @module util/normalizeSlashes
 * Converts backslashes to forward slashes in paths without other transformations.
 */

/**
 * Normalize path separators: replace backslashes with forward slashes.
 *
 * Does NOT lowercase or strip drive letters — use `normalizePath()` if you need that.
 *
 * @param path - The path string to normalize.
 * @returns The path with forward slashes.
 */
export function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}
