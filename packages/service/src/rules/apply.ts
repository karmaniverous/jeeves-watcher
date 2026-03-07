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

import type { SchemaEntry } from '../config/schemas';
import { loadNamespacedExports } from '../helpers/loadModule';
import { createHandlebarsInstance, type TemplateEngine } from '../templates';
import { renderDoc } from '../templates/renderDoc';
import { normalizeError } from '../util/normalizeError';
import type { FileAttributes } from './attributes';
import type { CompiledRule } from './compile';
import { createJsonMapLib } from './jsonMapLib';
import {
  mergeSchemas,
  resolveAndCoerce,
  type SchemaReference,
  validateFacetTypes,
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
  /** The renderAs value from the last matching rule that declares it, or null. */
  renderAs: string | null;
}

/**
 * Optional parameters for applyRules beyond the required compiledRules and attributes.
 */
export interface ApplyRulesOptions {
  /** Optional record of named JsonMap definitions. */
  namedMaps?: Record<string, JsonMapMap>;
  /** Optional logger for warnings (falls back to console.warn). */
  logger?: RuleLogger;
  /** Optional template engine for rendering content templates. */
  templateEngine?: TemplateEngine;
  /** Optional config directory for resolving .json map file paths. */
  configDir?: string;
  /** Optional custom JsonMap transform library. */
  customMapLib?: Record<string, (...args: unknown[]) => unknown>;
  /** Optional global schemas collection for resolving schema references. */
  globalSchemas?: Record<string, SchemaEntry>;
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
 * @param options - Optional configuration for rule application.
 * @returns The merged metadata and optional rendered content.
 */
export async function applyRules(
  compiledRules: CompiledRule[],
  attributes: FileAttributes,
  options: ApplyRulesOptions = {},
): Promise<ApplyRulesResult> {
  const {
    namedMaps,
    logger,
    templateEngine,
    configDir,
    customMapLib,
    globalSchemas,
  } = options;
  const hbs = templateEngine?.hbs ?? createHandlebarsInstance();

  // JsonMap's type definitions expect a generic JsonMapLib shape with unary functions.
  // Our helper functions accept multiple args, which JsonMap supports at runtime.
  const lib = createJsonMapLib(
    configDir,
    customMapLib,
  ) as unknown as JsonMapLib;
  let merged: Record<string, unknown> = {};
  let renderedContent: string | null = null;
  let renderAs: string | null = null;
  const matchedRules: string[] = [];
  const log: RuleLogger = logger ?? console;

  for (const [, { rule, validate }] of compiledRules.entries()) {
    if (validate(attributes)) {
      matchedRules.push(rule.name);
      // Resolve renderAs (last-match-wins)
      if (rule.renderAs) {
        renderAs = rule.renderAs;
      }

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
          validateFacetTypes(mergedSchema, rule.name);

          // Resolve and coerce metadata
          const schemaOutput = resolveAndCoerce(mergedSchema, attributes, hbs);
          merged = { ...merged, ...schemaOutput };
        } catch (error) {
          log.warn(
            `Schema processing failed for rule "${rule.name}": ${normalizeError(error).message}`,
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
                `Failed to load map file "${rule.map}": ${normalizeError(error).message}`,
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
            `JsonMap transformation failed: ${normalizeError(error).message}`,
          );
        }
      }
      // Build template context: attributes (with json spread at top) + map output
      const context: Record<string, unknown> = {
        ...(attributes.json ?? {}),
        ...attributes,
        ...merged,
      };

      // Render via renderDoc if present
      if (rule.render) {
        try {
          const result = renderDoc(context, rule.render, hbs);
          if (result && result.trim()) {
            renderedContent = result;
          } else {
            log.warn(
              `renderDoc for rule "${rule.name}" rendered empty output. Falling back to raw content.`,
            );
          }
        } catch (error) {
          log.warn(
            `renderDoc failed for rule "${rule.name}": ${normalizeError(error).message}. Falling back to raw content.`,
          );
        }
      }

      // Render template if present
      if (rule.template && templateEngine) {
        const templateKey = rule.name;

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
            `Template render failed for rule "${rule.name}": ${normalizeError(error).message}. Falling back to raw content.`,
          );
        }
      }
    }
  }

  return { metadata: merged, renderedContent, matchedRules, renderAs };
}
