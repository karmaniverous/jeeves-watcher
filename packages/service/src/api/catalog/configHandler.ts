/**
 * @module api/catalog/configHandler
 * `ConfigQueryHandler` source for the catalog `config` entry: the watcher's
 * merged document (globals, virtual rules, helper introspection) built by
 * `createCoreConfigQueryHandler`, with a `code` added to any error result
 * that core's generic handler didn't already give one (fitted to the
 * catalog by `standardHandlers`, `api/catalog/index`).
 */

import type { ConfigQueryHandler } from '@karmaniverous/jeeves';

import {
  type ConfigQueryRouteDeps,
  createCoreConfigQueryHandler,
} from '../handlers/configQuery';
import { codeForStatus } from '../sendError';

/** Dependencies for the catalog `config` entry's source handler. */
export type CatalogConfigDeps = Pick<
  ConfigQueryRouteDeps,
  | 'getConfig'
  | 'valuesManager'
  | 'issuesManager'
  | 'helperIntrospection'
  | 'getVirtualRules'
>;

/**
 * Build the `ConfigQueryHandler` source for `GET /config`.
 *
 * @param deps - Live config getter, values/issues managers, and optional
 *   helper introspection and virtual rules getter.
 * @returns A `ConfigQueryHandler`, ready for `standardHandlers`.
 */
export function createCatalogConfigSource(
  deps: CatalogConfigDeps,
): ConfigQueryHandler {
  const coreHandler = createCoreConfigQueryHandler(deps);

  return async (query) => {
    const result = await coreHandler(query);
    if (result.status < 400) return result;

    const body = (result.body ?? {}) as Record<string, unknown>;
    if ('code' in body) return result;

    return {
      status: result.status,
      body: { code: codeForStatus(result.status), ...body },
    };
  };
}
