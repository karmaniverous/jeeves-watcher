/**
 * @module api/catalog/configApplyHandler
 * `ConfigApplyHandler` source for the catalog `configApply` entry: core's
 * generic config-apply handler, with the echoed config redacted
 * (`publicConfig`, same allow-list as `GET /config`). Its errors are core's
 * own (`JEEVES_CONFIG_INVALID`, `JEEVES_CONFIG_READ_FAILED`,
 * `JEEVES_CONFIG_WRITE_FAILED`; the path and OS error go to the logger only).
 * The catalog's `patch`/`replace`
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

import { publicConfig } from '../publicConfig';

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
 * @param deps - Descriptor, config path and apply callback.
 * @returns A `ConfigApplyHandler`, ready for `standardHandlers`.
 */
export function createCatalogConfigApplySource(
  deps: CatalogConfigApplyDeps,
): ConfigApplyHandler {
  const apply = createConfigApplyHandler(
    { ...deps.descriptor, onConfigApply: deps.onConfigApply },
    deps.configPath || undefined,
  );

  return async (request, logger) => redactConfig(await apply(request, logger));
}
