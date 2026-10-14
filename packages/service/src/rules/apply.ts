/**
 * @module rules/apply
 * Applies compiled inference rules to file or source attributes, producing merged metadata via schema resolution, JsonMap transforms and render/template output; collects interpolation errors.
 */

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
import type { RuleAttributes } from './attributes';
import type { CompiledRule } from './compile';
import { createJsonMapLib } from './jsonMapLib';
import { resolveMapDefinition } from './resolveMap';
import type { RuleApplicationError } from './ruleErrors';
import {
  mergeSchemas,
  resolveAndCoerce,
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
  /**
   * Interpolation failures (schema `set` resolution, `render`, `template`)
   * of matched rules, in order. Each was also logged as a warning.
   */
  errors: RuleApplicationError[];
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
  /** Optional callback to extract text from a file path (for fetchSiblings). */
  extractText?: (filePath: string) => string | undefined;
}

/** A content output of a rule: `render` (renderDoc) or `template`. */
type OutputStage = Exclude<RuleApplicationError['stage'], 'schema'>;

/** Log labels of the content output stages: `[empty output, failure]`. */
const OUTPUT_LABEL: Record<OutputStage, [string, string]> = {
  render: ['renderDoc', 'renderDoc failed'],
  template: ['Template', 'Template render failed'],
};

/**
 * Apply compiled inference rules to file attributes, returning merged metadata and optional rendered content.
 *
 * Rules are evaluated in order; later rules override earlier ones.
 * If a rule has a `map`, the JsonMap transformation is applied after `set` resolution,
 * and map output overrides set output on conflict. A failing schema, render
 * or template is logged and reported in `errors`; the rule's output for that
 * stage is skipped (a schema failure skips the rest of the rule).
 *
 * @param compiledRules - The compiled rules to evaluate.
 * @param attributes - The file or source attributes to match against.
 * @param options - Optional configuration for rule application.
 * @returns The merged metadata, optional rendered content and errors.
 */
export async function applyRules(
  compiledRules: CompiledRule[],
  attributes: RuleAttributes,
  options: ApplyRulesOptions = {},
): Promise<ApplyRulesResult> {
  const {
    namedMaps,
    logger,
    templateEngine,
    configDir,
    customMapLib,
    globalSchemas,
    extractText,
  } = options;
  const hbs = templateEngine?.hbs ?? createHandlebarsInstance();

  // JsonMap's type definitions expect a generic JsonMapLib shape with unary functions.
  // Our helper functions accept multiple args, which JsonMap supports at runtime.
  const lib = createJsonMapLib(
    configDir,
    customMapLib,
    extractText,
  ) as unknown as JsonMapLib;
  let merged: Record<string, unknown> = {};
  let renderedContent: string | null = null;
  let renderAs: string | null = null;
  const matchedRules: string[] = [];
  const errors: RuleApplicationError[] = [];
  const log: RuleLogger = logger ?? console;

  /** Record an interpolation failure; returns its message. */
  const fail = (
    rule: string,
    stage: RuleApplicationError['stage'],
    error: unknown,
  ): string => {
    const { message } = normalizeError(error);
    errors.push({ rule, stage, message });
    return message;
  };

  for (const [, { rule, validate }] of compiledRules.entries()) {
    if (!validate(attributes)) continue;
    matchedRules.push(rule.name);
    // Resolve renderAs (last-match-wins)
    if (rule.renderAs) renderAs = rule.renderAs;

    // Apply schema-based metadata extraction
    if (rule.schema && rule.schema.length > 0) {
      try {
        const mergedSchema = mergeSchemas(rule.schema, {
          globalSchemas,
          configDir,
        });
        validateSchemaCompleteness(mergedSchema, rule.name);
        validateFacetTypes(mergedSchema, rule.name);
        const schemaOutput = resolveAndCoerce(mergedSchema, attributes, hbs);
        merged = { ...merged, ...schemaOutput };
      } catch (error) {
        const message = fail(rule.name, 'schema', error);
        log.warn(
          `Schema processing failed for rule "${rule.name}": ${message}`,
        );
        continue;
      }
    }

    // Apply map transformation if present
    if (rule.map) {
      const mapDef = resolveMapDefinition(rule.map, namedMaps, configDir, log);
      if (!mapDef) continue;
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

    // renderDoc first, then the template (which wins when both render).
    const { render, template } = rule;
    const outputs: Array<[OutputStage, (() => string | null) | undefined]> = [
      ['render', render ? () => renderDoc(context, render, hbs) : undefined],
      [
        'template',
        template && templateEngine
          ? () => templateEngine.render(rule.name, context)
          : undefined,
      ],
    ];
    for (const [stage, produce] of outputs) {
      if (!produce) continue;
      const [label, failure] = OUTPUT_LABEL[stage];
      try {
        const result = produce();
        if (result?.trim()) {
          renderedContent = result;
        } else {
          log.warn(
            `${label} for rule "${rule.name}" rendered empty output. Falling back to raw content.`,
          );
        }
      } catch (error) {
        const message = fail(rule.name, stage, error);
        log.warn(
          `${failure} for rule "${rule.name}": ${message}. Falling back to raw content.`,
        );
      }
    }
  }

  return { metadata: merged, renderedContent, matchedRules, renderAs, errors };
}
