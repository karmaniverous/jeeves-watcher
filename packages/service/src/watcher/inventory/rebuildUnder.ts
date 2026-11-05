/**
 * @module watcher/inventory/rebuildUnder
 * Rebuild the inventory entries under a directory after its `.gitignore` changed (D99): drop entries now filtered, add files on disk that now pass, emitting nothing. I/O: one walk.
 */

import type pino from 'pino';

import { normalizeError } from '../../util/normalizeError';
import type { WatchFilter } from '../pathFilter';
import { walk, type WalkOptions } from '../walk/Walker';
import { walkFilters } from '../walk/walkFilters';
import type { Inventory } from './Inventory';

/**
 * Re-filter the inventory under `dir`. Dropped entries are not unlinked
 * (their points stay, as in 0.20.0) and new entries are not added to the
 * queue (they are indexed on their next change, as in 0.20.0).
 *
 * @param inventory - The inventory.
 * @param dir - The changed `.gitignore`'s directory.
 * @param options - Walk filters (the current filter state) and limiter.
 * @param isFiltered - Whether an inventory path is now filtered out.
 * @returns How many entries were dropped and added.
 */
async function rebuildUnder(
  inventory: Inventory,
  dir: string,
  options: WalkOptions,
  isFiltered: (path: string) => boolean,
): Promise<{ dropped: number; added: number }> {
  const walked = await walk(dir, options);
  let dropped = 0;
  for (const entry of inventory.entriesUnder(dir).values()) {
    if (isFiltered(entry.path) && inventory.delete(entry.path)) dropped++;
  }
  let added = 0;
  for (const file of walked.values()) {
    if (inventory.get(file.path)) continue;
    inventory.set(file.path, file);
    added++;
  }
  return { dropped, added };
}

/** What {@link rebuildAfterGitignore} reads from the running watcher. */
export interface GitignoreRebuildContext {
  inventory: Inventory;
  filter: WatchFilter;
  /** `watch.ignored` matchers (plus root `.git`). */
  ignore: ((path: string) => boolean)[];
}

/**
 * Rebuild the inventory under a changed `.gitignore`'s directory with the
 * watcher's current filters, logging the outcome; never rejects.
 *
 * @param context - Inventory and filters.
 * @param dir - The `.gitignore`'s directory.
 * @param logger - Logger.
 */
export async function rebuildAfterGitignore(
  context: GitignoreRebuildContext,
  dir: string,
  logger: pino.Logger,
): Promise<void> {
  const { inventory, filter, ignore } = context;
  try {
    const result = await rebuildUnder(
      inventory,
      dir,
      walkFilters(filter, ignore),
      (path) => filter.isGitignored(path),
    );
    logger.info(
      { dir, ...result },
      'Inventory rebuilt after .gitignore change',
    );
  } catch (error) {
    logger.warn(
      { dir, err: normalizeError(error) },
      'Inventory rebuild after .gitignore change failed',
    );
  }
}
