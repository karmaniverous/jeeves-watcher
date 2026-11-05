/**
 * @module watcher/roots
 * The resolved watch roots (globs' static prefixes, nested roots collapsed) and which root a path lies under. Pure.
 */

import { keyWithin, normalizeDocumentKey } from '../util/documentKey';

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
      if (keyWithin(key, rootKey)) return root;
    }
    return undefined;
  }

  /**
   * Whether `path` is a root's own `.git` directory or lies beneath it
   * (D152): the watcher's VCS commits there must never become events.
   *
   * @param path - Any path.
   * @returns True under `<root>/.git`.
   */
  isRootGit(path: string): boolean {
    const key = normalizeDocumentKey(path);
    for (const rootKey of this.keys.keys()) {
      if (keyWithin(key, `${rootKey}/.git`)) return true;
    }
    return false;
  }
}
