/**
 * @module config/sourceKeyWarnings
 * Finds unknown keys under `sources.<name>` in a raw (unparsed) config, e.g. a misspelt or unsupported `batchUrl`, which the schema would silently drop. Pure.
 */

import { sourceConfigSchema } from '@karmaniverous/jeeves-watcher-core';

import type { ConfigWarning } from '../rules/reservedFieldWarnings';

/** Keys a source entry may carry. */
const KNOWN_SOURCE_KEYS = new Set(Object.keys(sourceConfigSchema.shape));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Find keys under `sources.<name>` that the source schema does not define.
 * Validation strips them, so without this warning a setting such as
 * `batchUrl` would be ignored without notice.
 *
 * @param rawConfig - The config as written (before schema parsing).
 * @returns One warning per unknown key, in config order.
 */
export function findUnknownSourceKeys(rawConfig: unknown): ConfigWarning[] {
  if (!isRecord(rawConfig) || !isRecord(rawConfig.sources)) return [];
  const warnings: ConfigWarning[] = [];
  for (const [name, source] of Object.entries(rawConfig.sources)) {
    if (!isRecord(source)) continue;
    for (const key of Object.keys(source)) {
      if (KNOWN_SOURCE_KEYS.has(key)) continue;
      warnings.push({
        path: `sources.${name}.${key}`,
        message: `Unknown source setting "${key}" is ignored (supported: ${[...KNOWN_SOURCE_KEYS].join(', ')}).`,
      });
    }
  }
  return warnings;
}
