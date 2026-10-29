/**
 * @module catalog
 * The watcher's endpoint catalog (`WATCHER_CATALOG`): one Zod-described entry per catalog route, from which the service's routes and validation, the OpenAPI document, the typed client and the plugin's tools are derived. No I/O.
 *
 * @remarks
 * Holds the routes moved to the catalog so far (#281): core's standard
 * `status`, `config` and `configApply`, plus `render`, `search`, `scan` and
 * the non-JSON `vcsShow`. Every other route is still described only by
 * `WATCHER_ENDPOINTS`, which stays the full route list until #281 completes;
 * the two agree on name, method and path.
 */

import { defineCatalog, standardEntries } from '@karmaniverous/jeeves/catalog';
import { z } from 'zod';

import {
  renderRequestSchema,
  renderResponseSchema,
  scanRequestSchema,
  scanResponseSchema,
  searchRequestSchema,
  searchResponseSchema,
  vcsShowQuerySchema,
  watcherHealthSchema,
} from './api/index.js';
import { getEndpoint } from './endpoints.js';

/** Bearer-key auth (`api.apiKey`) required by every entry except `status`. */
const bearer = { schemes: [{ in: 'bearer' }] } as const;

/** The watcher endpoint catalog. */
export const WATCHER_CATALOG = defineCatalog([
  ...standardEntries('watcher', {
    auth: { config: bearer },
    healthSchema: watcherHealthSchema,
  }),
  {
    name: 'render',
    method: 'POST',
    path: '/render',
    description: getEndpoint('render').description,
    body: renderRequestSchema,
    response: renderResponseSchema,
    auth: bearer,
    kind: 'read',
  },
  {
    name: 'search',
    method: 'POST',
    path: '/search',
    description: getEndpoint('search').description,
    body: searchRequestSchema,
    response: searchResponseSchema,
    auth: bearer,
    kind: 'read',
  },
  {
    name: 'scan',
    method: 'POST',
    path: '/scan',
    description: getEndpoint('scan').description,
    body: scanRequestSchema,
    response: scanResponseSchema,
    auth: bearer,
    kind: 'read',
  },
  {
    name: 'vcsShow',
    method: 'GET',
    path: '/vcs/show',
    description: `${getEndpoint('vcsShow').description} The reply is the raw file content; its content-type follows the file extension.`,
    query: vcsShowQuerySchema,
    response: z.string(),
    contentType: 'text/plain',
    auth: bearer,
    kind: 'read',
  },
]);

/** The watcher endpoint catalog's type. */
export type WatcherCatalog = typeof WATCHER_CATALOG;
