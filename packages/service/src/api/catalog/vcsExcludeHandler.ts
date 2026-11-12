/**
 * @module api/catalog/vcsExcludeHandler
 * Catalog handler for `POST /vcs/exclude` (Design 5): resolves the root and anchored pattern, then adds it to the root's `.git/info/exclude` and untracks matching files, or removes it. Over the untrack threshold without `confirm` it changes nothing and answers `200 { confirmRequired: true, untracked }` (D203 (1)); a busy root lock is `503 WATCHER_NOT_AVAILABLE` with `Retry-After: 30` (D102). The body is validated by the catalog's `excludeVcsPath` entry schema.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';

import { ConfirmRequiredError, runExclude } from '../../vcs/excludePattern';
import { LegacyPatternNotFoundError } from '../../vcs/legacyGitignore';
import { ExclusionNotFound } from '../errors';
import type { Entry } from './catalogEntry';
import { resolveExcludeTarget } from './excludeTarget';
import type { CatalogVcsDeps } from './vcsDeps';
import { wrapCatalogHandler } from './wrapCatalogHandler';

/**
 * Create the catalog handler for `POST /vcs/exclude`.
 *
 * @param deps - VCS coordinator and logger.
 * @returns The catalog handler.
 */
export function createCatalogVcsExcludeHandler(
  deps: CatalogVcsDeps,
): CatalogHandler<Entry<'excludeVcsPath'>> {
  return wrapCatalogHandler<Entry<'excludeVcsPath'>>(
    async (input) => {
      const { manager, pattern, relativeGlob } = resolveExcludeTarget(
        deps.coordinator,
        input.body,
      );
      try {
        const outcome = await runExclude(
          manager,
          {
            pattern,
            relativeGlob,
            remove: input.body.remove === true,
            confirm: input.body.confirm === true,
          },
          deps.logger,
          deps.lockWaitMs,
        );
        return { body: { ok: true, ...outcome } };
      } catch (error) {
        if (error instanceof ConfirmRequiredError) {
          deps.logger.debug({ err: error }, 'VcsExclude needs confirm');
          return {
            body: { confirmRequired: true, untracked: error.untracked },
          };
        }
        if (error instanceof LegacyPatternNotFoundError) {
          throw new ExclusionNotFound();
        }
        throw error;
      }
    },
    deps.logger,
    'VcsExclude',
  );
}
