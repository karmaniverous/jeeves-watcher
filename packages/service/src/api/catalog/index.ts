/**
 * @module api/catalog
 * Catalog handlers for every `WATCHER_CATALOG` entry (#281 step 6):
 * `status`, `config` and `configApply` adapted from core's standard
 * handlers (`standardHandlers`), plus `render`, `search`, `scan` and
 * `vcsShow`. Not yet wired into routes (`createApiServer` still serves the
 * legacy routes; the route switch is #281 step 7).
 */

import type { CatalogHandlers } from '@karmaniverous/jeeves/fastify';
import { standardHandlers } from '@karmaniverous/jeeves/fastify';
import type { WatcherCatalog } from '@karmaniverous/jeeves-watcher-core';

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

/** Whether a `render` request targets a source document (never cached). */
function targetsSource(input: { body: { source?: string } }): boolean {
  return input.body.source !== undefined;
}

/**
 * Build the catalog handler for every `WATCHER_CATALOG` entry.
 *
 * @param options - Per-entry dependencies and the shared cache TTL.
 * @returns One handler per entry name, matching `WATCHER_CATALOG`.
 */
export function createCatalogHandlers(
  options: CreateCatalogHandlersOptions,
): CatalogHandlers<WatcherCatalog> {
  const standard = standardHandlers({
    status: createCatalogStatusSource(options.status),
    config: createCatalogConfigSource(options.config),
    configApply: createCatalogConfigApplySource(options.configApply),
  });

  return {
    status: withCatalogCache('status', options.cacheTtlMs, standard.status),
    config: withCatalogCache('config', options.cacheTtlMs, standard.config),
    configApply: standard.configApply,
    render: withCatalogCache(
      'render',
      options.cacheTtlMs,
      createCatalogRenderHandler(options.render),
      { shouldBypass: targetsSource },
    ),
    search: createCatalogSearchHandler(options.search),
    scan: createCatalogScanHandler(options.scan),
    vcsShow: createCatalogVcsShowHandler(options.vcsShow),
  };
}
