/**
 * @module api/handlers/configReindex
 * Fastify route handler for POST /reindex. Triggers an async reindex job scoped to issues, full, rules, path, or prune processing.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import type { GitignoreFilter } from '../../gitignore';
import type { IssuesManager } from '../../issues';
import type { DocumentProcessorInterface } from '../../processor';
import type { ValuesManager } from '../../values';
import type { VectorStoreClient } from '../../vectorStore';
import {
  executeReindex,
  type ReindexScope,
  VALID_REINDEX_SCOPES,
} from '../executeReindex';
import type { ReindexTracker } from '../ReindexTracker';
import { wrapHandler } from './wrapHandler';

/** Dependencies for the reindex route handler. */
export interface ConfigReindexRouteDeps {
  config: JeevesWatcherConfig;
  processor: DocumentProcessorInterface;
  logger: pino.Logger;
  reindexTracker: ReindexTracker;
  valuesManager?: ValuesManager;
  issuesManager?: IssuesManager;
  gitignoreFilter?: GitignoreFilter;
  vectorStore?: VectorStoreClient;
}

type ConfigReindexRequest = FastifyRequest<{
  Body: { scope?: string; path?: string | string[]; dryRun?: boolean };
}>;

/**
 * Create handler for POST /reindex.
 *
 * @param deps - Route dependencies.
 */
export function createConfigReindexHandler(deps: ConfigReindexRouteDeps) {
  return wrapHandler(
    async (request: ConfigReindexRequest, reply: FastifyReply) => {
      const scope = request.body.scope ?? 'issues';
      const dryRun = request.body.dryRun ?? false;

      if (!VALID_REINDEX_SCOPES.includes(scope as ReindexScope)) {
        return await reply.status(400).send({
          error: 'Invalid scope',
          message: `Scope must be one of: ${VALID_REINDEX_SCOPES.join(', ')}. Got: "${scope}"`,
        });
      }

      const validScope = scope as ReindexScope;

      if (validScope === 'path') {
        const { path } = request.body;
        if (!path || (Array.isArray(path) && path.length === 0)) {
          return await reply.status(400).send({
            error: 'Missing path',
            message: 'The "path" field is required when scope is "path".',
          });
        }
      }

      if (validScope === 'prune' && !deps.vectorStore) {
        return await reply.status(400).send({
          error: 'Not available',
          message: 'Prune scope requires vectorStore to be configured.',
        });
      }

      const reindexDeps = {
        config: deps.config,
        processor: deps.processor,
        logger: deps.logger,
        reindexTracker: deps.reindexTracker,
        valuesManager: deps.valuesManager,
        issuesManager: deps.issuesManager,
        gitignoreFilter: deps.gitignoreFilter,
        vectorStore: deps.vectorStore,
      };

      // Pass path for 'path' and 'rules' scopes
      const pathParam =
        validScope === 'path' || validScope === 'rules'
          ? request.body.path
          : undefined;

      if (dryRun) {
        // Dry run: compute plan synchronously and return
        const result = await executeReindex(
          reindexDeps,
          validScope,
          pathParam,
          true,
        );
        return await reply.status(200).send({
          status: 'dry_run',
          scope,
          plan: result.plan,
        });
      }

      // Fire and forget — plan is computed inside but we need it for the response.
      // For non-prune scopes, compute plan first then execute async.
      const planResult = await executeReindex(
        reindexDeps,
        validScope,
        pathParam,
        true, // get plan only
      );

      // Now fire actual reindex async
      void executeReindex(reindexDeps, validScope, pathParam, false);

      return await reply
        .status(200)
        .send({ status: 'started', scope, plan: planResult.plan });
    },
    deps.logger,
    'Reindex request',
  );
}
