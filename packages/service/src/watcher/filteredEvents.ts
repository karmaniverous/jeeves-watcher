/**
 * @module watcher/filteredEvents
 * `FileSystemWatcher`'s filtered `add`/`change`/`unlink` handlers: filters, initial-scan statistics, the inventory (kept synchronously, D99) and the queue actions. Pure apart from the actions' enqueues.
 */

import type pino from 'pino';

import type { InitialScanTracker } from '../api/InitialScanTracker';
import type { FileEventActions } from './fileEvents';
import type { FileStats, Inventory } from './inventory/Inventory';
import type { WatchFilter } from './pathFilter';
import type { ScanStats } from './ScanStats';

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
  /** @param deps - Filters, inventory, actions and scan bookkeeping. */
  constructor(private readonly deps: FilteredEventsDeps) {}

  /** A file appeared (`stats` stored only when the inventory tracks them). */
  add(path: string, stats?: FileStats): void {
    const { filter, scanStats, initialScanTracker } = this.deps;
    const scanning = this.deps.scanning();
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
    this.deps.actions.added(path, !scanning);
  }

  /** A file changed. */
  change(path: string, stats?: FileStats): void {
    const { filter } = this.deps;
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
    this.noteGitignore(path);
    // Gone from disk, so gone from the inventory whatever the filters say.
    this.deps.inventory.delete(path);
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
