/**
 * @module watcher/inventory/Inventory
 * `FileSystemWatcher`'s inventory (D99): the files that passed its filters, keyed by `normalizeDocumentKey`, with the child-set directory index (D127, D150). Pure.
 */

import { normalizeDocumentKey } from '../../util/documentKey';
import { DirectoryIndex } from './DirectoryIndex';

/** File size and modification time, as a walk or `stat` reports them. */
export interface FileStats {
  /** Size in bytes. */
  size: number;
  /** Modification time (ms since epoch). */
  mtimeMs: number;
}

/** One inventory entry. */
export interface InventoryEntry {
  /** The path as the source reported it. */
  path: string;
  /** Size, when the inventory tracks stats (parcel source). */
  size?: number;
  /** Modification time, when the inventory tracks stats. */
  mtimeMs?: number;
}

/**
 * The files the change source last saw that pass `FileSystemWatcher`'s
 * filters. Stats are stored only when `trackStats` is set (the parcel
 * source, whose initial set is the walk); under chokidar entries hold paths
 * only (spec Design 9).
 */
export class Inventory {
  private readonly entries = new Map<string, InventoryEntry>();
  private readonly index = new DirectoryIndex();

  /** @param trackStats - Store size and mtime with each entry. */
  constructor(private readonly trackStats: boolean) {}

  /** Number of files. */
  get size(): number {
    return this.entries.size;
  }

  /** Add or update a file. */
  set(path: string, stats?: FileStats): void {
    const key = normalizeDocumentKey(path);
    if (!this.entries.has(key)) this.index.addFile(key);
    this.entries.set(
      key,
      this.trackStats && stats
        ? { path, size: stats.size, mtimeMs: stats.mtimeMs }
        : { path },
    );
  }

  /**
   * Remove a file.
   *
   * @returns True when it was present.
   */
  delete(path: string): boolean {
    const key = normalizeDocumentKey(path);
    if (!this.entries.delete(key)) return false;
    this.index.removeFile(key);
    return true;
  }

  /** The entry for a path, if present. */
  get(path: string): InventoryEntry | undefined {
    return this.entries.get(normalizeDocumentKey(path));
  }

  /**
   * The entries beneath a directory, at any depth, keyed by document key;
   * O(subtree size), never a scan of the inventory.
   */
  entriesUnder(dir: string): Map<string, InventoryEntry> {
    const under = new Map<string, InventoryEntry>();
    for (const key of this.index.filesUnder(normalizeDocumentKey(dir))) {
      const entry = this.entries.get(key);
      if (entry) under.set(key, entry);
    }
    return under;
  }
}
