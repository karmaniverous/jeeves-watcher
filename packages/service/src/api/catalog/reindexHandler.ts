/**
 * @module api/catalog/reindexHandler
 * Catalog handler for `POST /reindex`. Resolves the scope's targets once (plan), then triggers the async reindex job (issues, full, rules, path, prune) with them. The request is validated by the catalog's `reindex` entry schema.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';

import type { SourceNotifyQueue } from '../../queue/SourceNotifyQueue';
import { PruneNotAvailable, SourcesNotSupported } from '../errors';
import {
  executeReindex,
  prepareReindex,
  reindexDepsFrom,
  type ReindexDepsSource,
} from '../executeReindex';
import { reindexSources } from '../handlers/reindexSources';
import type { ReindexTracker } from '../ReindexTracker';
import { reindexConcurrency } from '../reindexWork';
import type { Entry } from './catalogEntry';
import { wrapCatalogHandler } from './wrapCatalogHandler';

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
 * (`WATCHER_PATH_NOT_WATCHED`, `WATCHER_NOT_FOUND`,
 * `WATCHER_INVALID_REQUEST`); `source` on an instance without source
 * support (no notify queue, or a processor adapted by
 * `withoutSourceSupport`) and `prune` without a vector store are
 * `503 WATCHER_NOT_AVAILABLE` (D203 (3)).
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
  return wrapCatalogHandler<Entry<'reindex'>>(
    async (input) => {
      const body = input.body;
      const scope = body.scope ?? 'issues';
      const dryRun = body.dryRun ?? false;

      // Scope 'path' with source references (exactly one of path | source).
      if (body.source !== undefined) {
        const { processor, sourceQueue: queue } = deps;
        if (!queue) throw new SourcesNotSupported();
        const ops = processor.sourceOperations();
        const refs = [body.source].flat();
        const concurrency = reindexConcurrency(deps.getConfig());
        return {
          body: await reindexSources({ ops, queue, concurrency }, refs, dryRun),
        };
      }

      if (scope === 'prune' && !deps.vectorStore) throw new PruneNotAvailable();

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
          return { body: { status: 'dry_run', scope, plan: result.plan } };
        }
        // Live prune: fire and forget without pre-computing plan (avoids double-scrolling the collection).
        void executeReindex(reindexDeps, { scope: 'prune', path: pathParam });
        return { body: { status: 'started', scope: 'prune' } };
      }

      // Non-prune scopes: resolve the targets once; the run reuses them.
      const prepared = await prepareReindex(reindexDeps, scope, pathParam);
      if (dryRun) {
        return { body: { status: 'dry_run', scope, plan: prepared.plan } };
      }

      void executeReindex(reindexDeps, { scope, path: pathParam, prepared });

      return { body: { status: 'started', scope, plan: prepared.plan } };
    },
    deps.logger,
    'Reindex request',
  );
}
