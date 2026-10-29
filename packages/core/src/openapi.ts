/**
 * @module openapi
 * watcher-core's committed OpenAPI 3.1 document for `WATCHER_CATALOG`, bundled as `WATCHER_OPENAPI_DOCUMENT` (the service serves it at `GET /openapi.json`). Also published as the `@karmaniverous/jeeves-watcher-core/openapi.json` sub-path for out-of-repo generators. No I/O.
 */

import document from '../openapi.json';

/**
 * The OpenAPI document generated from `WATCHER_CATALOG` (`npm run openapi`).
 *
 * @remarks
 * Typed loosely so watcher-core's declarations don't depend on OpenAPI type
 * packages.
 */
export const WATCHER_OPENAPI_DOCUMENT: Readonly<Record<string, unknown>> =
  document;
