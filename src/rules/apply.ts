/**
 * @module rules/apply
 * Applies compiled inference rules to file attributes, producing merged metadata via template resolution and JsonMap transforms.
 */

import {
  type Json,
  JsonMap,
  type JsonMapLib,
  type JsonMapMap,
} from '@karmaniverous/jsonmap';
import { get } from 'radash';

import type { FileAttributes } from './attributes';
import type { CompiledRule } from './compile';
import { resolveSet } from './templates';

/**
 * A minimal logger interface for rule application warnings.
 */
export interface RuleLogger {
  /** Log a warning message during rule application. */
  warn(msg: string): void;
}

/**
 * Create the lib object for JsonMap transformations.
 *
 * @returns The lib object.
 */
function createJsonMapLib() {
  return {
    split: (str: string, separator: string) => str.split(separator),
    slice: <T>(arr: T[], start: number, end?: number) => arr.slice(start, end),
    join: (arr: string[], separator: string) => arr.join(separator),
    toLowerCase: (str: string) => str.toLowerCase(),
    replace: (str: string, search: string | RegExp, replacement: string) =>
      str.replace(search, replacement),
    get: (obj: unknown, path: string) => get(obj, path),
  };
}

/**
 * Apply compiled inference rules to file attributes, returning merged metadata.
 *
 * Rules are evaluated in order; later rules override earlier ones.
 * If a rule has a `map`, the JsonMap transformation is applied after `set` resolution,
 * and map output overrides set output on conflict.
 *
 * @param compiledRules - The compiled rules to evaluate.
 * @param attributes - The file attributes to match against.
 * @param namedMaps - Optional record of named JsonMap definitions.
 * @param logger - Optional logger for warnings (falls back to console.warn).
 * @returns The merged metadata from all matching rules.
 */
export async function applyRules(
  compiledRules: CompiledRule[],
  attributes: FileAttributes,
  namedMaps?: Record<string, JsonMapMap>,
  logger?: RuleLogger,
): Promise<Record<string, unknown>> {
  // JsonMap's type definitions expect a generic JsonMapLib shape with unary functions.
  // Our helper functions accept multiple args, which JsonMap supports at runtime.
  const lib = createJsonMapLib() as unknown as JsonMapLib;
  let merged: Record<string, unknown> = {};
  const log: RuleLogger = logger ?? console;

  for (const { rule, validate } of compiledRules) {
    if (validate(attributes)) {
      // Apply set resolution
      const setOutput = resolveSet(rule.set, attributes);
      merged = { ...merged, ...setOutput };

      // Apply map transformation if present
      if (rule.map) {
        let mapDef: JsonMapMap | undefined;

        // Resolve map reference
        if (typeof rule.map === 'string') {
          mapDef = namedMaps?.[rule.map];
          if (!mapDef) {
            log.warn(
              `Map reference "${rule.map}" not found in named maps. Skipping map transformation.`,
            );
            continue;
          }
        } else {
          mapDef = rule.map;
        }

        // Execute JsonMap transformation
        try {
          const jsonMap = new JsonMap(mapDef, lib);
          const mapOutput = await jsonMap.transform(
            attributes as unknown as Json,
          );
          if (
            mapOutput &&
            typeof mapOutput === 'object' &&
            !Array.isArray(mapOutput)
          ) {
            merged = { ...merged, ...(mapOutput as Record<string, unknown>) };
          } else {
            log.warn(
              `JsonMap transformation did not return an object; skipping merge.`,
            );
          }
        } catch (error) {
          log.warn(
            `JsonMap transformation failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  return merged;
}
