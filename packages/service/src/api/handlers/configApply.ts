/**
 * @module api/handlers/configApply
 * Fastify route handler for POST /config/apply. Deep-merges a partial config
 * patch into the running config file, validates the result, writes it
 * atomically, and fires the apply callback.
 */

import {
  createConfigApplyHandler,
  type JeevesComponentDescriptor,
} from '@karmaniverous/jeeves';
import { isPlainObject } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import { publicConfig } from '../publicConfig';
import { sendInternalError, sendResult } from '../sendError';
import { wrapHandler } from './wrapHandler';

/** Dependencies for the config apply route handler. */
export interface ConfigApplyRouteDeps {
  /** Component descriptor (schema, customMerge). */
  descriptor: JeevesComponentDescriptor;
  /**
   * Path of the config file the service is running from. Empty string means
   * unknown; core then falls back to its registered/derived path.
   */
  configPath: string;
  /** Called with the validated config after it has been written. */
  onConfigApply: (config: unknown) => Promise<void>;
  /** Logger for 5xx results and unexpected errors (logged, never sent). */
  logger: pino.Logger;
}

type ConfigApplyRequest = FastifyRequest<{
  Body:
    | {
        patch?: unknown;
        /** Legacy/documented alias for `patch`. */
        config?: unknown;
        replace?: boolean;
      }
    | undefined;
}>;

/**
 * Replace the echoed `config` of a core apply result with its public
 * allow-listed view. Shared by this module's Fastify route handler and the
 * catalog `configApply` entry's handler (`api/catalog/configApplyHandler`).
 *
 * @param result - Core apply result.
 * @returns The result with a redacted `config`, when it has one.
 */
export function redactConfig(result: { status: number; body: unknown }): {
  status: number;
  body: unknown;
} {
  const { body } = result;
  if (!isPlainObject(body) || !isPlainObject(body['config'])) return result;
  return { ...result, body: { ...body, config: publicConfig(body['config']) } };
}

/**
 * Create handler for POST /config/apply.
 *
 * @remarks
 * Delegates to core `createConfigApplyHandler`, passing the service's own
 * config path so the patch is merged into the file the service actually
 * loaded (not a path derived from `configRoot`, which may be unset or
 * different in the service process). Accepts `{ patch }` (sent by the
 * plugin's `watcher_config_apply`) or `{ config }`. Success is
 * `200 { applied: true, config }`, where `config` is filtered through the
 * same allow-list as `GET /config` ({@link publicConfig}), so secrets
 * (`api`, `sources`, provider keys) are never echoed. When the file was
 * written but the apply callback (reload) failed, the body also carries
 * `warning: string` describing the failure. 4xx results get a `code` from
 * their status (`invalid_request`); a 5xx result (config file unreadable or
 * unwritable), or any unexpected error (`wrapHandler`), is logged and
 * answered with a generic `500 internal_error`, so file paths never leak.
 *
 * @param deps - Route dependencies.
 */
export function createConfigApplyRouteHandler(deps: ConfigApplyRouteDeps) {
  const apply = createConfigApplyHandler(
    { ...deps.descriptor, onConfigApply: deps.onConfigApply },
    deps.configPath || undefined,
  );

  return wrapHandler(
    async (request: ConfigApplyRequest, reply: FastifyReply) => {
      const body = request.body ?? {};
      const patch = body.patch ?? body.config ?? {};
      if (!isPlainObject(patch)) {
        return sendResult(reply, {
          status: 400,
          body: {
            error: 'Config validation failed',
            issues: [{ path: ['patch'], message: 'patch must be an object' }],
          },
        });
      }
      const result = await apply({ patch, replace: body.replace === true });
      if (result.status >= 500) {
        deps.logger.error({ result: result.body }, 'Config apply failed');
        return sendInternalError(reply);
      }
      return sendResult(reply, redactConfig(result));
    },
    deps.logger,
    'Config apply',
  );
}
