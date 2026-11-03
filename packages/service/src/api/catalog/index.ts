/**
 * @module api/catalog
 * Catalog handlers for every served catalog entry (`SERVED_CATALOG`): `status`, `config`
 * and `configApply` adapted from core's standard handlers
 * (`standardHandlers`), plus `render`, `search`, `scan` and `vcsShow`.
 * Registered by `api/registerCatalog`.
 */

import { defineCatalog } from '@karmaniverous/jeeves/catalog';
import type { CatalogHandlers } from '@karmaniverous/jeeves/fastify';
import { standardHandlers } from '@karmaniverous/jeeves/fastify';
import { WATCHER_CATALOG } from '@karmaniverous/jeeves-watcher-core';

import {
  type CatalogConfigApplyDeps,
  createCatalogConfigApplySource,
} from './configApplyHandler';
import {
  type CatalogConfigDeps,
  createCatalogConfigSource,
} from './configHandler';
import {
  type CatalogRenderDeps,
  createCatalogRenderHandler,
} from './renderHandler';
import { type CatalogScanDeps, createCatalogScanHandler } from './scanHandler';
import {
  type CatalogSearchDeps,
  createCatalogSearchHandler,
} from './searchHandler';
import {
  type CatalogStatusDeps,
  createCatalogStatusSource,
} from './statusHandler';
import {
  type CatalogVcsShowDeps,
  createCatalogVcsShowHandler,
} from './vcsShowHandler';
import { withCatalogCache } from './withCatalogCache';

/**
 * The catalog entries the service serves from the catalog so far. The other
 * routes keep their legacy registrations until the catalog switch (spec A3),
 * which serves the whole `WATCHER_CATALOG` and deletes this subset.
 */
export const SERVED_CATALOG = defineCatalog([
  WATCHER_CATALOG.byName('status'),
  WATCHER_CATALOG.byName('config'),
  WATCHER_CATALOG.byName('configApply'),
  WATCHER_CATALOG.byName('render'),
  WATCHER_CATALOG.byName('search'),
  WATCHER_CATALOG.byName('scan'),
  WATCHER_CATALOG.byName('vcsShow'),
] as const);

/** {@link SERVED_CATALOG}'s type. */
export type ServedCatalog = typeof SERVED_CATALOG;

/** Dependencies for every slice entry's catalog handler. */
export interface CreateCatalogHandlersOptions {
  /** `status` entry dependencies. */
  status: CatalogStatusDeps;
  /** `config` entry dependencies. */
  config: CatalogConfigDeps;
  /** `configApply` entry dependencies. */
  configApply: CatalogConfigApplyDeps;
  /** `render` entry dependencies. */
  render: CatalogRenderDeps;
  /** `search` entry dependencies. */
  search: CatalogSearchDeps;
  /** `scan` entry dependencies. */
  scan: CatalogScanDeps;
  /** `vcsShow` entry dependencies. */
  vcsShow: CatalogVcsShowDeps;
  /** Response cache TTL for the cached entries (`status`, `config`, the
   * file-target `render`). */
  cacheTtlMs: number;
}

/**
 * Build the catalog handler for every served catalog entry.
 *
 * @param options - Per-entry dependencies and the shared cache TTL.
 * @returns One handler per entry name, matching {@link SERVED_CATALOG}.
 */
export function createCatalogHandlers(
  options: CreateCatalogHandlersOptions,
): CatalogHandlers<ServedCatalog> {
  const standard = standardHandlers({
    status: createCatalogStatusSource(options.status),
    config: createCatalogConfigSource(options.config),
    configApply: createCatalogConfigApplySource(options.configApply),
  });

  return {
    status: withCatalogCache('status', options.cacheTtlMs, standard.status),
    config: withCatalogCache('config', options.cacheTtlMs, standard.config),
    configApply: standard.configApply,
    // Source renders reply Cache-Control: no-cache, so they are never cached.
    render: withCatalogCache(
      'render',
      options.cacheTtlMs,
      createCatalogRenderHandler(options.render),
    ),
    search: createCatalogSearchHandler(options.search),
    scan: createCatalogScanHandler(options.scan),
    vcsShow: createCatalogVcsShowHandler(options.vcsShow),
  };
}
