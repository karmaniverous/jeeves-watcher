/**
 * @module api/handlers/configApply
 * Fastify route handler for POST /config/apply. Validates and writes config, optionally triggering reindex.
 */

import { writeFile } from 'node:fs/promises';

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import type { ReindexScope } from '../executeReindex';
import type { ReindexTracker } from '../ReindexTracker';
import { mergeAndValidateConfig } from './mergeAndValidate';
import { wrapHandler } from './wrapHandler';

/** Dependencies for the config apply route handler. */
export interface ConfigApplyRouteDeps {
  getConfig: () => JeevesWatcherConfig;
  configPath: string;
  reindexTracker: ReindexTracker;
  logger: pino.Logger;
  triggerReindex?: (scope: ReindexScope) => void;
}

type ConfigApplyRequest = FastifyRequest<{
  Body: { config: Record<string, unknown> };
}>;

/**
 * Create handler for POST /config/apply.
 *
 * @param deps - Route dependencies.
 */
export function createConfigApplyHandler(deps: ConfigApplyRouteDeps) {
  return wrapHandler(
    async (request: ConfigApplyRequest, reply: FastifyReply) => {
      const { config: submittedConfig } = request.body;

      const config = deps.getConfig();

      const { candidateRaw, errors } = mergeAndValidateConfig(
        config,
        submittedConfig,
      );

      if (errors.length > 0) {
        return await reply.status(400).send({ valid: false, errors });
      }

      await writeFile(
        deps.configPath,
        JSON.stringify(candidateRaw, null, 2),
        'utf-8',
      );

      const reindexScope = config.configWatch?.reindex ?? 'issues';

      if (deps.triggerReindex) {
        deps.triggerReindex(reindexScope);
      }

      return {
        applied: true,
        reindexTriggered: !!deps.triggerReindex,
        scope: reindexScope,
      };
    },
    deps.logger,
    'Config apply',
  );
}
