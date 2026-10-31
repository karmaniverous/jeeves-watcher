/**
 * @module scripts/openapiInfo
 * Location and `info` block of watcher-core's committed OpenAPI document (`openapi.json`), shared by the writer (`write-openapi.ts`) and the drift test. Reads `package.json`; no writes.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { OpenApiInfo } from '@karmaniverous/jeeves/openapi';

/** The committed document. */
export const OPENAPI_FILE = fileURLToPath(
  new URL('../openapi.json', import.meta.url),
);

/**
 * The document's `info`: title, watcher-core's current version, description.
 *
 * @returns OpenAPI `info`.
 */
export function openApiInfo(): OpenApiInfo {
  const pkg = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return {
    title: 'jeeves-watcher',
    version: pkg.version,
    description:
      'HTTP API of the jeeves-watcher service: the routes in its endpoint catalog (WATCHER_CATALOG). Every route except GET /status requires the API key as a bearer token when api.apiKey is configured.',
  };
}
