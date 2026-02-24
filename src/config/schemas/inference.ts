/**
 * @module config/schemas/inference
 * Inference rule and schema configuration schemas.
 */

import { jsonMapMapSchema } from '@karmaniverous/jsonmap';
import { z } from 'zod';

/**
 * A JSON Schema property definition with optional custom keywords.
 * Supports standard JSON Schema keywords plus custom `set` and `uiHint`.
 */
export const propertySchemaSchema = z.record(z.string(), z.unknown());

/** A JSON Schema property definition. */
export type PropertySchema = z.infer<typeof propertySchemaSchema>;

/**
 * A schema object: properties with JSON Schema definitions.
 */
export const schemaObjectSchema = z.object({
  type: z
    .literal('object')
    .optional()
    .describe('JSON Schema type (always "object" for schema definitions).'),
  properties: z
    .record(z.string(), propertySchemaSchema)
    .optional()
    .describe('Map of property names to JSON Schema property definitions.'),
});

/** A schema object containing typed property definitions. */
export interface SchemaObject {
  /** JSON Schema type (always "object" for schema definitions). */
  type?: 'object';
  /** Map of property names to JSON Schema property definitions. */
  properties?: Record<string, PropertySchema>;
}

/**
 * Global schema entry: inline object or file path.
 */
export const schemaEntrySchema = z.union([
  schemaObjectSchema,
  z.string().describe('File path to a JSON schema file.'),
]);

/** Global schema entry. */
export type SchemaEntry = z.infer<typeof schemaEntrySchema>;

/**
 * Schema reference: either a named schema reference (string) or an inline schema object.
 */
export const schemaReferenceSchema = z.union([
  z.string().describe('Named reference to a global schema.'),
  schemaObjectSchema,
]);

/** Schema reference. */
export type SchemaReference = z.infer<typeof schemaReferenceSchema>;

/**
 * An inference rule that enriches document metadata.
 */
export const inferenceRuleSchema = z.object({
  /** Unique name for this inference rule. */
  name: z
    .string()
    .min(1)
    .describe('Unique name identifying this inference rule.'),
  /** Human-readable description of what this rule does. */
  description: z
    .string()
    .min(1)
    .describe('Human-readable description of what this rule does.'),
  /** JSON Schema object to match against document metadata. */
  match: z
    .record(z.string(), z.unknown())
    .describe('JSON Schema object to match against file attributes.'),
  /** Array of schema references to merge (named refs and/or inline objects). */
  schema: z
    .array(schemaReferenceSchema)
    .optional()
    .describe(
      'Array of schema references (named schema refs or inline objects) merged left-to-right.',
    ),
  /** JsonMap transformation (inline or reference to named map). */
  map: z
    .union([jsonMapMapSchema, z.string()])
    .optional()
    .describe(
      'JsonMap transformation (inline definition, named map reference, or .json file path).',
    ),
  /** Handlebars template (inline string, named ref, or .hbs/.handlebars file path). */
  template: z
    .string()
    .optional()
    .describe(
      'Handlebars content template (inline string, named ref, or .hbs/.handlebars file path).',
    ),
});

/** An inference rule: JSON Schema match condition, schema array, and optional JsonMap transformation. */
export type InferenceRule = z.infer<typeof inferenceRuleSchema>;
