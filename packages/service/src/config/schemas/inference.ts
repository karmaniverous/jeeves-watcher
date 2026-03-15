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
const propertySchemaSchema = z.record(z.string(), z.unknown());

/**
 * A schema object: properties with JSON Schema definitions.
 */
const schemaObjectSchema = z.object({
  type: z
    .literal('object')
    .optional()
    .describe('JSON Schema type (always "object" for schema definitions).'),
  properties: z
    .record(z.string(), propertySchemaSchema)
    .optional()
    .describe('Map of property names to JSON Schema property definitions.'),
});

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
const schemaReferenceSchema = z.union([
  z.string().describe('Named reference to a global schema.'),
  schemaObjectSchema,
]);

/** Render body section. */
export const renderBodySectionSchema = z.object({
  /** Key path in the template context to render. */
  path: z.string().min(1).describe('Key path in template context to render.'),
  /** Markdown heading level for this section (1-6). */
  heading: z.number().min(1).max(6).describe('Markdown heading level (1-6).'),
  /** Override heading text (default: titlecased path). */
  label: z.string().optional().describe('Override heading text.'),
  /** Name of a registered Handlebars helper used as a format handler. */
  format: z
    .string()
    .optional()
    .describe(
      'Name of a registered Handlebars helper used as a format handler.',
    ),
  /** Additional args passed to the format helper. */
  formatArgs: z
    .array(z.unknown())
    .optional()
    .describe('Additional args passed to the format helper.'),
  /** If true, the value at path is treated as an array and iterated. */
  each: z
    .boolean()
    .optional()
    .describe(
      'If true, the value at path is treated as an array and iterated.',
    ),
  /** Handlebars template string for per-item heading text (used when each=true). */
  headingTemplate: z
    .string()
    .optional()
    .describe(
      'Handlebars template string for per-item heading text (used when each=true).',
    ),
  /** Key path within each item to use as renderable content (used when each=true). */
  contentPath: z
    .string()
    .optional()
    .describe(
      'Key path within each item to use as renderable content (used when each=true).',
    ),
  /** Key path within each item to sort by (used when each=true). */
  sort: z
    .string()
    .optional()
    .describe('Key path within each item to sort by (used when each=true).'),
});

/** Render config: YAML frontmatter + ordered body sections. */
export const renderConfigSchema = z.object({
  /** Keys or glob patterns to extract from context and include as YAML frontmatter. */
  frontmatter: z
    .array(z.string().min(1))
    .describe(
      'Keys or glob patterns to include as YAML frontmatter. ' +
        'Supports picomatch globs (e.g. "*") and "!"-prefixed exclusion patterns (e.g. "!_*"). ' +
        'Explicit names preserve declaration order; glob-matched keys are sorted alphabetically.',
    ),
  /** Ordered markdown body sections. */
  body: z
    .array(renderBodySectionSchema)
    .describe('Ordered markdown body sections.'),
});

export type RenderConfig = z.infer<typeof renderConfigSchema>;
export type RenderBodySection = z.infer<typeof renderBodySectionSchema>;

/**
 * An inference rule that enriches document metadata.
 */
export const inferenceRuleSchema = z
  .object({
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
    /** Declarative structured renderer configuration (mutually exclusive with template). */
    render: renderConfigSchema
      .optional()
      .describe(
        'Declarative render configuration for frontmatter + structured Markdown output (mutually exclusive with template).',
      ),
    /** Output file extension override (e.g. "md", "html", "txt"). Requires template or render. */
    renderAs: z
      .string()
      .regex(
        /^[a-z0-9]{1,10}$/,
        'renderAs must be 1-10 lowercase alphanumeric characters',
      )
      .optional()
      .describe(
        'Output file extension override (without dot). Requires template or render.',
      ),
  })
  .superRefine((val, ctx) => {
    if (val.render && val.template) {
      ctx.addIssue({
        code: 'custom',
        path: ['render'],
        message: 'render is mutually exclusive with template',
      });
    }
    if (val.renderAs && !val.template && !val.render) {
      ctx.addIssue({
        code: 'custom',
        path: ['renderAs'],
        message: 'renderAs requires template or render',
      });
    }
  });

/** An inference rule: JSON Schema match condition, schema array, and optional JsonMap transformation. */
export type InferenceRule = z.infer<typeof inferenceRuleSchema>;
