import type { Stats } from 'node:fs';
import { basename, dirname, extname } from 'node:path';

import {
  type Json,
  JsonMap,
  type JsonMapLib,
  type JsonMapMap,
} from '@karmaniverous/jsonmap';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import picomatch from 'picomatch';

import type { InferenceRule } from '../config/types';

/**
 * Attributes derived from a watched file for rule matching.
 */
export interface FileAttributes {
  /** File-level properties. */
  file: {
    /** Full file path (forward slashes). */
    path: string;
    /** Directory containing the file. */
    directory: string;
    /** File name with extension. */
    filename: string;
    /** File extension including the leading dot. */
    extension: string;
    /** File size in bytes. */
    sizeBytes: number;
    /** ISO-8601 last-modified timestamp. */
    modified: string;
  };
  /** Extracted YAML frontmatter, if any. */
  frontmatter?: Record<string, unknown>;
  /** Parsed JSON content, if any. */
  json?: Record<string, unknown>;
}

/**
 * A compiled inference rule ready for evaluation.
 */
export interface CompiledRule {
  /** The original rule definition. */
  rule: InferenceRule;
  /** The compiled ajv validate function. */
  validate: (data: unknown) => boolean;
}

/**
 * Build {@link FileAttributes} from a file path and stat info.
 *
 * @param filePath - The file path.
 * @param stats - The file stats.
 * @param extractedFrontmatter - Optional extracted frontmatter.
 * @param extractedJson - Optional parsed JSON content.
 * @returns The constructed file attributes.
 */
export function buildAttributes(
  filePath: string,
  stats: Stats,
  extractedFrontmatter?: Record<string, unknown>,
  extractedJson?: Record<string, unknown>,
): FileAttributes {
  const normalised = filePath.replace(/\\/g, '/');
  const attrs: FileAttributes = {
    file: {
      path: normalised,
      directory: dirname(normalised).replace(/\\/g, '/'),
      filename: basename(normalised),
      extension: extname(normalised),
      sizeBytes: stats.size,
      modified: stats.mtime.toISOString(),
    },
  };
  if (extractedFrontmatter) attrs.frontmatter = extractedFrontmatter;
  if (extractedJson) attrs.json = extractedJson;
  return attrs;
}

/**
 * Create an ajv instance with a custom `glob` format for picomatch glob matching.
 *
 * @returns The configured ajv instance.
 */
function createRuleAjv(): Ajv {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  ajv.addKeyword({
    keyword: 'glob',
    type: 'string',
    schemaType: 'string',
    validate: (pattern: string, data: string) =>
      picomatch.isMatch(data, pattern),
  });
  return ajv;
}

/**
 * Compile an array of inference rules into executable validators.
 *
 * @param rules - The inference rule definitions.
 * @returns An array of compiled rules.
 */
export function compileRules(rules: InferenceRule[]): CompiledRule[] {
  const ajv = createRuleAjv();
  return rules.map((rule, idx) => ({
    rule,
    validate: ajv.compile({
      $id: `rule-${String(idx)}`,
      ...rule.match,
    }) as (data: unknown) => boolean,
  }));
}

/**
 * Resolve `$\{template.vars\}` in a value against the given attributes.
 *
 * @param value - The value to resolve.
 * @param attributes - The file attributes for variable lookup.
 * @returns The resolved value.
 */
function resolveTemplateVars(
  value: unknown,
  attributes: FileAttributes,
): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{([^}]+)\}/g, (_match, varPath: string) => {
    const parts = varPath.split('.');
    let current: unknown = attributes;
    for (const part of parts) {
      if (current === null || current === undefined) return '';
      current = (current as Record<string, unknown>)[part];
    }
    if (current === null || current === undefined) return '';
    return typeof current === 'string' ? current : JSON.stringify(current);
  });
}

/**
 * Resolve all template variables in a `set` object.
 *
 * @param setObj - The key-value pairs to resolve.
 * @param attributes - The file attributes for variable lookup.
 * @returns The resolved key-value pairs.
 */
function resolveSet(
  setObj: Record<string, unknown>,
  attributes: FileAttributes,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(setObj)) {
    result[key] = resolveTemplateVars(value, attributes);
  }
  return result;
}

/**
 * Create the lib object for JsonMap transformations.
 * Provides utility functions for path manipulation.
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
    get: (obj: unknown, path: string) => {
      const parts = path.split('.');
      let current = obj;
      for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = (current as Record<string, unknown>)[part];
      }
      return current;
    },
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
 * @returns The merged metadata from all matching rules.
 */
export async function applyRules(
  compiledRules: CompiledRule[],
  attributes: FileAttributes,
  namedMaps?: Record<string, JsonMapMap>,
): Promise<Record<string, unknown>> {
  // JsonMap's type definitions expect a generic JsonMapLib shape with unary functions.
  // Our helper functions accept multiple args, which JsonMap supports at runtime.
  const lib = createJsonMapLib() as unknown as JsonMapLib;
  let merged: Record<string, unknown> = {};

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
            console.warn(
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
            console.warn(
              `JsonMap transformation did not return an object; skipping merge.`,
            );
          }
        } catch (error) {
          console.warn(
            `JsonMap transformation failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  return merged;
}
