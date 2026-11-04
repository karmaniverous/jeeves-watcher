/**
 * @module catalog
 * The watcher's endpoint catalog (`WATCHER_CATALOG`): one Zod-described entry per route, from which the service's routes and validation, the OpenAPI document, the SDK client, the CLI and the plugin's tools are derived. No I/O.
 *
 * @remarks
 * Holds every route (29 entries; spec Design 3), each with its `kind`. Entry
 * names are verb-first (D77, Design 14), and each is its operation's one
 * name: catalog entry, SDK method, OpenAPI `operationId` and, through
 * `toToolName`, plugin tool name. The catalog is the only route list
 * (`WATCHER_ENDPOINTS` is gone, D41).
 */

import { defineCatalog, standardEntries } from '@karmaniverous/jeeves/catalog';
import { z } from 'zod';

import {
  documentsAcceptedResponseSchema,
  documentsDeleteRequestSchema,
  documentsDeleteResponseSchema,
  documentsEnvelopeSchema,
  documentsQuerySchema,
  documentsResultsResponseSchema,
  getConfigSchemaResponseSchema,
  issuesResponseSchema,
  listFacetsResponseSchema,
  matchConfigRequestSchema,
  matchConfigResponseSchema,
  metadataRequestSchema,
  metadataResponseSchema,
  pointsDeleteRequestSchema,
  pointsDeleteResponseSchema,
  rebuildMetadataRequestSchema,
  rebuildMetadataResponseSchema,
  reindexRequestSchema,
  reindexResponseSchema,
  renderRequestSchema,
  renderResponseSchema,
  rulesReapplyRequestSchema,
  rulesReapplyResponseSchema,
  rulesRegisterRequestSchema,
  rulesRegisterResponseSchema,
  rulesUnregisterParamsSchema,
  rulesUnregisterRequestSchema,
  rulesUnregisterResponseSchema,
  scanRequestSchema,
  scanResponseSchema,
  searchRequestSchema,
  searchResponseSchema,
  validateConfigRequestSchema,
  validateConfigResponseSchema,
  VCS_EXCLUDE_CONFIRM_THRESHOLD,
  vcsCheckExclusionQuerySchema,
  vcsCheckExclusionResponseSchema,
  vcsDiffQuerySchema,
  vcsDiffResponseSchema,
  vcsExcludeRequestSchema,
  vcsExcludeResponseSchema,
  vcsHistoryQuerySchema,
  vcsHistoryResponseSchema,
  vcsRevertRequestSchema,
  vcsRevertResponseSchema,
  vcsShowQuerySchema,
  vcsStatusResponseSchema,
  walkRequestSchema,
  walkResponseSchema,
  watcherHealthSchema,
} from './api/index.js';

/** Bearer-key auth (`api.apiKey`) required by every entry except `status`. */
const bearer = { schemes: [{ in: 'bearer' }] } as const;

/**
 * Name, method, path, description and auth of a bearer-protected entry.
 *
 * @param name - Entry name: verb-first (D77), the operation's one name.
 * @param method - HTTP method.
 * @param path - Route path.
 * @param description - What the operation does.
 */
function route<
  const N extends string,
  const M extends 'DELETE' | 'GET' | 'POST',
  const P extends string,
>(name: N, method: M, path: P, description: string) {
  return { name, method, path, description, auth: bearer } as const;
}

/**
 * Description suffix of every entry the service serves only while version
 * control is on (spec Design 3): with VCS off, the route answers the
 * not-found 404 an unregistered route sends.
 */
export const VCS_DISABLED_NOTE =
  'Answers 404 `not_found` when version control is disabled (`vcs.enabled: false`).';

/**
 * {@link route} for a version-control entry: its description ends with
 * {@link VCS_DISABLED_NOTE}.
 *
 * @param name - Entry name.
 * @param method - HTTP method.
 * @param path - Route path.
 * @param description - What the operation does.
 */
function vcsRoute<
  const N extends string,
  const M extends 'DELETE' | 'GET' | 'POST',
  const P extends string,
>(name: N, method: M, path: P, description: string) {
  return route(name, method, path, `${description} ${VCS_DISABLED_NOTE}`);
}

