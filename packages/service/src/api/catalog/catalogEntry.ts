/**
 * @module api/catalog/catalogEntry
 * Type-only helper: look up one `WATCHER_CATALOG` entry by name, so each
 * catalog handler module can type itself as `CatalogHandler<Entry<'name'>>`
 * instead of the whole catalog. No I/O.
 */

import type { WatcherCatalog } from '@karmaniverous/jeeves-watcher-core';

/** Every entry name in `WATCHER_CATALOG`. */
export type WatcherEntryName = WatcherCatalog['entries'][number]['name'];

/** The `WATCHER_CATALOG` entry with the given name. */
export type Entry<Name extends WatcherEntryName> = Extract<
  WatcherCatalog['entries'][number],
  { name: Name }
>;
