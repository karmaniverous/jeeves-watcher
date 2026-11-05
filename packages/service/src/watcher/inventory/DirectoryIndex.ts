/**
 * @module watcher/inventory/DirectoryIndex
 * The inventory's directory index (D127, D150): each directory key maps to the file and child-directory keys directly beneath it, so a subtree is enumerated in O(its size). Pure.
 */

/** Keys directly beneath one directory. */
interface DirectoryNode {
  /** File keys directly in the directory. */
  files: Set<string>;
  /** Child directory keys. */
  dirs: Set<string>;
}

/**
 * The parent key of a normalized key (`a/b` for `a/b/c`), or undefined at the
 * top (`/tmp`, `c:`).
 *
 * @param key - A normalized key (forward slashes).
 * @returns Its parent key.
 */
export function parentKey(key: string): string | undefined {
  const at = key.lastIndexOf('/');
  return at > 0 ? key.slice(0, at) : undefined;
}

/**
 * Directory keys holding at least one indexed file beneath them, with their
 * direct children. A directory leaves the index when both sets empty.
 */
export class DirectoryIndex {
  private readonly nodes = new Map<string, DirectoryNode>();

  /** Whether `dirKey` has indexed files beneath it (one hash lookup). */
  has(dirKey: string): boolean {
    return this.nodes.has(dirKey);
  }

  /** Link a file key into its directory chain. */
  addFile(fileKey: string): void {
    let child = fileKey;
    let isFile = true;
    for (
      let dir = parentKey(fileKey);
      dir !== undefined;
      dir = parentKey(dir)
    ) {
      let node = this.nodes.get(dir);
      const existed = node !== undefined;
      if (!node) {
        node = { files: new Set(), dirs: new Set() };
        this.nodes.set(dir, node);
      }
      (isFile ? node.files : node.dirs).add(child);
      // An existing node is already linked to its ancestors.
      if (existed) return;
      child = dir;
      isFile = false;
    }
  }

  /** Unlink a file key, dropping directories left empty. */
  removeFile(fileKey: string): void {
    let child = fileKey;
    let isFile = true;
    for (
      let dir = parentKey(fileKey);
      dir !== undefined;
      dir = parentKey(dir)
    ) {
      const node = this.nodes.get(dir);
      if (!node) return;
      (isFile ? node.files : node.dirs).delete(child);
      if (node.files.size > 0 || node.dirs.size > 0) return;
      this.nodes.delete(dir);
      child = dir;
      isFile = false;
    }
  }

  /**
   * Every file key beneath `dirKey`, at any depth, visiting each directory
   * of the subtree once.
   */
  *filesUnder(dirKey: string): Generator<string> {
    const stack = [dirKey];
    for (let dir = stack.pop(); dir !== undefined; dir = stack.pop()) {
      const node = this.nodes.get(dir);
      if (!node) continue;
      yield* node.files;
      stack.push(...node.dirs);
    }
  }
}
