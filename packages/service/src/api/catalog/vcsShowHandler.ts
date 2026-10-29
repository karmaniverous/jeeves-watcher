/**
 * @module api/catalog/vcsShowHandler
 * Catalog handler for GET /vcs/show: file content at a specific commit.
 * With no VCS coordinator (VCS disabled), answers with today's exact
 * Fastify not-found body (`notFoundBody`, spec #281 D28) instead of a
 * route the catalog never fails to match.
 */

import { extname } from 'node:path';

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';

import { resolveWatchRoot } from '../../vcs/resolveWatchRoot';
import { runGit } from '../../vcs/runGit';
import type { VcsCoordinator } from '../../vcs/VcsCoordinator';
import type { Entry } from './catalogEntry';
import { errorResult } from './errorResult';
import { notFoundBody } from './notFoundBody';

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

/** Dependencies for the catalog `vcsShow` entry's handler. */
export interface CatalogVcsShowDeps {
  /** VCS coordinator (tracked roots and git operations); absent when VCS is disabled. */
  coordinator?: VcsCoordinator;
}

/**
 * Create the catalog handler for `GET /vcs/show`.
 *
 * @param deps - The VCS coordinator, when VCS is enabled.
 * @returns The catalog handler.
 */
export function createCatalogVcsShowHandler(
  deps: CatalogVcsShowDeps,
): CatalogHandler<Entry<'vcsShow'>> {
  return async (input, request) => {
    if (!deps.coordinator) {
      return { status: 404, body: notFoundBody(request.method, request.url) };
    }

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
