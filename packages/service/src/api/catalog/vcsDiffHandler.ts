/**
 * @module api/catalog/vcsDiffHandler
 * Catalog handler for `GET /vcs/diff`: diff text (`text/plain`) for a glob between commits. The query is validated by the catalog's `vcsDiff` entry schema.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';

import { resolveWatchRootsForGlob } from '../../vcs/resolveWatchRoot';
import { runGit } from '../../vcs/runGit';
import { RequestError } from '../requestError';
import type { Entry } from './catalogEntry';
import type { CatalogVcsDeps } from './vcsDeps';
import { wrapCatalogHandler } from './wrapCatalogHandler';

/**
 * Create the catalog handler for `GET /vcs/diff`.
 *
 * @param deps - VCS coordinator and logger.
 * @returns The catalog handler.
 */
export function createCatalogVcsDiffHandler(
  deps: CatalogVcsDeps,
): CatalogHandler<Entry<'vcsDiff'>> {
  return wrapCatalogHandler<Entry<'vcsDiff'>>(
    async (input) => {
      const { glob, commit, commitEnd } = input.query;

      const resolved = resolveWatchRootsForGlob(deps.coordinator, glob);
      if (resolved.length === 0) {
        throw new RequestError(
          'not_found',
          'No VCS-enabled watch root matches the given glob',
        );
      }

      const diffs: string[] = [];

      for (const { root, relativePath } of resolved) {
        const range = commitEnd ? `${commit}..${commitEnd}` : `${commit}..HEAD`;
        const args = ['diff', range, '--', relativePath || '.'];

        try {
          const { stdout } = await runGit(root, args);
          if (stdout.trim()) diffs.push(stdout);
        } catch {
          // Invalid commit or path — skip
        }
      }

      return {
        body: diffs.join('\n'),
        headers: { 'content-type': 'text/plain' },
      };
    },
    deps.logger,
    'VcsDiff',
  );
}
