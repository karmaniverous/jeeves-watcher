/**
 * @module api/catalog
 * Catalog handlers for every `WATCHER_CATALOG` entry: `status`, `config` and `configApply` adapted from core's standard handlers (`standardHandlers`), plus one handler per route. The `/vcs/*` handlers are built only while version control is on; otherwise each is a stub the feature gate always pre-empts (`api/featureGates`). Registered by `api/registerCatalog`.
 */

import type { CatalogHandlers } from '@karmaniverous/jeeves/fastify';
import { standardHandlers } from '@karmaniverous/jeeves/fastify';
import type { WatcherCatalog } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import { routeNotFound } from '../apiHooks';
import type { GatedEntryName } from '../featureGates';
import {
  type CatalogConfigApplyDeps,
  createCatalogConfigApplySource,
} from './configApplyHandler';
import {
  type CatalogConfigDeps,
  createCatalogConfigSource,
} from './configHandler';
import {
  type CatalogConfigMatchDeps,
  createCatalogConfigMatchHandler,
} from './configMatchHandler';
import { createCatalogConfigSchemaHandler } from './configSchemaHandler';
import {
  type CatalogConfigValidateDeps,
  createCatalogConfigValidateHandler,
} from './configValidateHandler';
import {
  type CatalogCountFacetsDeps,
  createCatalogCountFacetsHandler,
} from './countFacetsHandler';
import {
  type CatalogDocumentsDeleteDeps,
  createCatalogDocumentsDeleteHandler,
} from './documentsDeleteHandler';
import {
  type CatalogDocumentsDeps,
  createCatalogDocumentsHandler,
} from './documentsHandler';
import {
  type CatalogFacetsDeps,
  createCatalogFacetsHandler,
} from './facetsHandler';
import {
  type CatalogIssuesDeps,
  createCatalogIssuesHandler,
} from './issuesHandler';
import {
  type CatalogMetadataDeps,
  createCatalogMetadataHandler,
} from './metadataHandler';
import {
  type CatalogPointsDeleteDeps,
  createCatalogPointsDeleteHandler,
} from './pointsDeleteHandler';
import {
  type CatalogRebuildMetadataDeps,
  createCatalogRebuildMetadataHandler,
} from './rebuildMetadataHandler';
import {
  type CatalogReindexDeps,
  createCatalogReindexHandler,
} from './reindexHandler';
import {
  type CatalogRenderDeps,
  createCatalogRenderHandler,
} from './renderHandler';
import {
  type CatalogRulesReapplyDeps,
  createCatalogRulesReapplyHandler,
} from './rulesReapplyHandler';
import {
  type CatalogRuleDeps,
  createCatalogRulesRegisterHandler,
} from './rulesRegisterHandler';
import {
  createCatalogRulesUnregisterBySourceHandler,
  createCatalogRulesUnregisterHandler,
} from './rulesUnregisterHandler';
import { type CatalogScanDeps, createCatalogScanHandler } from './scanHandler';
import {
  type CatalogSearchDeps,
  createCatalogSearchHandler,
} from './searchHandler';
import {
  type CatalogStatusDeps,
  createCatalogStatusSource,
} from './statusHandler';
import { createCatalogVcsCheckExclusionHandler } from './vcsCheckExclusionHandler';
import type { CatalogVcsDeps } from './vcsDeps';
import { createCatalogVcsDiffHandler } from './vcsDiffHandler';
import { createCatalogVcsExcludeHandler } from './vcsExcludeHandler';
import { createCatalogVcsHistoryHandler } from './vcsHistoryHandler';
import { createCatalogVcsRevertHandler } from './vcsRevertHandler';
import { createCatalogVcsShowHandler } from './vcsShowHandler';
import { createCatalogVcsStatusHandler } from './vcsStatusHandler';
import { type CatalogWalkDeps, createCatalogWalkHandler } from './walkHandler';
import { withCatalogCache } from './withCatalogCache';

/** Dependencies for every catalog entry's handler. */
export interface CreateCatalogHandlersOptions {
  /**
   * Where the standard `status` and `configApply` handlers log their
   * failures (the app's Fastify runs with `logger: false`).
   */
  logger: Pick<pino.Logger, 'error'>;
  /** `status` entry dependencies. */
  status: CatalogStatusDeps;
  /** `config` entry dependencies. */
  config: CatalogConfigDeps;
  /** `configApply` entry dependencies. */
  configApply: CatalogConfigApplyDeps;
  /** `matchConfig` entry dependencies. */
  matchConfig: CatalogConfigMatchDeps;
  /** `validateConfig` entry dependencies. */
  validateConfig: CatalogConfigValidateDeps;
  /** `render` entry dependencies. */
  render: CatalogRenderDeps;
  /** `search` entry dependencies. */
  search: CatalogSearchDeps;
  /** `scan` entry dependencies. */
  scan: CatalogScanDeps;
  /** `listFacets` entry dependencies. */
  listFacets: CatalogFacetsDeps;
  /** `countFacets` entry dependencies. */
  countFacets: CatalogCountFacetsDeps;
  /** `walk` entry dependencies. */
  walk: CatalogWalkDeps;
  /** `listIssues` entry dependencies. */
  listIssues: CatalogIssuesDeps;
  /** `setMetadata` entry dependencies. */
  setMetadata: CatalogMetadataDeps;
  /** `reindex` entry dependencies. */
  reindex: CatalogReindexDeps;
  /** `notifyDocuments` entry dependencies. */
  notifyDocuments: CatalogDocumentsDeps;
  /** `deleteDocuments` entry dependencies. */
  deleteDocuments: CatalogDocumentsDeleteDeps;
  /** `deletePoints` entry dependencies. */
  deletePoints: CatalogPointsDeleteDeps;
  /** `rebuildMetadata` entry dependencies. */
  rebuildMetadata: CatalogRebuildMetadataDeps;
  /** `reapplyRules` entry dependencies. */
  reapplyRules: CatalogRulesReapplyDeps;
  /** Virtual-rule entries' dependencies (`registerRules`, `unregisterRules`,
   * `unregisterRulesBySource`). */
  rules: CatalogRuleDeps;
  /** `/vcs/*` entries' dependencies; absent while version control is off. */
  vcs?: CatalogVcsDeps;
  /** Response cache TTL for the cached entries (`status`, `config`,
   * `getConfigSchema`, `listIssues`, the file-target `render`). */
  cacheTtlMs: number;
}

