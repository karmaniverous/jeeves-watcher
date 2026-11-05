/**
 * @module api/facets
 * Zod schemas for the facet endpoints: `GET /search/facets` (definitions, optionally scoped by `rules`) and `POST /search/facets/counts` (per-field value counts or ranges for a filter; spec Design 12). No I/O.
 */

import { z } from 'zod';

import { qdrantFilterSchema } from './common.js';

/** Most fields one `POST /search/facets/counts` request may name. */
export const COUNT_FACETS_MAX_FIELDS = 20;

/** Values per counted field when `limit` is omitted. */
export const COUNT_FACETS_DEFAULT_LIMIT = 100;

/** Largest `limit` of `POST /search/facets/counts`. */
export const COUNT_FACETS_MAX_LIMIT = 1000;

/** Query for `GET /search/facets`. */
export const listFacetsQuerySchema = z.object({
  /** Comma-separated rule names that scope the list. */
  rules: z
    .string()
    .optional()
    .describe(
      'Comma-separated rule names (configured or registered at runtime): only fields those rules declare, with values recorded for their documents. Unknown names answer 400. Without it, every configured rule.',
    ),
});

/** Query for `GET /search/facets`. */
export type ListFacetsQuery = z.infer<typeof listFacetsQuerySchema>;

/** Response body for `GET /search/facets`: the facetable fields and their values. */
export const listFacetsResponseSchema = z.object({
  facets: z.array(
    z.object({
      field: z.string(),
      type: z.string(),
      uiHint: z.string(),
      values: z.array(z.unknown()),
      rules: z.array(z.string()),
    }),
  ),
});

/** Response body for `GET /search/facets`. */
export type ListFacetsResponse = z.infer<typeof listFacetsResponseSchema>;

const FIELDS_MESSAGE = `fields must name 1 to ${String(COUNT_FACETS_MAX_FIELDS)} fields`;
const LIMIT_MESSAGE = `limit must be between 1 and ${String(COUNT_FACETS_MAX_LIMIT)}`;

/**
 * Request body for `POST /search/facets/counts`. Unknown keys are rejected,
 * so a misspelt option fails with `400` instead of being ignored.
 */
export const countFacetsRequestSchema = z.strictObject({
  /** Qdrant filter scoping the counts (e.g. a tenant condition). */
  filter: qdrantFilterSchema
    .optional()
    .describe(
      'Qdrant filter scoping the counts, as for search (e.g. a tenant condition).',
    ),
  /** Rule names: only documents of at least one of them are counted. */
  rules: z
    .array(z.string().min(1, 'rule names must be non-empty'))
    .min(1, 'rules must name at least one rule')
    .optional()
    .describe(
      'Rule names (configured or registered at runtime): only documents that matched at least one of them are counted, each once. Unknown names answer 400.',
    ),
  /** Fields to count (each needs a payload index). */
  fields: z
    .array(z.string().min(1, 'field names must be non-empty'), {
      error: FIELDS_MESSAGE,
    })
    .min(1, FIELDS_MESSAGE)
    .max(COUNT_FACETS_MAX_FIELDS, FIELDS_MESSAGE)
    .describe(
      `Payload fields to count (1 to ${String(COUNT_FACETS_MAX_FIELDS)}). Each needs a payload index: keyword, integer or bool for value counts; integer, float or datetime for a range.`,
    ),
  /** Most values returned per counted field. */
  limit: z
    .number({ error: LIMIT_MESSAGE })
    .int('limit must be an integer')
    .min(1, LIMIT_MESSAGE)
    .max(COUNT_FACETS_MAX_LIMIT, LIMIT_MESSAGE)
    .optional()
    .describe(
      `Most values per counted field, highest counts first (default ${String(COUNT_FACETS_DEFAULT_LIMIT)}, max ${String(COUNT_FACETS_MAX_LIMIT)}).`,
    ),
});

/** Request body for `POST /search/facets/counts`. */
export type CountFacetsRequest = z.infer<typeof countFacetsRequestSchema>;

/** One counted value: how many documents hold it. */
export const facetValueCountSchema = z.object({
  /** The payload value. */
  value: z.union([z.string(), z.number(), z.boolean()]),
  /** Documents (not chunks) holding the value. */
  count: z.number().int().nonnegative(),
});

/** One counted value. */
export type FacetValueCount = z.infer<typeof facetValueCountSchema>;

/** A bound of a range: a number, a date string, or null when nothing matched. */
const rangeBoundSchema = z.union([z.number(), z.string(), z.null()]);

/** Range of a numeric or date field over the matching documents. */
export const facetRangeSchema = z.object({
  /** Smallest value, or null when no matching document holds the field. */
  min: rangeBoundSchema,
  /** Largest value, or null when no matching document holds the field. */
  max: rangeBoundSchema,
});

/** Range of a numeric or date field. */
export type FacetRange = z.infer<typeof facetRangeSchema>;

/** Response body for `POST /search/facets/counts`. */
export const countFacetsResponseSchema = z.object({
  /** Per field: value counts (highest first), or a range. */
  counts: z
    .record(
      z.string(),
      z.union([z.array(facetValueCountSchema), facetRangeSchema]),
    )
    .describe(
      'Per requested field: value counts (documents, highest first), or { min, max } for a numeric or date field.',
    ),
});

/** Response body for `POST /search/facets/counts`. */
export type CountFacetsResponse = z.infer<typeof countFacetsResponseSchema>;
