/**
 * @module api/catalog/vcsExcludeHandler
 * Catalog handler for `POST /vcs/exclude` (Design 5): resolves the root and anchored pattern, then adds it to the root's `.git/info/exclude` and untracks matching files, or removes it. Answers 409 `confirm_required` and 503 `not_available` with `Retry-After: 30` (D102, D103). The body is validated by the catalog's `excludeVcsPath` entry schema.
 *
 * Written directly rather than through `wrapCatalogHandler`, because its
 * 503 carries a header and its 409 an extra field.
 */

import type {
  CatalogHandler,
  HandlerResult,
} from '@karmaniverous/jeeves/fastify';
import type pino from 'pino';

import { ConfirmRequiredError, runExclude } from '../../vcs/excludePattern';
import { LegacyPatternNotFoundError } from '../../vcs/legacyGitignore';
import {
  LockWaitTimeoutError,
  ROUTE_LOCK_WAIT_MS,
} from '../../vcs/RootGitLock';
import { NOT_AVAILABLE } from '../sendError';
import type { Entry } from './catalogEntry';
import { errorResult } from './errorResult';
import { resolveExcludeTarget } from './excludeTarget';
import type { CatalogVcsDeps } from './vcsDeps';
import { catalogErrorFromThrown } from './wrapCatalogHandler';

/** Seconds a busy-lock `503` asks the client to wait: the route's own wait (D102). */
const RETRY_AFTER_S = String(ROUTE_LOCK_WAIT_MS / 1000);

/** `POST /vcs/exclude`'s handler result. */
type ExcludeResult = HandlerResult<Entry<'excludeVcsPath'>>;

/**
 * The error result for a thrown error: the exclude-specific errors, else
 * the generic catalog mapping.
 */
function excludeErrorResult(
  error: unknown,
  logger: pino.Logger,
): ExcludeResult {
  if (error instanceof ConfirmRequiredError) {
    logger.debug({ err: error }, 'VcsExclude needs confirm');
    return errorResult('confirm_required', error.message, {
      untracked: error.untracked,
    });
  }
  if (error instanceof LockWaitTimeoutError) {
    logger.warn({ err: error }, 'VcsExclude gave up waiting for RootGitLock');
    return {
      ...errorResult('not_available', NOT_AVAILABLE, {
        message: `Version control is busy on this root; retry after ${RETRY_AFTER_S} s`,
      }),
      headers: { 'Retry-After': RETRY_AFTER_S },
    };
  }
  if (error instanceof LegacyPatternNotFoundError) {
    return errorResult('not_found', error.message);
  }
  return catalogErrorFromThrown(error, logger, 'VcsExclude');
}

/**
 * Create the catalog handler for `POST /vcs/exclude`.
 *
 * @param deps - VCS coordinator and logger.
 * @returns The catalog handler.
 */
export function createCatalogVcsExcludeHandler(
  deps: CatalogVcsDeps,
): CatalogHandler<Entry<'excludeVcsPath'>> {
  return async (input) => {
    try {
      const { manager, pattern, relativeGlob } = resolveExcludeTarget(
        deps.coordinator,
        input.body,
      );
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
      return { status: 200, body: { ok: true, ...outcome } };
    } catch (error) {
      return excludeErrorResult(error, deps.logger);
    }
  };
}
