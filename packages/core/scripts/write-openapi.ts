/**
 * @module scripts/write-openapi
 * Writes watcher-core's `openapi.json` from `WATCHER_CATALOG`. Run with `npm run openapi` after changing the catalog (the drift test fails until you do); release-it runs it after each version bump. The build never writes it.
 */

import { writeOpenApiDocument } from '@karmaniverous/jeeves/openapi';

import { WATCHER_CATALOG } from '../src/catalog';
import { OPENAPI_FILE, openApiInfo } from './openapiInfo';

writeOpenApiDocument(WATCHER_CATALOG, openApiInfo(), OPENAPI_FILE);
console.log(`Wrote ${OPENAPI_FILE}`);
