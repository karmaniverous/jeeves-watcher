/**
 * @module api/handlers/configReindex
 * Fastify route handler for POST /reindex. Resolves the scope's targets once (plan), then triggers the async reindex job (issues, full, rules, path, prune) with them.
 */

import { reindexRequestSchema } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import type { GitignoreFilter } from '../../gitignore';
import type { IssuesManager } from '../../issues';
import type { DocumentProcessorInterface } from '../../processor';
import { hasSourceOperations } from '../../processor/SourceOperations';
import type { PausableQueue } from '../../queue';
import type { SourceNotifyQueue } from '../../queue/SourceNotifyQueue';
import type { ValuesManager } from '../../values';
import type { VectorStoreClient } from '../../vectorStore';
import { executeReindex, prepareReindex } from '../executeReindex';
import type { ReindexTracker } from '../ReindexTracker';
import {
  NOT_AVAILABLE,
  sendErrorWithStatus,
  sendSourcesNotAvailable,
} from '../sendError';
import { parseBody } from './parseBody';
import { reindexSources } from './reindexSources';
import { wrapHandler } from './wrapHandler';

/** Dependencies for the reindex route handler. */
export interface ConfigReindexRouteDeps {
  /** Live config getter. */
  getConfig: () => JeevesWatcherConfig;
  /** Document processor. */
  processor: DocumentProcessorInterface;
  /** Logger. */
  logger: pino.Logger;
  /** Reindex progress tracker (`GET /status`). */
  reindexTracker: ReindexTracker;
  /** Values index (cleared by scope `full`). */
  valuesManager?: ValuesManager;
  /** Issues store (scope `issues`). */
  issuesManager?: IssuesManager;
  /** Gitignore filter for path targets. */
  gitignoreFilter?: GitignoreFilter;
  /** Vector store (prune; source discovery). */
  vectorStore?: VectorStoreClient;
  /** File queue (paused during prune). */
  queue?: PausableQueue;
  /**
   * Notify queue: scope `path` with `source` references enqueues; scopes
   * `full` / `rules` / `issues` process source documents through it.
   */
  sourceQueue?: Pick<SourceNotifyQueue, 'enqueue' | 'processNow'>;
}

type ConfigReindexRequest = FastifyRequest<{ Body: unknown }>;

/**
 * Create handler for POST /reindex.
 *
 * Non-prune scopes resolve their files and source documents once: the
 * resulting plan is returned (`dry_run`, or `started` with the plan) and the
 * live run reuses the same targets. An invalid path target is a 4xx
 * (`path_not_watched`, `not_found`, `invalid_request`); `source` on an
 * instance without source support is `503 not_available`.
 *
 * @param deps - Route dependencies.
 * @returns Fastify route handler.
 */
export function createConfigReindexHandler(deps: ConfigReindexRouteDeps) {
  return wrapHandler(
    async (request: ConfigReindexRequest, reply: FastifyReply) => {
      const body = parseBody(reindexRequestSchema, request.body, reply);
      if (!body) return;

      const scope = body.scope ?? 'issues';
      const dryRun = body.dryRun ?? false;

      // Scope 'path' with source references (exactly one of path | source).
      if (body.source !== undefined) {
        const { processor, sourceQueue: queue } = deps;
        if (!queue || !hasSourceOperations(processor)) {
          return sendSourcesNotAvailable(reply);
        }
        const ops = processor.sourceOperations();
        const refs = [body.source].flat();
        const concurrency = deps.getConfig().reindex?.concurrency;
        return reindexSources({ ops, queue, concurrency }, refs, dryRun);
      }

      // The one documented status exception (core API_ERROR_STATUS): a prune
      // without a vector store keeps its 0.19 status 400.
      if (scope === 'prune' && !deps.vectorStore) {
        return sendErrorWithStatus(reply, 400, 'not_available', NOT_AVAILABLE, {
          message: 'Prune scope requires vectorStore to be configured.',
        });
      }

      const reindexDeps = {
        config: deps.getConfig(),
        processor: deps.processor,
        logger: deps.logger,
        reindexTracker: deps.reindexTracker,
        valuesManager: deps.valuesManager,
        issuesManager: deps.issuesManager,
        gitignoreFilter: deps.gitignoreFilter,
        vectorStore: deps.vectorStore,
        queue: deps.queue,
        sourceQueue: deps.sourceQueue,
        // Explicit requests cover source documents (Decision 16.11).
        includeSources: true,
      };

      // Pass path for 'path' and 'rules' scopes
      const pathParam =
        scope === 'path' || scope === 'rules' ? body.path : undefined;

      if (scope === 'prune') {
        if (dryRun) {
          const result = await executeReindex(
            reindexDeps,
            'prune',
            pathParam,
            true,
          );
          return await reply
            .status(200)
            .send({ status: 'dry_run', scope, plan: result.plan });
        }
        // Live prune: fire and forget without pre-computing plan (avoids double-scrolling the collection).
        void executeReindex(reindexDeps, 'prune', pathParam, false);
        return await reply
          .status(200)
          .send({ status: 'started', scope: 'prune' });
      }

      // Non-prune scopes: resolve the targets once; the run reuses them.
      const prepared = await prepareReindex(reindexDeps, scope, pathParam);
      if (dryRun) {
        return await reply
          .status(200)
          .send({ status: 'dry_run', scope, plan: prepared.plan });
      }

      void executeReindex(reindexDeps, scope, pathParam, false, prepared);

      return await reply
        .status(200)
        .send({ status: 'started', scope, plan: prepared.plan });
    },
    deps.logger,
    'Reindex request',
  );
}
