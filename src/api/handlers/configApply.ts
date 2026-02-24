/**
 * @module api/handlers/configApply
 * Fastify route handler for POST /config/apply. Validates and writes config, optionally triggering reindex.
 */

import { writeFile } from 'node:fs/promises';

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import { jeevesWatcherConfigSchema } from '../../config/schemas';
import type { JeevesWatcherConfig } from '../../config/types';
import type { ReindexTracker } from '../ReindexTracker';
import { mergeInferenceRules, type ValidationError } from './configValidate';
import { wrapHandler } from './wrapHandler';

/** Dependencies for the config apply route handler. */
export interface ConfigApplyRouteDeps {
  config: JeevesWatcherConfig;
  configPath: string;
  reindexTracker: ReindexTracker;
  logger: pino.Logger;
  triggerReindex?: (scope: 'rules' | 'full') => void;
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

      let candidateRaw: Record<string, unknown> = {
        ...(deps.config as unknown as Record<string, unknown>),
      };

      const mergedRules = mergeInferenceRules(
        candidateRaw['inferenceRules'] as Record<string, unknown>[] | undefined,
        submittedConfig['inferenceRules'] as
          | Record<string, unknown>[]
          | undefined,
      );
      candidateRaw = {
        ...candidateRaw,
        ...submittedConfig,
        inferenceRules: mergedRules,
      };

      const parseResult = jeevesWatcherConfigSchema.safeParse(candidateRaw);
      if (!parseResult.success) {
        const errors: ValidationError[] = parseResult.error.issues.map(
          (issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          }),
        );
        return await reply.status(400).send({ valid: false, errors });
      }

      await writeFile(
        deps.configPath,
        JSON.stringify(candidateRaw, null, 2),
        'utf-8',
      );

      // Determine reindex scope
      const reindexScope =
        deps.config.configWatch?.reindex === 'none'
          ? undefined
          : (deps.config.configWatch?.reindex ?? 'rules');

      if (reindexScope && deps.triggerReindex) {
        deps.triggerReindex(reindexScope);
      }

      return {
        applied: true,
        reindexTriggered: !!reindexScope,
        ...(reindexScope ? { scope: reindexScope } : {}),
      };
    },
    deps.logger,
    'Config apply',
  );
}
