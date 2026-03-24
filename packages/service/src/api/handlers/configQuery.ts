/**
 * @module api/handlers/configQuery
 * Fastify route handler for GET /config. Returns the full resolved merged document,
 * optionally filtered by JSONPath via the `path` query parameter.
 *
 * Delegates JSON querying to `createConfigQueryHandler` from `@karmaniverous/jeeves` core.
 */

import { createConfigQueryHandler as coreCreateConfigQueryHandler } from '@karmaniverous/jeeves';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import type { AllHelpersIntrospection } from '../../helpers';
import type { IssuesManager } from '../../issues';
import { normalizeError } from '../../util/normalizeError';
import type { ValuesManager } from '../../values';
import { buildMergedDocument } from '../mergedDocument';

/** Dependencies for the config query route handler. */
export interface ConfigQueryRouteDeps {
  getConfig: () => JeevesWatcherConfig;
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
 * Uses `createConfigQueryHandler` from core to handle JSONPath querying.
 * Invalid JSONPath expressions are client errors and return 400.
 *
 * @param deps - Route dependencies.
 */
export function createConfigQueryHandler(deps: ConfigQueryRouteDeps) {
  const coreHandler = coreCreateConfigQueryHandler(() =>
    buildMergedDocument({
      config: deps.getConfig(),
      valuesManager: deps.valuesManager,
      issuesManager: deps.issuesManager,
      helperIntrospection: deps.helperIntrospection,
      virtualRules: deps.getVirtualRules?.(),
    }),
  );

  return async (request: ConfigQueryRequest, reply: FastifyReply) => {
    try {
      const { path } = request.query;
      const result = await coreHandler({ path });
      if (result.status >= 400) {
        return await reply.status(result.status).send(result.body);
      }
      return result.body;
    } catch (error) {
      const err = normalizeError(error);
      deps.logger.error({ err }, 'Config query failed');
      return await reply.status(400).send({
        error: err.message || 'Query failed',
      });
    }
  };
}
