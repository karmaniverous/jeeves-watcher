/**
 * @module test/catalogRoutes
 * Test helper: serve some `WATCHER_CATALOG` entries on a Fastify app the way the service does (catalog request validation, jeeves's standard error body, `'strict'` response validation), with the handlers under test. Lets a handler test drive its route over `inject` without the whole server.
 */

import { defineCatalog } from '@karmaniverous/jeeves/catalog';
import {
  type CatalogHandlers,
  registerCatalogRoutes,
} from '@karmaniverous/jeeves/fastify';
import {
  WATCHER_CATALOG,
  type WatcherCatalog,
} from '@karmaniverous/jeeves-watcher-core';
import type { FastifyInstance } from 'fastify';

/**
 * Register the catalog entries named by `handlers`, each served by its
 * handler. Await it before `inject`.
 *
 * @param app - The Fastify app (any hooks already added).
 * @param handlers - Handlers for the entries to serve, keyed by entry name.
 */
export async function registerCatalogEntries(
  app: FastifyInstance,
  handlers: Partial<CatalogHandlers<WatcherCatalog>>,
): Promise<void> {
  const catalog = defineCatalog(
    WATCHER_CATALOG.entries.filter((entry) => entry.name in handlers),
  );
  await registerCatalogRoutes(
    app,
    catalog,
    handlers as CatalogHandlers<typeof catalog>,
    { responseValidation: 'strict' },
  );
}
