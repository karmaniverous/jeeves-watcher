/**
 * @module api/catalog/vcsCheckExclusionHandler
 * Catalog handler for `GET /vcs/check-exclusion`: the gitignore status of a path. The query is validated by the catalog's `vcsCheckExclusion` entry schema.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';

import { resolveWatchRoot } from '../../vcs/resolveWatchRoot';
import { runGit } from '../../vcs/runGit';
import { RequestError } from '../requestError';
import type { Entry } from './catalogEntry';
import type { CatalogVcsDeps } from './vcsDeps';
import { wrapCatalogHandler } from './wrapCatalogHandler';

/**
 * Create the catalog handler for `GET /vcs/check-exclusion`.
 *
 * @param deps - VCS coordinator and logger.
 * @returns The catalog handler.
 */
export function createCatalogVcsCheckExclusionHandler(
  deps: CatalogVcsDeps,
): CatalogHandler<Entry<'vcsCheckExclusion'>> {
  return wrapCatalogHandler<Entry<'vcsCheckExclusion'>>(
    async (input) => {
      const { path } = input.query;

      const resolved = resolveWatchRoot(deps.coordinator, path);
      if (!resolved) {
        throw new RequestError(
          'not_found',
          'Path does not match any VCS-enabled watch root',
        );
      }

      try {
        const { stdout } = await runGit(resolved.root, [
          'check-ignore',
          '-v',
          resolved.relativePath,
        ]);

        // Output format: <source>:<linenum>:<pattern>\t<pathname>
        const trimmed = stdout.trim();
        const match = /^(.+):(\d+):(.+)\t/.exec(trimmed);

        if (match) {
          return {
            body: { excluded: true, rule: match[3].trim(), source: match[1] },
          };
        }

        return { body: { excluded: true } };
      } catch {
        // Exit code 1 means the path is NOT ignored
        return { body: { excluded: false } };
      }
    },
    deps.logger,
    'VcsCheckExclusion',
  );
}
