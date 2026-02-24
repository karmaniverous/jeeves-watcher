/**
 * @module api/handlers/configQuery
 * Fastify route handler for POST /config/query. Evaluates JSONPath against the merged virtual document.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { JSONPath } from 'jsonpath-plus';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import type { IssuesManager } from '../../issues';
import { normalizeError } from '../../util/normalizeError';
import type { ValuesManager } from '../../values';
import { buildMergedDocument, resolveReferences } from '../mergedDocument';

/** Dependencies for the config query route handler. */
export interface ConfigQueryRouteDeps {
  config: JeevesWatcherConfig;
  valuesManager: ValuesManager;
  issuesManager: IssuesManager;
  logger: pino.Logger;
}

type ConfigQueryRequest = FastifyRequest<{
  Body: { path: string; resolve?: ('files' | 'globals')[] };
}>;

/**
 * Create handler for POST /config/query.
 *
 * @param deps - Route dependencies.
 */
export function createConfigQueryHandler(deps: ConfigQueryRouteDeps) {
  return async (request: ConfigQueryRequest, reply: FastifyReply) => {
    try {
      const { path, resolve } = request.body;

      let doc = buildMergedDocument({
        config: deps.config,
        valuesManager: deps.valuesManager,
        issuesManager: deps.issuesManager,
      });

      if (resolve && resolve.length > 0) {
        doc = resolveReferences(doc, resolve);
      }

      const result: unknown[] = JSONPath({ path, json: doc });
      return { result, count: result.length };
    } catch (error) {
      const err = normalizeError(error);
      deps.logger.error({ err }, 'Config query failed');
      return reply.status(400).send({ error: err.message || 'Query failed' });
    }
  };
}
