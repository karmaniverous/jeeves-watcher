/**
 * @module catalog
 * The watcher's endpoint catalog (`WATCHER_CATALOG`): one Zod-described entry per route, from which the service's routes and validation, the OpenAPI document, the typed client and the plugin's tools are derived. No I/O.
 *
 * @remarks
 * Holds every route (29 entries; spec Design 3), each with its `kind`.
 * Entry names are still the 0.20.0 names, so `WATCHER_ENDPOINTS` agrees with
 * the catalog on name, method and path (D23); the verb-first renames (D77,
 * Design 14) land with the client and plugin renames.
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
import { type EndpointName, getEndpoint } from './endpoints.js';

/** Bearer-key auth (`api.apiKey`) required by every entry except `status`. */
const bearer = { schemes: [{ in: 'bearer' }] } as const;

/** Name, method, path, description and auth of an entry, from its endpoint. */
function route<N extends EndpointName>(name: N) {
  const { method, path, description } = getEndpoint(name);
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
 * {@link VCS_DISABLED_NOTE}, after any extra text.
 *
 * @param name - Endpoint name.
 * @param extra - Text appended to the endpoint description first.
 */
function vcsRoute<N extends EndpointName>(name: N, extra?: string) {
  const base = route(name);
  const text = extra ? `${base.description} ${extra}` : base.description;
  return { ...base, description: `${text} ${VCS_DISABLED_NOTE}` } as const;
}

/** The watcher endpoint catalog. */
export const WATCHER_CATALOG = defineCatalog([
  ...standardEntries('watcher', {
    auth: { config: bearer },
    healthSchema: watcherHealthSchema,
  }),

  // Reads
  {
    ...route('configSchema'),
    response: getConfigSchemaResponseSchema,
    kind: 'read',
  },
  {
    ...route('configMatch'),
    body: matchConfigRequestSchema,
    response: matchConfigResponseSchema,
    kind: 'read',
  },
  {
    ...route('configValidate'),
    body: validateConfigRequestSchema,
    response: validateConfigResponseSchema,
    kind: 'read',
  },
  {
    ...route('search'),
    body: searchRequestSchema,
    response: searchResponseSchema,
    kind: 'read',
  },
  {
    ...route('scan'),
    body: scanRequestSchema,
    response: scanResponseSchema,
    kind: 'read',
  },
  {
    ...route('searchFacets'),
    response: listFacetsResponseSchema,
    kind: 'read',
  },
  {
    ...route('render'),
    body: renderRequestSchema,
    response: renderResponseSchema,
    kind: 'read',
  },
  {
    ...route('walk'),
    body: walkRequestSchema,
    response: walkResponseSchema,
    kind: 'read',
  },
  {
    ...route('issues'),
    response: issuesResponseSchema,
    kind: 'read',
  },
  {
    ...vcsRoute('vcsStatus'),
    response: vcsStatusResponseSchema,
    kind: 'read',
  },
  {
    ...vcsRoute('vcsHistory'),
    query: vcsHistoryQuerySchema,
    response: vcsHistoryResponseSchema,
    kind: 'read',
  },
  {
    ...vcsRoute(
      'vcsShow',
      'The reply is the raw file content; its content-type follows the file extension.',
    ),
    query: vcsShowQuerySchema,
    response: z.string(),
    contentType: 'text/plain',
    kind: 'read',
  },
  {
    ...vcsRoute('vcsDiff', 'The reply is a unified diff.'),
    query: vcsDiffQuerySchema,
    response: vcsDiffResponseSchema,
    contentType: 'text/plain',
    kind: 'read',
  },
  {
    ...vcsRoute('vcsCheckExclusion'),
    query: vcsCheckExclusionQuerySchema,
    response: vcsCheckExclusionResponseSchema,
    kind: 'read',
  },

  // Writes
  {
    ...route('metadata'),
    body: metadataRequestSchema,
    response: metadataResponseSchema,
    kind: 'write',
  },
  {
    ...route('reindex'),
    body: reindexRequestSchema,
    response: reindexResponseSchema,
    kind: 'write',
  },
  {
    ...route('documents'),
    description: `${getEndpoint('documents').description} Answers 202 with accepted and rejected references, or with \`wait=true\` 200 with per-document results.`,
    query: documentsQuerySchema,
    body: documentsEnvelopeSchema,
    response: z.union([
      documentsAcceptedResponseSchema,
      documentsResultsResponseSchema,
    ]),
    kind: 'write',
  },
  {
    ...route('rulesRegister'),
    body: rulesRegisterRequestSchema,
    response: rulesRegisterResponseSchema,
    kind: 'write',
  },
  {
    ...route('rulesReapply'),
    body: rulesReapplyRequestSchema,
    response: rulesReapplyResponseSchema,
    kind: 'write',
  },
  {
    ...route('rebuildMetadata'),
    body: rebuildMetadataRequestSchema,
    response: rebuildMetadataResponseSchema,
    kind: 'write',
  },

  // Destructive
  {
    ...route('documentsDelete'),
    body: documentsDeleteRequestSchema,
    response: documentsDeleteResponseSchema,
    kind: 'destructive',
  },
  {
    ...route('pointsDelete'),
    body: pointsDeleteRequestSchema,
    response: pointsDeleteResponseSchema,
    kind: 'destructive',
  },
  {
    ...route('rulesUnregister'),
    body: rulesUnregisterRequestSchema,
    response: rulesUnregisterResponseSchema,
    kind: 'destructive',
  },
  {
    ...route('rulesUnregisterBySource'),
    params: rulesUnregisterParamsSchema,
    response: rulesUnregisterResponseSchema,
    kind: 'destructive',
  },
  {
    ...vcsRoute('vcsRevert'),
    body: vcsRevertRequestSchema,
    response: vcsRevertResponseSchema,
    kind: 'destructive',
  },
  {
    // D103: it untracks files, ending their history.
    ...vcsRoute('vcsExclude'),
    body: vcsExcludeRequestSchema,
    response: vcsExcludeResponseSchema,
    kind: 'destructive',
  },
]);

/** The watcher endpoint catalog's type. */
export type WatcherCatalog = typeof WATCHER_CATALOG;
