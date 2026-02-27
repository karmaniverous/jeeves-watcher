/**
 * @module rules/schemaMerge
 * Merges schema references into a resolved property schema with set extraction and type coercion.
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import type Handlebars from 'handlebars';

import type { FileAttributes } from './attributes';
import { coerceType } from './coerceType';
import { resolveTemplateVars } from './templates';

/**
 * A property definition in a resolved schema.
 */
export interface ResolvedProperty {
  /** JSON Schema type. */
  type?: string;
  /** Property description. */
  description?: string;
  /** UI hint for rendering. */
  uiHint?: string;
  /** Enum values. */
  enum?: unknown[];
  /** Items schema for array types. */
  items?: Record<string, unknown>;
  /** Set template for value extraction (string for scalars, array for array-typed properties). */
  set?: string | unknown[];
  /** Additional JSON Schema keywords. */
  [key: string]: unknown;
}

/**
 * A resolved schema after merging all references.
 */
export interface ResolvedSchema {
  type?: 'object';
  properties: Record<string, ResolvedProperty>;
}

/**
 * Schema entry: inline object or file path string.
 */
export type SchemaEntry =
  | { type?: 'object'; properties?: Record<string, unknown> }
  | string;

/**
 * Schema reference: named string or inline object.
 */
export type SchemaReference =
  | string
  | { type?: 'object'; properties?: Record<string, unknown> };

/**
 * Options for schema merging.
 */
export interface SchemaMergeOptions {
  /** Global schemas collection for resolving named references. */
  globalSchemas?: Record<string, SchemaEntry>;
  /** Config directory for resolving file paths. */
  configDir?: string;
}

/**
 * Resolve a schema entry (inline object or file path) to a schema object.
 *
 * @param entry - Schema entry (inline object or file path).
 * @param configDir - Config directory for resolving file paths.
 * @returns The resolved schema object.
 */
function resolveSchemaEntry(
  entry: SchemaEntry,
  configDir?: string,
): { type?: 'object'; properties?: Record<string, unknown> } {
  if (typeof entry === 'string') {
    // File path - load and parse JSON
    const resolvedPath = configDir ? resolvePath(configDir, entry) : entry;
    const raw = readFileSync(resolvedPath, 'utf-8');
    return JSON.parse(raw) as {
      type?: 'object';
      properties?: Record<string, unknown>;
    };
  }
  return entry;
}

/**
 * Merge an array of schema references into a single resolved schema.
 * Later entries override earlier ones at the property level.
 *
 * @param refs - Array of schema references (named strings or inline objects).
 * @param options - Options for schema merging.
 * @returns The merged resolved schema.
 */
export function mergeSchemas(
  refs: SchemaReference[],
  options: SchemaMergeOptions = {},
): ResolvedSchema {
  const { globalSchemas = {}, configDir } = options;
  const merged: ResolvedSchema = { properties: {} };

  for (const ref of refs) {
    let schema: { type?: 'object'; properties?: Record<string, unknown> };

    if (typeof ref === 'string') {
      // Named reference - resolve from global schemas
      const globalEntry = globalSchemas[ref];
      if (!globalEntry) {
        throw new Error(
          `Schema reference "${ref}" not found in global schemas`,
        );
      }
      schema = resolveSchemaEntry(globalEntry, configDir);
    } else {
      // Inline object
      schema = ref;
    }

    // Merge properties at the property level
    if (schema.properties) {
      for (const [propName, propDef] of Object.entries(schema.properties)) {
        const existing = merged.properties[propName] as
          | ResolvedProperty
          | undefined;
        if (existing) {
          const incoming = propDef as ResolvedProperty;
          // For array-typed properties, concatenate set values instead of replacing
          if (
            existing.type === 'array' &&
            Array.isArray(existing.set) &&
            incoming.set !== undefined
          ) {
            const existingSet = existing.set;
            const incomingSet = Array.isArray(incoming.set)
              ? incoming.set
              : [incoming.set];
            merged.properties[propName] = {
              ...existing,
              ...(propDef as Record<string, unknown>),
              set: existingSet.concat(incomingSet),
            };
          } else {
            merged.properties[propName] = {
              ...existing,
              ...(propDef as Record<string, unknown>),
            };
          }
        } else {
          merged.properties[propName] = propDef as ResolvedProperty;
        }
      }
    }
  }

  return merged;
}

/**
 * Extract set values from a resolved schema.
 * Returns a flat object of property names to set templates.
 *
 * @param schema - Resolved schema.
 * @returns Set templates keyed by property name.
 */
export function extractSetValues(
  schema: ResolvedSchema,
): Record<string, string | unknown[]> {
  const setValues: Record<string, string | unknown[]> = {};

  for (const [propName, propDef] of Object.entries(schema.properties)) {
    const setVal = propDef.set;
    if (setVal !== undefined) {
      setValues[propName] = setVal;
    }
  }

  return setValues;
}

export { coerceType } from './coerceType';

/**
 * Resolve set templates against file attributes and coerce to declared types.
 *
 * @param schema - Resolved schema with type information.
 * @param attributes - File attributes for template variable resolution.
 * @returns Resolved and type-coerced metadata.
 */
export function resolveAndCoerce(
  schema: ResolvedSchema,
  attributes: FileAttributes,
  hbs: typeof Handlebars,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [propName, propDef] of Object.entries(schema.properties)) {
    const setTemplate = propDef.set;
    if (setTemplate === undefined) continue;

    // For array-typed properties with array set values, resolve each element
    if (Array.isArray(setTemplate)) {
      const resolved = setTemplate.map((item) =>
        resolveTemplateVars(item, attributes, hbs),
      );
      result[propName] = resolved;
      continue;
    }

    // Resolve template
    const rawValue = resolveTemplateVars(setTemplate, attributes, hbs);

    // Coerce to declared type - returns undefined on failure
    const coerced = coerceType(rawValue, propDef.type) as
      | string
      | number
      | boolean
      | object
      | undefined;

    // Only include if coercion succeeded
    if (coerced !== undefined) {
      result[propName] = coerced;
    }
  }

  return result;
}

/**
 * Validate that all properties in a schema have a declared type.
 * Throws if any property lacks a type.
 *
 * @param schema - Resolved schema to validate.
 * @param ruleName - Name of the rule (for error messages).
 */
export function validateSchemaCompleteness(
  schema: ResolvedSchema,
  ruleName: string,
): void {
  for (const [propName, propDef] of Object.entries(schema.properties)) {
    if (!propDef.type) {
      throw new Error(
        `Property "${propName}" in rule "${ruleName}" has no declared type. Every property must have a type.`,
      );
    }
  }
}
