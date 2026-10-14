/**
 * @module rules/resolveMap
 * Resolves a rule's `map` reference (inline JsonMap, named map, or `.json` file relative to the config directory) to a JsonMap definition. Reads the map file synchronously.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { JsonMapMap } from '@karmaniverous/jsonmap';

import type { InferenceRule } from '../config/types';
import { normalizeError } from '../util/normalizeError';

/** What applyRules skips when a rule's map cannot be resolved. */
const SKIPPED = "Skipping the rule's map, render and template.";

/** Logger for map resolution warnings. */
interface MapLogger {
  /** Log a warning. */
  warn(msg: string): void;
}

/**
 * Resolve a rule's `map` to a JsonMap definition. Failures are logged and
 * yield `undefined` (the rule's map transformation is skipped).
 *
 * @param map - The rule's `map` (inline definition, named map or `.json` path).
 * @param namedMaps - Named JsonMap definitions.
 * @param configDir - Directory `.json` paths are resolved against.
 * @param log - Logger for warnings.
 * @returns The definition, or `undefined` when it cannot be resolved.
 */
export function resolveMapDefinition(
  map: NonNullable<InferenceRule['map']>,
  namedMaps: Record<string, JsonMapMap> | undefined,
  configDir: string | undefined,
  log: MapLogger,
): JsonMapMap | undefined {
  if (typeof map !== 'string') return map;
  if (map.endsWith('.json') && configDir) {
    try {
      const raw = readFileSync(resolve(configDir, map), 'utf-8');
      return JSON.parse(raw) as JsonMapMap;
    } catch (error) {
      log.warn(
        `Failed to load map file "${map}": ${normalizeError(error).message}. ${SKIPPED}`,
      );
      return undefined;
    }
  }
  const named = namedMaps?.[map];
  if (!named) {
    log.warn(`Map reference "${map}" not found in named maps. ${SKIPPED}`);
  }
  return named;
}
