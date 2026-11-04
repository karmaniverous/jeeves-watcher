/**
 * @module api/catalog/reindexHandler
 * Catalog handler for `POST /reindex`. Resolves the scope's targets once (plan), then triggers the async reindex job (issues, full, rules, path, prune) with them. The request is validated by the catalog's `reindex` entry schema.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';

import type { SourceNotifyQueue } from '../../queue/SourceNotifyQueue';
import {
  executeReindex,
  prepareReindex,
  reindexDepsFrom,
  type ReindexDepsSource,
} from '../executeReindex';
import { reindexSources } from '../handlers/reindexSources';
import type { ReindexTracker } from '../ReindexTracker';
import { reindexConcurrency } from '../reindexWork';
import { apiErrorBody, NOT_AVAILABLE } from '../sendError';
import type { Entry } from './catalogEntry';
import { sourcesNotAvailableResult } from './errorResult';
import { catalogErrorFromThrown } from './wrapCatalogHandler';

/**
 * Dependencies for the catalog `reindex` entry's handler: the long-lived
 * reindex deps ({@link ReindexDepsSource}) with a required tracker and a
 * notify queue that can also enqueue (scope `path` with `source` references
 * enqueues; scopes `full` / `rules` / `issues` process source documents
 * through it).
 */
export type CatalogReindexDeps = Omit<
  ReindexDepsSource,
  'reindexTracker' | 'sourceQueue'
> & {
  /** Reindex progress tracker (`GET /status`). */
  reindexTracker: ReindexTracker;
  /** Notify queue. */
  sourceQueue?: Pick<SourceNotifyQueue, 'enqueue' | 'processNow'>;
};

/**
 * Create the catalog handler for `POST /reindex`.
 *
 * Non-prune scopes resolve their files and source documents once: the
 * resulting plan is returned (`dry_run`, or `started` with the plan) and the
 * live run reuses the same targets. An invalid path target is a 4xx
 * (`path_not_watched`, `not_found`, `invalid_request`); `source` on an
 * instance without source support (no notify queue, or a processor adapted
 * by `withoutSourceSupport`) is `503 not_available`.
 *
 * Scope `path` with `source` references only enqueues them on the notify
 * queue (`reindexSources`): it is not tracked by `GET /status` and sends no
 * completion callback, as for `POST /documents`. Every other run is tracked
 * and reports to the callback.
 *
 * @param deps - Reindex dependencies.
 * @returns The catalog handler.
 */
export function createCatalogReindexHandler(
  deps: CatalogReindexDeps,
): CatalogHandler<Entry<'reindex'>> {
  return async (input) => {
    try {
      const body = input.body;
      const scope = body.scope ?? 'issues';
      const dryRun = body.dryRun ?? false;

      // Scope 'path' with source references (exactly one of path | source).
      if (body.source !== undefined) {
        const { processor, sourceQueue: queue } = deps;
        if (!queue) return sourcesNotAvailableResult();
        const ops = processor.sourceOperations();
        const refs = [body.source].flat();
        const concurrency = reindexConcurrency(deps.getConfig());
        return {
          status: 200,
          body: await reindexSources({ ops, queue, concurrency }, refs, dryRun),
        };
      }

      // The one documented status exception (core API_ERROR_STATUS): a prune
      // without a vector store keeps its 0.19 status 400.
      if (scope === 'prune' && !deps.vectorStore) {
        return {
          status: 400,
          body: apiErrorBody('not_available', NOT_AVAILABLE, {
            message: 'Prune scope requires vectorStore to be configured.',
          }),
        };
      }

      // Explicit requests cover source documents (Decision 16.11).
      const reindexDeps = reindexDepsFrom(deps, true);

      // Pass path for 'path' and 'rules' scopes
      const pathParam =
        scope === 'path' || scope === 'rules' ? body.path : undefined;

      if (scope === 'prune') {
        if (dryRun) {
          const result = await executeReindex(reindexDeps, {
            scope: 'prune',
            path: pathParam,
            dryRun: true,
          });
          return {
            status: 200,
            body: { status: 'dry_run', scope, plan: result.plan },
          };
        }
        // Live prune: fire and forget without pre-computing plan (avoids double-scrolling the collection).
        void executeReindex(reindexDeps, { scope: 'prune', path: pathParam });
        return { status: 200, body: { status: 'started', scope: 'prune' } };
      }

      // Non-prune scopes: resolve the targets once; the run reuses them.
      const prepared = await prepareReindex(reindexDeps, scope, pathParam);
      if (dryRun) {
        return {
          status: 200,
          body: { status: 'dry_run', scope, plan: prepared.plan },
        };
      }

      void executeReindex(reindexDeps, { scope, path: pathParam, prepared });

      return {
        status: 200,
        body: { status: 'started', scope, plan: prepared.plan },
      };
    } catch (error) {
      return catalogErrorFromThrown(error, deps.logger, 'Reindex request');
    }
  };
}
