/**
 * @module watcher/reconcile/RerunSet
 * Directories waiting to be reconciled after a root's running reconcile, merged by containment (D179): a directory covered by an ancestor in the set is dropped, and a new ancestor replaces its descendants. Pure.
 */

import { normalizeDocumentKey } from '../../util/documentKey';

/** Whether `key` is `ancestor` or lies beneath it. */
function within(key: string, ancestor: string): boolean {
  return key === ancestor || key.startsWith(`${ancestor}/`);
}

/** A containment-merged set of directories. */
export class RerunSet {
  private readonly dirs = new Map<string, string>();

  /** Directories waiting. */
  get size(): number {
    return this.dirs.size;
  }

  /** Add a directory, merging by containment. */
  add(dir: string): void {
    const key = normalizeDocumentKey(dir);
    for (const existing of this.dirs.keys()) {
      if (within(key, existing)) return;
    }
    for (const existing of [...this.dirs.keys()]) {
      if (within(existing, key)) this.dirs.delete(existing);
    }
    this.dirs.set(key, dir);
  }

  /** Remove and return every waiting directory. */
  take(): string[] {
    const dirs = [...this.dirs.values()];
    this.dirs.clear();
    return dirs;
  }
}
