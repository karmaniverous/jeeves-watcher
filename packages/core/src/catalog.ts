/**
 * @module catalog
 * The watcher's endpoint catalog (`WATCHER_CATALOG`): one Zod-described entry per route, from which the service's routes and validation, the OpenAPI document, the SDK client, the CLI and the plugin's tools are derived. No I/O.
 *
 * @remarks
 * Holds every route (30 entries; spec Design 3, `countFacets` from Design
 * 12), each with its `kind`, listed by kind in `catalog/`. Entry
 * names are verb-first (D77, Design 14), and each is its operation's one
 * name: catalog entry, SDK method, OpenAPI `operationId` and, through
 * `toToolName`, plugin tool name. The catalog is the only route list
 * (`WATCHER_ENDPOINTS` is gone, D41).
 */

import { defineCatalog, standardEntries } from '@karmaniverous/jeeves/catalog';

import { watcherHealthSchema } from './api/index.js';
import { DESTRUCTIVE_ENTRIES } from './catalog/destructiveEntries.js';
import { READ_ENTRIES } from './catalog/readEntries.js';
import { bearer } from './catalog/routes.js';
import { WRITE_ENTRIES } from './catalog/writeEntries.js';

export { VCS_DISABLED_NOTE } from './catalog/routes.js';

/** The watcher endpoint catalog. */
export const WATCHER_CATALOG = defineCatalog([
  ...standardEntries('watcher', {
    auth: { config: bearer },
    healthSchema: watcherHealthSchema,
  }),
  ...READ_ENTRIES,
  ...WRITE_ENTRIES,
  ...DESTRUCTIVE_ENTRIES,
]);

/** The watcher endpoint catalog's type. */
export type WatcherCatalog = typeof WATCHER_CATALOG;