/** The handlers of the gated (`/vcs/*`) entries. */
type GatedHandlers = Pick<CatalogHandlers<WatcherCatalog>, GatedEntryName>;

/**
 * The `/vcs/*` handlers while version control is on.
 *
 * @param deps - VCS coordinator and logger.
 * @returns One handler per `/vcs/*` entry.
 */
export function createVcsCatalogHandlers(deps: CatalogVcsDeps): GatedHandlers {
  return {
    getVcsStatus: createCatalogVcsStatusHandler(deps),
    listVcsHistory: createCatalogVcsHistoryHandler(deps),
    showVcsFile: createCatalogVcsShowHandler(deps),
    diffVcs: createCatalogVcsDiffHandler(deps),
    checkVcsExclusion: createCatalogVcsCheckExclusionHandler(deps),
    revertVcs: createCatalogVcsRevertHandler(deps),
    excludeVcsPath: createCatalogVcsExcludeHandler(deps),
  };
}

/**
 * The stub of a gated entry while its feature is off: `RouteNotFound`, the
 * not-found 404 an unregistered route sends. The feature gate answers every
 * such request before the route runs, so the stub only keeps the handler map
 * total.
 *
 * @returns The stub handler.
 */
function gatedOff() {
  return (
    _input: unknown,
    request: { method: string; url: string },
  ): Promise<never> => Promise.reject(routeNotFound(request));
}

/**
 * The `/vcs/*` stubs while version control is off.
 *
 * @returns One stub per `/vcs/*` entry.
 */
function vcsOffHandlers(): GatedHandlers {
  return {
    getVcsStatus: gatedOff(),
    listVcsHistory: gatedOff(),
    showVcsFile: gatedOff(),
    diffVcs: gatedOff(),
    checkVcsExclusion: gatedOff(),
    revertVcs: gatedOff(),
    excludeVcsPath: gatedOff(),
  };
}

/**
 * Build the catalog handler for every catalog entry.
 *
 * @param options - Per-entry dependencies and the shared cache TTL.
 * @returns One handler per entry name, matching `WATCHER_CATALOG`.
 */
export function createCatalogHandlers(
  options: CreateCatalogHandlersOptions,
): CatalogHandlers<WatcherCatalog> {
  const ttl = options.cacheTtlMs;
  const standard = standardHandlers(
    {
      status: createCatalogStatusSource(options.status),
      config: createCatalogConfigSource(options.config),
      configApply: createCatalogConfigApplySource(options.configApply),
    },
    { logger: options.logger },
  );

  return {
    status: withCatalogCache('status', ttl, standard.status),
    config: withCatalogCache('config', ttl, standard.config),
    configApply: standard.configApply,
    getConfigSchema: withCatalogCache(
      'getConfigSchema',
      ttl,
      createCatalogConfigSchemaHandler(),
    ),
    matchConfig: createCatalogConfigMatchHandler(options.matchConfig),
    validateConfig: createCatalogConfigValidateHandler(options.validateConfig),
    // Source renders reply Cache-Control: no-cache, so they are never cached.
    render: withCatalogCache(
      'render',
      ttl,
      createCatalogRenderHandler(options.render),
    ),
    search: createCatalogSearchHandler(options.search),
    scan: createCatalogScanHandler(options.scan),
    listFacets: createCatalogFacetsHandler(options.listFacets),
    countFacets: createCatalogCountFacetsHandler(options.countFacets),
    walk: createCatalogWalkHandler(options.walk),
    listIssues: withCatalogCache(
      'listIssues',
      ttl,
      createCatalogIssuesHandler(options.listIssues),
    ),
    setMetadata: createCatalogMetadataHandler(options.setMetadata),
    reindex: createCatalogReindexHandler(options.reindex),
    notifyDocuments: createCatalogDocumentsHandler(options.notifyDocuments),
    deleteDocuments: createCatalogDocumentsDeleteHandler(
      options.deleteDocuments,
    ),
    deletePoints: createCatalogPointsDeleteHandler(options.deletePoints),
    rebuildMetadata: createCatalogRebuildMetadataHandler(
      options.rebuildMetadata,
    ),
    reapplyRules: createCatalogRulesReapplyHandler(options.reapplyRules),
    registerRules: createCatalogRulesRegisterHandler(options.rules),
    unregisterRules: createCatalogRulesUnregisterHandler(options.rules),
    unregisterRulesBySource: createCatalogRulesUnregisterBySourceHandler(
      options.rules,
    ),
    ...(options.vcs ? createVcsCatalogHandlers(options.vcs) : vcsOffHandlers()),
  };
}
