/**
 * @module rules/apply
 * Applies compiled inference rules to file attributes, producing merged metadata via template resolution and JsonMap transforms.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type Json,
  JsonMap,
  type JsonMapLib,
  type JsonMapMap,
} from '@karmaniverous/jsonmap';
import { get } from 'radash';

import type { SchemaEntry } from '../config/schemas';
import { loadNamespacedExports } from '../helpers/loadModule';
import { createHandlebarsInstance, type TemplateEngine } from '../templates';
import type { FileAttributes } from './attributes';
import type { CompiledRule } from './compile';
import {
  mergeSchemas,
  resolveAndCoerce,
  type SchemaReference,
  validateSchemaCompleteness,
} from './schemaMerge';

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
 * @param configDir - Optional config directory for resolving relative file paths in lookups.
 * @returns The lib object.
 */
function createJsonMapLib(
  configDir?: string,
  customLib?: Record<string, (...args: unknown[]) => unknown>,
) {
  // Cache loaded JSON files within a single applyRules invocation.
  const jsonCache = new Map<string, unknown>();

  const loadJson = (filePath: string): Record<string, unknown> => {
    const resolvedPath = configDir ? resolve(configDir, filePath) : filePath;
    if (!jsonCache.has(resolvedPath)) {
      const raw = readFileSync(resolvedPath, 'utf-8');
      jsonCache.set(resolvedPath, JSON.parse(raw) as unknown);
    }
    return jsonCache.get(resolvedPath) as Record<string, unknown>;
  };

  return {
    split: (str: string, separator: string) => str.split(separator),
    slice: <T>(arr: T[], start: number, end?: number) => arr.slice(start, end),
    join: (arr: string[], separator: string) => arr.join(separator),
    toLowerCase: (str: string) => str.toLowerCase(),
    replace: (str: string, search: string | RegExp, replacement: string) =>
      str.replace(search, replacement),
    get: (obj: unknown, path: string) => get(obj, path),

    /**
     * Load a JSON file (relative to configDir) and look up a value by key,
     * optionally drilling into a sub-path.
     *
     * @param filePath - Path to a JSON file (resolved relative to configDir).
     * @param key - Top-level key to look up.
     * @param field - Optional dot-path into the looked-up entry.
     * @returns The resolved value, or null if not found.
     */
    lookupJson: (filePath: string, key: string, field?: string) => {
      const data = loadJson(filePath);
      const entry = data[key];
      if (entry === undefined || entry === null) return null;
      if (field) return get(entry, field) ?? null;
      return entry;
    },

    /**
     * Map an array of keys through a JSON lookup file, collecting a specific
     * field from each matching entry. Non-matching keys are silently skipped.
     * Array-valued fields are flattened into the result.
     *
     * @param filePath - Path to a JSON file (resolved relative to configDir).
     * @param keys - Array of top-level keys to look up.
     * @param field - Dot-path into each looked-up entry.
     * @returns Flat array of resolved values.
     */
    mapLookup: (filePath: string, keys: unknown[], field: string) => {
      if (!Array.isArray(keys)) return [];
      const data = loadJson(filePath);
      const results: unknown[] = [];
      for (const k of keys) {
        if (typeof k !== 'string') continue;
        const entry = data[k];
        if (entry === undefined || entry === null) continue;
        const val = get(entry, field);
        if (val === undefined || val === null) continue;
        if (Array.isArray(val)) {
          for (const item of val) {
            results.push(item);
          }
        } else {
          results.push(val);
        }
      }
      return results;
    },
    ...customLib,
  };
}

/**
 * Load custom JsonMap lib functions from named helper config.
 *
 * Each module should default-export an object of functions,
 * or use named exports. Only function-valued exports are merged.
 * Exports are namespace-prefixed as `<namespace>_<exportName>`.
 *
 * @param helpers - Named helper config: Record of namespace to path/description.
 * @param configDir - Directory to resolve relative paths against.
 * @returns The merged custom lib functions with namespace prefixes.
 */
export async function loadCustomMapHelpers(
  helpers: Record<string, { path: string; description?: string }>,
  configDir: string,
): Promise<Record<string, (...args: unknown[]) => unknown>> {
  const namespaced = await loadNamespacedExports(
    helpers,
    configDir,
    (val) => typeof val === 'function',
  );
  const merged: Record<string, (...args: unknown[]) => unknown> = {};
  for (const [namespace, exports] of Object.entries(namespaced)) {
    for (const [key, val] of Object.entries(exports)) {
      merged[`${namespace}_${key}`] = val as (...args: unknown[]) => unknown;
    }
  }
  return merged;
}

