/**
 * @module watcher/roots
 * The resolved watch roots (globs' static prefixes, nested roots collapsed) and which root a path lies under. Pure.
 */

import { normalizeDocumentKey } from '../util/documentKey';

/** The watch roots, with path-to-root lookup by normalized key. */
export class WatchRoots {
  private readonly keys: Map<string, string>;

  /** @param roots - Resolved roots, as `resolveWatchPaths` returns them. */
  constructor(readonly roots: string[]) {
    this.keys = new Map(
      roots.map((root) => [normalizeDocumentKey(root), root]),
    );
  }

  /**
   * The root `path` lies under (or is), or undefined.
   *
   * @param path - Any path.
   * @returns The root, as given to the constructor.
   */
  rootOf(path: string): string | undefined {
    const key = normalizeDocumentKey(path);
    for (const [rootKey, root] of this.keys) {
      if (key === rootKey || key.startsWith(`${rootKey}/`)) return root;
    }
    return undefined;
  }
}