/** The watcher endpoint catalog. */
export const WATCHER_CATALOG = defineCatalog([
  ...standardEntries('watcher', {
    auth: { config: bearer },
    healthSchema: watcherHealthSchema,
  }),

  // Reads
  {
    ...route(
      'getConfigSchema',
      'GET',
      '/config/schema',
      'Get the JSON Schema for the configuration file.',
    ),
    response: getConfigSchemaResponseSchema,
    kind: 'read',
  },
  {
    ...route(
      'matchConfig',
      'POST',
      '/config/match',
      'Test file paths against config inference rules.',
    ),
    body: matchConfigRequestSchema,
    response: matchConfigResponseSchema,
    kind: 'read',
  },
  {
    ...route(
      'validateConfig',
      'POST',
      '/config/validate',
      'Validate a candidate config. Optionally test file paths against the config.',
    ),
    body: validateConfigRequestSchema,
    response: validateConfigResponseSchema,
    kind: 'read',
  },
  {
    ...route(
      'search',
      'POST',
      '/search',
      'Semantic search over indexed documents. Supports Qdrant filters.',
    ),
    body: searchRequestSchema,
    response: searchResponseSchema,
    kind: 'read',
  },
  {
    ...route(
      'scan',
      'POST',
      '/scan',
      'Filter-only point query without vector search. Returns metadata for points matching a Qdrant filter.',
    ),
    body: scanRequestSchema,
    response: scanResponseSchema,
    kind: 'read',
  },
  {
    ...route(
      'listFacets',
      'GET',
      '/search/facets',
      'List available search facets and their values.',
    ),
    response: listFacetsResponseSchema,
    kind: 'read',
  },
  {
    ...route(
      'render',
      'POST',
      '/render',
      'Render a document (file path, or source reference retrieved through its callback) through the template pipeline.',
    ),
    body: renderRequestSchema,
    response: renderResponseSchema,
    kind: 'read',
  },
  {
    ...route(
      'walk',
      'POST',
      '/walk',
      'Walk watched filesystem paths with glob intersection. Returns matching file paths.',
    ),
    body: walkRequestSchema,
    response: walkResponseSchema,
    kind: 'read',
  },
  {
    ...route(
      'listIssues',
      'GET',
      '/issues',
      'Get runtime processing failures. Shows the documents (file path or source reference) that failed processing and why.',
    ),
    response: issuesResponseSchema,
    kind: 'read',
  },
  {
    ...vcsRoute(
      'getVcsStatus',
      'GET',
      '/vcs/status',
      'VCS state for all roots: enabled state, tracked files, last commit, remote status, commit circuit breaker state.',
    ),
    response: vcsStatusResponseSchema,
    kind: 'read',
  },
  {
    ...vcsRoute(
      'listVcsHistory',
      'GET',
      '/vcs/history',
      'Query change history by path or glob with optional date range.',
    ),
    query: vcsHistoryQuerySchema,
    response: vcsHistoryResponseSchema,
    kind: 'read',
  },
  {
    ...vcsRoute(
      'showVcsFile',
      'GET',
      '/vcs/show',
      'Retrieve file content at a specific version. The reply is the raw file content; its content-type follows the file extension.',
    ),
    query: vcsShowQuerySchema,
    response: z.string(),
    contentType: 'text/plain',
    kind: 'read',
  },
  {
    ...vcsRoute(
      'diffVcs',
      'GET',
      '/vcs/diff',
      'Show what changed between two versions, or between a version and current. The reply is a unified diff.',
    ),
    query: vcsDiffQuerySchema,
    response: vcsDiffResponseSchema,
    contentType: 'text/plain',
    kind: 'read',
  },
  {
    ...vcsRoute(
      'checkVcsExclusion',
      'GET',
      '/vcs/check-exclusion',
      'Check whether a path is excluded from version tracking and why.',
    ),
    query: vcsCheckExclusionQuerySchema,
    response: vcsCheckExclusionResponseSchema,
    kind: 'read',
  },

  // Writes
  {
    ...route(
      'setMetadata',
      'POST',
      '/metadata',
      'Set or update metadata on a document by file path or source reference.',
    ),
    body: metadataRequestSchema,
    response: metadataResponseSchema,
    kind: 'write',
  },
  {
    ...route(
      'reindex',
      'POST',
      '/reindex',
      'Trigger a scoped reindex of watched files (scope path also accepts source references).',
    ),
    body: reindexRequestSchema,
    response: reindexResponseSchema,
    kind: 'write',
  },
  {
    ...route(
      'notifyDocuments',
      'POST',
      '/documents',
      'Notify changed source documents ({ source, rule }); queued and coalesced (202), or processed synchronously with ?wait=true. Answers 202 with accepted and rejected references, or with `wait=true` 200 with per-document results.',
    ),
    query: documentsQuerySchema,
    body: documentsEnvelopeSchema,
    response: z.union([
      documentsAcceptedResponseSchema,
      documentsResultsResponseSchema,
    ]),
    kind: 'write',
  },
  {
    ...route(
      'registerRules',
      'POST',
      '/rules/register',
      'Register external inference rules.',
    ),
    body: rulesRegisterRequestSchema,
    response: rulesRegisterResponseSchema,
    kind: 'write',
  },
  {
    ...route(
      'reapplyRules',
      'POST',
      '/rules/reapply',
      'Re-apply inference rules to existing vector points.',
    ),
    body: rulesReapplyRequestSchema,
    response: rulesReapplyResponseSchema,
    kind: 'write',
  },
  {
    ...route(
      'rebuildMetadata',
      'POST',
      '/rebuild-metadata',
      'Rebuild the enrichment store from vector point payloads (file points only).',
    ),
    body: rebuildMetadataRequestSchema,
    response: rebuildMetadataResponseSchema,
    kind: 'write',
  },

  // Destructive
  {
    ...route(
      'deleteDocuments',
      'POST',
      '/documents/delete',
      'Delete source documents by reference or by Qdrant filter (at least one condition; constrained to points carrying source and no file_path).',
    ),
    body: documentsDeleteRequestSchema,
    response: documentsDeleteResponseSchema,
    kind: 'destructive',
  },
  {
    ...route(
      'deletePoints',
      'POST',
      '/points/delete',
      'Delete points from the vector store by filter.',
    ),
    body: pointsDeleteRequestSchema,
    response: pointsDeleteResponseSchema,
    kind: 'destructive',
  },
  {
    ...route(
      'unregisterRules',
      'DELETE',
      '/rules/unregister',
      'Unregister external inference rules.',
    ),
    body: rulesUnregisterRequestSchema,
    response: rulesUnregisterResponseSchema,
    kind: 'destructive',
  },
  {
    ...route(
      'unregisterRulesBySource',
      'DELETE',
      '/rules/unregister/:source',
      'Unregister all external inference rules from a source.',
    ),
    params: rulesUnregisterParamsSchema,
    response: rulesUnregisterResponseSchema,
    kind: 'destructive',
  },
  {
    ...vcsRoute(
      'revertVcs',
      'POST',
      '/vcs/revert',
      'Restore files from a historical commit (forward-only reversion).',
    ),
    body: vcsRevertRequestSchema,
    response: vcsRevertResponseSchema,
    kind: 'destructive',
  },
  {
    // D103: it untracks files, ending their history.
    ...vcsRoute(
      'excludeVcsPath',
      'POST',
      '/vcs/exclude',
      'Exclude a path from version history (VCS-only: it stays in search) or remove the exclusion. The glob is a gitignore pattern, so brackets are a character class: escape them to name a file literally (`Report \\[draft\\].docx`). Adding a pattern also untracks the tracked files it matches, in one commit (history stops for them; the files stay on disk and in search); `remove` does not restore that history. More than ' +
        String(VCS_EXCLUDE_CONFIRM_THRESHOLD) +
        " files to untrack need `confirm: true` (else 409 `confirm_required` with `untracked`, nothing written). The route waits at most 30 s for the root's git lock, then answers 503 `not_available` with `Retry-After: 30`, nothing written. A glob outside an explicit `root` is 400; a glob under no VCS root is 404.",
    ),
    body: vcsExcludeRequestSchema,
    response: vcsExcludeResponseSchema,
    kind: 'destructive',
  },
]);

/** The watcher endpoint catalog's type. */
export type WatcherCatalog = typeof WATCHER_CATALOG;
