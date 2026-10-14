/**
 * @module api/query
 * Zod request/response schemas for the read endpoints POST /search and POST /scan. No I/O.
 */

import { z } from 'zod';

import {
  FILTER_REQUIRED_MESSAGE,
  qdrantFilter,
  qdrantFilterSchema,
} from './common.js';

/** Results `POST /search` returns when `limit` is omitted. */
export const SEARCH_DEFAULT_LIMIT = 10;

/** Page size of `POST /scan` when `limit` is omitted. */
export const SCAN_DEFAULT_LIMIT = 100;

/** Largest `POST /scan` page size. */
export const SCAN_MAX_LIMIT = 1000;

/**
 * Request body for `POST /search`. Unknown keys are rejected, so an
 * unsupported option (e.g. `collapse`) fails with `400` instead of being
 * silently ignored.
 */
export const searchRequestSchema = z.strictObject({
  /** Natural-language query text to embed. */
  query: z.string().min(1, 'query must be a non-empty string'),
  /** Maximum results to return. Default: {@link SEARCH_DEFAULT_LIMIT}. */
  limit: z.number().int().positive().optional(),
  /** Number of results to skip (pagination). */
  offset: z.number().int().nonnegative().optional(),
  /** Optional Qdrant filter. */
  filter: qdrantFilterSchema.optional(),
});

/** Request body for `POST /search`. */
export type SearchRequest = z.infer<typeof searchRequestSchema>;

/** A single search hit. */
export const searchResultSchema = z.object({
  /** Point ID. */
  id: z.string(),
  /** Similarity (or fused) score. */
  score: z.number(),
  /** Point payload (system fields plus rule metadata). */
  payload: z.record(z.string(), z.unknown()),
});

/** A single search hit. */
export type SearchResult = z.infer<typeof searchResultSchema>;

/** Response body for `POST /search`: hits ordered by score. */
export const searchResponseSchema = z.array(searchResultSchema);

/** Response body for `POST /search`. */
export type SearchResponse = z.infer<typeof searchResponseSchema>;

const SCAN_LIMIT_MESSAGE = `limit must be between 1 and ${String(SCAN_MAX_LIMIT)}`;

/** Request body for `POST /scan`. */
export const scanRequestSchema = z.object({
  /** Qdrant filter (required). */
  filter: qdrantFilter(FILTER_REQUIRED_MESSAGE),
  /** Page size (1 to {@link SCAN_MAX_LIMIT}). Default: {@link SCAN_DEFAULT_LIMIT}. */
  limit: z
    .number({ error: SCAN_LIMIT_MESSAGE })
    .int('limit must be an integer')
    .min(1, SCAN_LIMIT_MESSAGE)
    .max(SCAN_MAX_LIMIT, SCAN_LIMIT_MESSAGE)
    .optional(),
  /** Opaque cursor from a previous page. */
  cursor: z.union([z.string(), z.number()]).optional(),
  /** Payload fields to return (projection). */
  fields: z.array(z.string()).optional(),
  /** Return only `{ count }`. */
  countOnly: z.boolean().optional(),
});

/** Request body for `POST /scan`. */
export type ScanRequest = z.infer<typeof scanRequestSchema>;

/** A scrolled point (one entry of the `POST /scan` `points` page). */
export const scanPointSchema = z.object({
  /** Point ID. */
  id: z.string(),
  /** Point payload (projected when `fields` is given). */
  payload: z.record(z.string(), z.unknown()),
});

/** A scrolled point. */
export type ScanPoint = z.infer<typeof scanPointSchema>;

/** Response body for `POST /scan`: a page of points, or a count when `countOnly`. */
export const scanResponseSchema = z.union([
  z.object({
    /** Matched points. */
    points: z.array(scanPointSchema),
    /** Cursor for the next page, or null when exhausted. */
    cursor: z.union([z.string(), z.number(), z.null()]),
  }),
  z.object({
    /** Number of matching points. */
    count: z.number().int().nonnegative(),
  }),
]);

/** Response body for `POST /scan`. */
export type ScanResponse = z.infer<typeof scanResponseSchema>;
