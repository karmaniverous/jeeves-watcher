/**
 * @module api/catalog/vcsCheckExclusionHandler
 * Catalog handler for `GET /vcs/check-exclusion`: whether git ignores a path, with the matching rule, its file and line (D82). A git failure other than "not ignored" is a masked `500` (D82). The query is validated by the catalog's `checkVcsExclusion` entry schema.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';

import { checkIgnore } from '../../vcs/checkIgnore';
import { resolveWatchRoot } from '../../vcs/resolveWatchRoot';
import { VcsRootNotFound } from '../errors';
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
): CatalogHandler<Entry<'checkVcsExclusion'>> {
  return wrapCatalogHandler<Entry<'checkVcsExclusion'>>(
    async (input) => {
      const resolved = resolveWatchRoot(deps.coordinator, input.query.path);
      if (!resolved) {
        throw new VcsRootNotFound();
      }
      return {
        body: await checkIgnore(resolved.root, resolved.relativePath),
      };
    },
    deps.logger,
    'VcsCheckExclusion',
  );
}
