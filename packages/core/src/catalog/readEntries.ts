/**
 * @module catalog/readEntries
 * The watcher catalog's `read` entries, in catalog order (spec Design 3 kinds). No I/O.
 */

import { z } from 'zod';

import {
  countFacetsRequestSchema,
  countFacetsResponseSchema,
  getConfigSchemaResponseSchema,
  issuesResponseSchema,
  listFacetsQuerySchema,
  listFacetsResponseSchema,
  matchConfigRequestSchema,
  matchConfigResponseSchema,
  renderRequestSchema,
  renderResponseSchema,
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
  vcsHistoryQuerySchema,
  vcsHistoryResponseSchema,
  vcsShowQuerySchema,
  vcsStatusResponseSchema,
  walkRequestSchema,
  walkResponseSchema,
} from '../api/index.js';
import { route, vcsRoute } from './routes.js';

/** The `read` entries. */
export const READ_ENTRIES = [
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
      'List available search facets and their values: every field a rule schema gives a uiHint or enum, with its declared or recorded values. With `rules`, only the fields and values of those rules.',
    ),
    query: listFacetsQuerySchema,
    response: listFacetsResponseSchema,
    kind: 'read',
  },
  {
    ...route(
      'countFacets',
      'POST',
      '/search/facets/counts',
      'Count the values of payload fields over the documents matching a filter (each document once, not each chunk), or give { min, max } for a numeric or date field. `rules` keeps only documents of those rules. Each field needs a payload index (else 400). Fields are counted 4 at a time within a 10 s budget; past it the route answers 503 `not_available` naming the fields not counted. It also answers 503 until the `chunk_index` system index is ready, and with `rules` until `matched_rules` is.',
    ),
    body: countFacetsRequestSchema,
    response: countFacetsResponseSchema,
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
] as const;
