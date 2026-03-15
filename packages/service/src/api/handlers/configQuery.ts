/**
 * @module api/handlers/configQuery
 * Fastify route handler for GET /config. Returns the full resolved merged document,
 * optionally filtered by JSONPath via the `path` query parameter.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { JSONPath } from 'jsonpath-plus';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import type { AllHelpersIntrospection } from '../../helpers';
import type { IssuesManager } from '../../issues';
import { normalizeError } from '../../util/normalizeError';
import type { ValuesManager } from '../../values';
import { buildMergedDocument } from '../mergedDocument';

/** Dependencies for the config query route handler. */
export interface ConfigQueryRouteDeps {
  config: JeevesWatcherConfig;
  valuesManager: ValuesManager;
  issuesManager: IssuesManager;
  logger: pino.Logger;
  helperIntrospection?: AllHelpersIntrospection;
  getVirtualRules?: () => Record<string, Record<string, unknown>[]>;
}

type ConfigQueryRequest = FastifyRequest<{
  Querystring: { path?: string };
}>;

/**
 * Create handler for GET /config.
 *
 * Uses direct error handling (returns 400) rather than wrapHandler (which returns 500),
 * because invalid JSONPath expressions are client errors, not server errors.
 *
 * @param deps - Route dependencies.
 */
export function createConfigQueryHandler(deps: ConfigQueryRouteDeps) {
  return async (request: ConfigQueryRequest, reply: FastifyReply) => {
    try {
      const { path } = request.query;

      const doc = buildMergedDocument({
        config: deps.config,
        valuesManager: deps.valuesManager,
        issuesManager: deps.issuesManager,
        helperIntrospection: deps.helperIntrospection,
        virtualRules: deps.getVirtualRules?.(),
      });

      if (!path) {
        return doc;
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
