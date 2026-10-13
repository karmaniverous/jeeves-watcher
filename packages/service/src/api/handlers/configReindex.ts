/**
 * @module api/handlers/configReindex
 * Fastify route handler for POST /reindex. Triggers an async reindex job scoped to issues, full, rules, path, or prune processing.
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
import { executeReindex } from '../executeReindex';
import type { ReindexTracker } from '../ReindexTracker';
import {
  NOT_AVAILABLE,
  sendError,
  sendSourcesNotAvailable,
} from '../sendError';
import { parseBody } from './parseBody';
import { reindexSources } from './reindexSources';
import { wrapHandler } from './wrapHandler';

/** Dependencies for the reindex route handler. */
export interface ConfigReindexRouteDeps {
  getConfig: () => JeevesWatcherConfig;
  processor: DocumentProcessorInterface;
  logger: pino.Logger;
  reindexTracker: ReindexTracker;
  valuesManager?: ValuesManager;
  issuesManager?: IssuesManager;
  gitignoreFilter?: GitignoreFilter;
  vectorStore?: VectorStoreClient;
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
 * @param deps - Route dependencies.
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
          return sendSourcesNotAvailable(reply, 400);
        }
        const ops = processor.sourceOperations();
        const refs = [body.source].flat();
        return reindexSources({ ops, queue }, refs, dryRun);
      }

      if (scope === 'prune' && !deps.vectorStore) {
        return sendError(reply, 400, 'not_available', NOT_AVAILABLE, {
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

      if (dryRun) {
        // Dry run: compute plan synchronously and return
        const result = await executeReindex(
          reindexDeps,
          scope,
          pathParam,
          true,
        );
        return await reply.status(200).send({
          status: 'dry_run',
          scope,
          plan: result.plan,
        });
      }

      // Live prune: fire and forget without pre-computing plan (avoids double-scrolling the collection).
      if (scope === 'prune') {
        void executeReindex(reindexDeps, 'prune', pathParam, false);
        return await reply
          .status(200)
          .send({ status: 'started', scope: 'prune' });
      }

      // Non-prune scopes: compute plan first then execute async.
      const planResult = await executeReindex(
        reindexDeps,
        scope,
        pathParam,
        true,
      );

      void executeReindex(reindexDeps, scope, pathParam, false);

      return await reply
        .status(200)
        .send({ status: 'started', scope, plan: planResult.plan });
    },
    deps.logger,
    'Reindex request',
  );
}
