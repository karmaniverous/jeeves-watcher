/**
 * @module api/catalog/configApplyHandler
 * `ConfigApplyHandler` source for the catalog `configApply` entry: core's
 * generic config-apply handler, with the echoed config redacted
 * (`publicConfig`, same allow-list as `GET /config`), a `code` added to any
 * error result, and a 5xx logged and answered with a generic
 * `internal_error` (file paths never leak). The catalog's `patch`/`replace`
 * body is already validated by the entry's schema; the `{ config }` alias
 * and absent-patch default are normalized before validation by a
 * `preValidation` hook (`api/registerCatalog`, D27), so this handler only
 * ever sees `{ patch, replace? }`.
 */

import {
  type ConfigApplyHandler,
  createConfigApplyHandler,
  type JeevesComponentDescriptor,
} from '@karmaniverous/jeeves';
import { isPlainObject } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import { publicConfig } from '../publicConfig';
import { INTERNAL_ERROR_MESSAGE } from '../sendError';
import { withErrorCode } from './errorResult';

/** Dependencies for the catalog `configApply` entry's source handler. */
export interface CatalogConfigApplyDeps {
  /** Component descriptor (schema, customMerge). */
  descriptor: JeevesComponentDescriptor;
  /**
   * Path of the config file the service is running from. Empty string means
   * unknown; core then falls back to its registered/derived path.
   */
  configPath: string;
  /** Called with the validated config after it has been written. */
  onConfigApply: (config: unknown) => Promise<void>;
  /** Logger for 5xx results (logged, never sent). */
  logger: pino.Logger;
}

/**
 * Replace the echoed `config` of a core apply result with its public
 * allow-listed view. Pure.
 *
 * @param result - Core apply result.
 * @returns The result with a redacted `config`, when it has one.
 */
function redactConfig(result: { status: number; body: unknown }): {
  status: number;
  body: unknown;
} {
  const { body } = result;
  if (!isPlainObject(body) || !isPlainObject(body['config'])) return result;
  return { ...result, body: { ...body, config: publicConfig(body['config']) } };
}

/**
 * Build the `ConfigApplyHandler` source for `POST /config/apply`.
 *
 * @param deps - Descriptor, config path, apply callback and logger.
 * @returns A `ConfigApplyHandler`, ready for `standardHandlers`.
 */
export function createCatalogConfigApplySource(
  deps: CatalogConfigApplyDeps,
): ConfigApplyHandler {
  const apply = createConfigApplyHandler(
    { ...deps.descriptor, onConfigApply: deps.onConfigApply },
    deps.configPath || undefined,
  );

  return async (request) => {
    const result = await apply(request);

    if (result.status >= 500) {
      deps.logger.error({ result: result.body }, 'Config apply failed');
      return {
        status: 500,
        body: {
          code: 'internal_error',
          error: 'Internal Server Error',
          message: INTERNAL_ERROR_MESSAGE,
        },
      };
    }

    if (result.status >= 400) return withErrorCode(result);

    return redactConfig(result);
  };
}
