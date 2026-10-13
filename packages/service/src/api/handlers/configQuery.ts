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
import type { ValuesManager } from '../../values';
import { buildMergedDocument } from '../mergedDocument';
import { sendResult } from '../sendError';
import { wrapHandler } from './wrapHandler';

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
 * Invalid JSONPath expressions are client errors and return
 * `400 invalid_request`; any other failure (building the merged document)
 * is logged and answered with a generic `500 internal_error`, like every
 * other route (`wrapHandler`).
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

  return wrapHandler(
    async (request: ConfigQueryRequest, reply: FastifyReply) => {
      const { path } = request.query;
      const result = await coreHandler({ path });
      if (result.status >= 400) return sendResult(reply, result);
      return result.body;
    },
    deps.logger,
    'Config query',
  );
}
