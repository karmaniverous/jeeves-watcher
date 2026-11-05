/**
 * @module watcher/filteredEvents
 * `FileSystemWatcher`'s filtered `add`/`change`/`unlink` handlers: filters, initial-scan statistics, the inventory (kept synchronously, D99) and the queue actions. Pure apart from the actions' enqueues.
 */

import type pino from 'pino';

import type { InitialScanTracker } from '../api/InitialScanTracker';
import { normalizeDocumentKey } from '../util/documentKey';
import type { FileEventActions } from './fileEvents';
import type { FileStats, Inventory } from './inventory/Inventory';
import type { WatchFilter } from './pathFilter';
import type { ScanStats } from './ScanStats';

/**
 * Synthetic adds remembered for the source's own `add` (a periodic
 * reconcile's adds never get one, so the map is bounded).
 */
export const MAX_SYNTHETIC_ADDS = 10_000;

/** Dependencies of {@link FilteredEvents}. */
export interface FilteredEventsDeps {
  filter: WatchFilter;
  inventory: Inventory;
  actions: FileEventActions;
  scanStats: ScanStats;
  logger: pino.Logger;
  initialScanTracker?: InitialScanTracker;
  /** Whether the initial scan is still running. */
  scanning: () => boolean;
  /** Called after a `.gitignore` event refreshed the gitignore filter. */
  onGitignoreChange: (path: string) => void;
}

/**
 * The normal handlers every file event goes through, real or synthetic: a
 * path passing the filters updates the inventory, then the queue actions.
 */
export class FilteredEvents {
  /**
   * Settled stats of synthetic adds, by document key, awaiting the source's
   * own `add` for the same file (bounded; oldest dropped first).
   */
  private readonly syntheticAdds = new Map<string, FileStats>();

  /** @param deps - Filters, inventory, actions and scan bookkeeping. */
  constructor(private readonly deps: FilteredEventsDeps) {}

  /**
   * A file appeared (`stats` stored only when the inventory tracks them).
   *
   * @param path - The file.
   * @param stats - Its size and mtime, when read.
   * @param synthetic - Emitted by reconciliation after its stability wait.
   */
  add(path: string, stats?: FileStats, synthetic = false): void {
    const { filter, scanStats, initialScanTracker } = this.deps;
    if (filter.isRootGit(path)) return;
    const scanning = this.deps.scanning();
    if (!scanning && this.deps.inventory.get(path)) {
      this.knownAdd(path, stats);
      return;
    }
    if (scanning) {
      scanStats.total++;
      scanStats.classifyByRoot(path);
    }
    this.noteGitignore(path);
    if (!filter.globMatches(path)) {
      if (scanning) scanStats.globRejected++;
      else this.deps.logger.debug({ path }, 'File rejected by glob filter');
      return;
    }
    if (filter.isGitignored(path)) {
      if (scanning) scanStats.gitignored++;
      return;
    }
    if (scanning) {
      scanStats.matched++;
      initialScanTracker?.setMatched(scanStats.matched);
      initialScanTracker?.incrementEnqueued();
    }
    this.deps.inventory.set(path, stats);
    if (synthetic && stats) this.rememberSynthetic(path, stats);
    this.deps.actions.added(path, !scanning);
  }

  /**
   * An `add` for a file the inventory already holds. When reconciliation
   * added it first (a file written into a directory created after the
   * scan, which chokidar also reports) and the source's stats match the
   * settled ones, it is the same file: dropped, so it is enqueued once.
   * Otherwise (the content moved on, no stats, or a missed unlink) it is a
   * change, not a second create.
   */
  private knownAdd(path: string, stats?: FileStats): void {
    const key = normalizeDocumentKey(path);
    const settled = this.syntheticAdds.get(key);
    this.syntheticAdds.delete(key);
    if (
      settled &&
      stats &&
      settled.size === stats.size &&
      settled.mtimeMs === stats.mtimeMs
    ) {
      this.deps.logger.debug({ path }, 'Add already reconciled; dropped');
      return;
    }
    this.change(path, stats);
  }

  private rememberSynthetic(path: string, stats: FileStats): void {
    if (this.syntheticAdds.size >= MAX_SYNTHETIC_ADDS) {
      const oldest = this.syntheticAdds.keys().next().value;
      if (oldest !== undefined) this.syntheticAdds.delete(oldest);
    }
    this.syntheticAdds.set(normalizeDocumentKey(path), stats);
  }

  /** A file changed. */
  change(path: string, stats?: FileStats): void {
    const { filter } = this.deps;
    if (filter.isRootGit(path)) return;
    this.noteGitignore(path);
    if (!filter.globMatches(path)) {
      this.deps.logger.debug({ path }, 'File rejected by glob filter');
      return;
    }
    if (filter.isGitignored(path)) return;
    this.deps.inventory.set(path, stats);
    this.deps.actions.changed(path);
  }

  /** A file went away. */
  unlink(path: string): void {
    const { filter } = this.deps;
    if (filter.isRootGit(path)) return;
    this.noteGitignore(path);
    // Gone from disk, so gone from the inventory whatever the filters say.
    this.deps.inventory.delete(path);
    this.syntheticAdds.delete(normalizeDocumentKey(path));
    if (!filter.globMatches(path)) return;
    if (filter.isGitignored(path)) return;
    this.deps.actions.removed(path);
  }

  private noteGitignore(path: string): void {
    if (this.deps.filter.noteGitignoreChange(path)) {
      this.deps.onGitignoreChange(path);
    }
  }
}
