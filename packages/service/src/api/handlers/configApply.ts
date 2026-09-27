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
import type { FastifyReply, FastifyRequest } from 'fastify';

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
 * Check whether a value is a plain object (not null, not an array).
 *
 * @param value - Value to check.
 * @returns True for plain objects.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Create handler for POST /config/apply.
 *
 * @remarks
 * Delegates to core `createConfigApplyHandler`, passing the service's own
 * config path so the patch is merged into the file the service actually
 * loaded (not a path derived from `configRoot`, which may be unset or
 * different in the service process). Accepts `{ patch }` (sent by the
 * plugin's `watcher_config_apply`) or `{ config }`.
 *
 * @param deps - Route dependencies.
 */
export function createConfigApplyRouteHandler(deps: ConfigApplyRouteDeps) {
  const apply = createConfigApplyHandler(
    { ...deps.descriptor, onConfigApply: deps.onConfigApply },
    deps.configPath || undefined,
  );

  return async (request: ConfigApplyRequest, reply: FastifyReply) => {
    const body = request.body ?? {};
    const patch = body.patch ?? body.config ?? {};
    if (!isPlainObject(patch)) {
      return reply.status(400).send({
        error: 'Config validation failed',
        issues: [{ path: ['patch'], message: 'patch must be an object' }],
      });
    }
    const result = await apply({ patch, replace: body.replace === true });
    return reply.status(result.status).send(result.body);
  };
}
