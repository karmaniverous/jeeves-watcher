/**
 * @module cache/ContentHashCache
 * In-memory cache mapping normalized file paths to content hashes.
 * Supports reverse lookup by hash for move correlation.
 */

import { normalizePath } from '../util/normalizePath';

/**
 * In-memory content hash cache for move detection.
 *
 * Maps normalized file paths to SHA-256 content hashes.
 * Supports reverse lookup (hash → paths) for correlating
 * unlink+add events as file moves.
 */
export class ContentHashCache {
  private readonly pathToHash = new Map<string, string>();
  private readonly hashToPaths = new Map<string, Set<string>>();

  /**
   * Store or update the content hash for a file path.
   *
   * @param filePath - The file path (will be normalized).
   * @param hash - The SHA-256 content hash.
   */
  set(filePath: string, hash: string): void {
    const normalized = normalizePath(filePath, true);
    const oldHash = this.pathToHash.get(normalized);

    // Remove from old hash index if hash changed
    if (oldHash !== undefined && oldHash !== hash) {
      const oldPaths = this.hashToPaths.get(oldHash);
      if (oldPaths) {
        oldPaths.delete(normalized);
        if (oldPaths.size === 0) this.hashToPaths.delete(oldHash);
      }
    }

    this.pathToHash.set(normalized, hash);

    let paths = this.hashToPaths.get(hash);
    if (!paths) {
      paths = new Set();
      this.hashToPaths.set(hash, paths);
    }
    paths.add(normalized);
  }

  /**
   * Get the content hash for a file path.
   *
   * @param filePath - The file path (will be normalized).
   * @returns The content hash, or undefined if not cached.
   */
  get(filePath: string): string | undefined {
    return this.pathToHash.get(normalizePath(filePath, true));
  }

  /**
   * Remove a file path from the cache.
   *
   * @param filePath - The file path (will be normalized).
   */
  delete(filePath: string): void {
    const normalized = normalizePath(filePath, true);
    const hash = this.pathToHash.get(normalized);
    if (hash === undefined) return;

    this.pathToHash.delete(normalized);

    const paths = this.hashToPaths.get(hash);
    if (paths) {
      paths.delete(normalized);
      if (paths.size === 0) this.hashToPaths.delete(hash);
    }
  }

  /**
   * Reverse lookup: get all file paths with a given content hash.
   *
   * @param hash - The content hash to look up.
   * @returns Array of normalized file paths with that hash.
   */
  getByHash(hash: string): string[] {
    const paths = this.hashToPaths.get(hash);
    return paths ? [...paths] : [];
  }

  /** Number of cached entries. */
  get size(): number {
    return this.pathToHash.size;
  }
}
