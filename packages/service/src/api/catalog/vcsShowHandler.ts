/**
 * @module api/catalog/vcsShowHandler
 * Catalog handler for GET /vcs/show: file content at a specific commit.
 * Built only while VCS is on; with VCS off, the feature gate
 * (`api/featureGates`) answers first (spec D28, D50).
 */

import { extname } from 'node:path';

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';

import { resolveWatchRoot } from '../../vcs/resolveWatchRoot';
import { runGit } from '../../vcs/runGit';
import type { Entry } from './catalogEntry';
import { errorResult } from './errorResult';
import type { CatalogVcsDeps } from './vcsDeps';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.ts': 'text/plain',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.csv': 'text/csv',
};

/**
 * Content type for a file shown from git, by extension (unknown extensions
 * are `application/octet-stream`). Pure.
 *
 * @param path - File path (only its extension is used).
 * @returns The content type.
 */
function contentTypeFor(path: string): string {
  return (
    CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
  );
}

/**
 * Create the catalog handler for `GET /vcs/show`.
 *
 * @param deps - The VCS coordinator.
 * @returns The catalog handler.
 */
export function createCatalogVcsShowHandler(
  deps: Pick<CatalogVcsDeps, 'coordinator'>,
): CatalogHandler<Entry<'showVcsFile'>> {
  return async (input) => {
    const { path, commit } = input.query;
    const resolved = resolveWatchRoot(deps.coordinator, path);
    if (!resolved) {
      return errorResult(
        'not_found',
        'Path does not match any VCS-enabled watch root',
      );
    }

    try {
      const { stdout } = await runGit(resolved.root, [
        'show',
        `${commit}:${resolved.relativePath}`,
      ]);
      return {
        status: 200,
        body: stdout,
        headers: { 'content-type': contentTypeFor(path) },
      };
    } catch {
      return errorResult('not_found', 'File not found at the specified commit');
    }
  };
}
