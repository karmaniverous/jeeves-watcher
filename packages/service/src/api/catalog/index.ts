/**
 * @module api/catalog
 * Catalog handlers for every `WATCHER_CATALOG` entry: `status`, `config` and `configApply` adapted from core's standard handlers (`standardHandlers`), plus one handler per route. The `/vcs/*` handlers are built only while version control is on; otherwise each is a stub the feature gate always pre-empts (`api/featureGates`). Registered by `api/registerCatalog`.
 */

import type { CatalogHandlers } from '@karmaniverous/jeeves/fastify';
import { standardHandlers } from '@karmaniverous/jeeves/fastify';
import type { WatcherCatalog } from '@karmaniverous/jeeves-watcher-core';

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
import { notFoundBody } from './notFoundBody';
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
  /** `status` entry dependencies. */
  status: CatalogStatusDeps;
  /** `config` entry dependencies. */
  config: CatalogConfigDeps;
  /** `configApply` entry dependencies. */
  configApply: CatalogConfigApplyDeps;
  /** `configMatch` entry dependencies. */
  configMatch: CatalogConfigMatchDeps;
  /** `configValidate` entry dependencies. */
  configValidate: CatalogConfigValidateDeps;
  /** `render` entry dependencies. */
  render: CatalogRenderDeps;
  /** `search` entry dependencies. */
  search: CatalogSearchDeps;
  /** `scan` entry dependencies. */
  scan: CatalogScanDeps;
  /** `searchFacets` entry dependencies. */
  searchFacets: CatalogFacetsDeps;
  /** `walk` entry dependencies. */
  walk: CatalogWalkDeps;
  /** `issues` entry dependencies. */
  issues: CatalogIssuesDeps;
  /** `metadata` entry dependencies. */
  metadata: CatalogMetadataDeps;
  /** `reindex` entry dependencies. */
  reindex: CatalogReindexDeps;
  /** `documents` entry dependencies. */
  documents: CatalogDocumentsDeps;
  /** `documentsDelete` entry dependencies. */
  documentsDelete: CatalogDocumentsDeleteDeps;
  /** `pointsDelete` entry dependencies. */
  pointsDelete: CatalogPointsDeleteDeps;
  /** `rebuildMetadata` entry dependencies. */
  rebuildMetadata: CatalogRebuildMetadataDeps;
  /** `rulesReapply` entry dependencies. */
  rulesReapply: CatalogRulesReapplyDeps;
  /** Virtual-rule entries' dependencies (`rulesRegister`, `rulesUnregister`,
   * `rulesUnregisterBySource`). */
  rules: CatalogRuleDeps;
  /** `/vcs/*` entries' dependencies; absent while version control is off. */
  vcs?: CatalogVcsDeps;
  /** Response cache TTL for the cached entries (`status`, `config`,
   * `configSchema`, `issues`, the file-target `render`). */
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
function vcsHandlers(deps: CatalogVcsDeps): GatedHandlers {
  return {
    vcsStatus: createCatalogVcsStatusHandler(deps),
    vcsHistory: createCatalogVcsHistoryHandler(deps),
    vcsShow: createCatalogVcsShowHandler(deps),
    vcsDiff: createCatalogVcsDiffHandler(deps),
    vcsCheckExclusion: createCatalogVcsCheckExclusionHandler(deps),
    vcsRevert: createCatalogVcsRevertHandler(deps),
    vcsExclude: createCatalogVcsExcludeHandler(deps),
  };
}

/**
 * The stub of a gated entry while its feature is off: the not-found 404 an
 * unregistered route sends. The feature gate answers every such request
 * before the route runs, so the stub only keeps the handler map total.
 *
 * @returns The stub handler.
 */
function gatedOff() {
  return (_input: unknown, request: { method: string; url: string }) =>
    Promise.resolve({
      status: 404 as const,
      body: notFoundBody(request.method, request.url),
    });
}

/**
 * The `/vcs/*` stubs while version control is off.
 *
 * @returns One stub per `/vcs/*` entry.
 */
function vcsOffHandlers(): GatedHandlers {
  return {
    vcsStatus: gatedOff(),
    vcsHistory: gatedOff(),
    vcsShow: gatedOff(),
    vcsDiff: gatedOff(),
    vcsCheckExclusion: gatedOff(),
    vcsRevert: gatedOff(),
    vcsExclude: gatedOff(),
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
  const standard = standardHandlers({
    status: createCatalogStatusSource(options.status),
    config: createCatalogConfigSource(options.config),
    configApply: createCatalogConfigApplySource(options.configApply),
  });

  return {
    status: withCatalogCache('status', ttl, standard.status),
    config: withCatalogCache('config', ttl, standard.config),
    configApply: standard.configApply,
    configSchema: withCatalogCache(
      'configSchema',
      ttl,
      createCatalogConfigSchemaHandler(),
    ),
    configMatch: createCatalogConfigMatchHandler(options.configMatch),
    configValidate: createCatalogConfigValidateHandler(options.configValidate),
    // Source renders reply Cache-Control: no-cache, so they are never cached.
    render: withCatalogCache(
      'render',
      ttl,
      createCatalogRenderHandler(options.render),
    ),
    search: createCatalogSearchHandler(options.search),
    scan: createCatalogScanHandler(options.scan),
    searchFacets: createCatalogFacetsHandler(options.searchFacets),
    walk: createCatalogWalkHandler(options.walk),
    issues: withCatalogCache(
      'issues',
      ttl,
      createCatalogIssuesHandler(options.issues),
    ),
    metadata: createCatalogMetadataHandler(options.metadata),
    reindex: createCatalogReindexHandler(options.reindex),
    documents: createCatalogDocumentsHandler(options.documents),
    documentsDelete: createCatalogDocumentsDeleteHandler(
      options.documentsDelete,
    ),
    pointsDelete: createCatalogPointsDeleteHandler(options.pointsDelete),
    rebuildMetadata: createCatalogRebuildMetadataHandler(
      options.rebuildMetadata,
    ),
    rulesReapply: createCatalogRulesReapplyHandler(options.rulesReapply),
    rulesRegister: createCatalogRulesRegisterHandler(options.rules),
    rulesUnregister: createCatalogRulesUnregisterHandler(options.rules),
    rulesUnregisterBySource: createCatalogRulesUnregisterBySourceHandler(
      options.rules,
    ),
    ...(options.vcs ? vcsHandlers(options.vcs) : vcsOffHandlers()),
  };
}