/**
 * Result of applying inference rules.
 */
export interface ApplyRulesResult {
  /** Merged metadata from all matching rules. */
  metadata: Record<string, unknown>;
  /** Rendered template content from the last matching rule with a template, or null. */
  renderedContent: string | null;
  /** Names of rules that matched. */
  matchedRules: string[];
}

/**
 * Apply compiled inference rules to file attributes, returning merged metadata and optional rendered content.
 *
 * Rules are evaluated in order; later rules override earlier ones.
 * If a rule has a `map`, the JsonMap transformation is applied after `set` resolution,
 * and map output overrides set output on conflict.
 *
 * @param compiledRules - The compiled rules to evaluate.
 * @param attributes - The file attributes to match against.
 * @param namedMaps - Optional record of named JsonMap definitions.
 * @param logger - Optional logger for warnings (falls back to console.warn).
 * @param templateEngine - Optional template engine for rendering content templates.
 * @param configDir - Optional config directory for resolving .json map file paths.
 * @param globalSchemas - Optional global schemas collection for resolving schema references.
 * @returns The merged metadata and optional rendered content.
 */
export async function applyRules(
  compiledRules: CompiledRule[],
  attributes: FileAttributes,
  namedMaps?: Record<string, JsonMapMap>,
  logger?: RuleLogger,
  templateEngine?: TemplateEngine,
  configDir?: string,
  customMapLib?: Record<string, (...args: unknown[]) => unknown>,
  globalSchemas?: Record<string, SchemaEntry>,
): Promise<ApplyRulesResult> {
  const hbs = templateEngine?.hbs ?? createHandlebarsInstance();

  // JsonMap's type definitions expect a generic JsonMapLib shape with unary functions.
  // Our helper functions accept multiple args, which JsonMap supports at runtime.
  const lib = createJsonMapLib(
    configDir,
    customMapLib,
  ) as unknown as JsonMapLib;
  let merged: Record<string, unknown> = {};
  let renderedContent: string | null = null;
  const matchedRules: string[] = [];
  const log: RuleLogger = logger ?? console;

  for (const [, { rule, validate }] of compiledRules.entries()) {
    if (validate(attributes)) {
      matchedRules.push(rule.name);

      // Apply schema-based metadata extraction
      if (rule.schema && rule.schema.length > 0) {
        try {
          // Merge schemas
          const mergedSchema = mergeSchemas(rule.schema as SchemaReference[], {
            globalSchemas,
            configDir,
          });

          // Validate schema completeness
          validateSchemaCompleteness(mergedSchema, rule.name);

          // Resolve and coerce metadata
          const schemaOutput = resolveAndCoerce(
            mergedSchema,
            attributes,
            hbs,
          );
          merged = { ...merged, ...schemaOutput };
        } catch (error) {
          log.warn(
            `Schema processing failed for rule "${rule.name}": ${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }
      }

      // Apply map transformation if present
      if (rule.map) {
        let mapDef: JsonMapMap | undefined;

        // Resolve map reference
        if (typeof rule.map === 'string') {
          if (rule.map.endsWith('.json') && configDir) {
            // File path: load from .json file
            try {
              const mapPath = resolve(configDir, rule.map);
              const raw = readFileSync(mapPath, 'utf-8');
              mapDef = JSON.parse(raw) as JsonMapMap;
            } catch (error) {
              log.warn(
                `Failed to load map file "${rule.map}": ${error instanceof Error ? error.message : String(error)}`,
              );
              continue;
            }
          } else {
            mapDef = namedMaps?.[rule.map];
            if (!mapDef) {
              log.warn(
                `Map reference "${rule.map}" not found in named maps. Skipping map transformation.`,
              );
              continue;
            }
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

      // Render template if present
      if (rule.template && templateEngine) {
        const templateKey = rule.name;
        // Build template context: attributes (with json spread at top) + map output
        const context: Record<string, unknown> = {
          ...(attributes.json ?? {}),
          ...attributes,
          ...merged,
        };

        try {
          const result = templateEngine.render(templateKey, context);
          if (result && result.trim()) {
            renderedContent = result;
          } else {
            log.warn(
              `Template for rule "${rule.name}" rendered empty output. Falling back to raw content.`,
            );
          }
        } catch (error) {
          log.warn(
            `Template render failed for rule "${rule.name}": ${error instanceof Error ? error.message : String(error)}. Falling back to raw content.`,
          );
        }
      }
    }
  }

  return { metadata: merged, renderedContent, matchedRules };
}
