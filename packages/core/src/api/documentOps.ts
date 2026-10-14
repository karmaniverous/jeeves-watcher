/**
 * @module api/documentOps
 * Zod request/response schemas for single-document operations POST /render and POST /metadata (path or source target). No I/O.
 */

import { z } from 'zod';

import { documentTargetShape, requireExactlyOneTarget } from './common.js';

/** Request body for `POST /render`: exactly one of `path` or `source`. */
export const renderRequestSchema = z
  .object(documentTargetShape)
  .superRefine(requireExactlyOneTarget);

/** Request body for `POST /render`. */
export type RenderRequest = z.infer<typeof renderRequestSchema>;

/** Response body for `POST /render`. */
export const renderResponseSchema = z.object({
  /** Output format (file extension without dot). */
  renderAs: z.string(),
  /** Rendered (or passthrough) content. */
  content: z.string(),
  /** Names of the rules that matched. */
  rules: z.array(z.string()),
  /** Resulting metadata. */
  metadata: z.record(z.string(), z.unknown()),
});

/** Response body for `POST /render`. */
export type RenderResponse = z.infer<typeof renderResponseSchema>;

/** Request body for `POST /metadata`: exactly one of `path` or `source`, plus metadata. */
export const metadataRequestSchema = z
  .object({
    ...documentTargetShape,
    /** Enrichment metadata to merge into the document's points. */
    metadata: z.record(z.string(), z.unknown(), {
      error: 'Missing required field: metadata (object)',
    }),
  })
  .superRefine(requireExactlyOneTarget);

/** Request body for `POST /metadata`. */
export type MetadataRequest = z.infer<typeof metadataRequestSchema>;

/** Response body for `POST /metadata`. */
export const metadataResponseSchema = z.object({
  /** Always true on success. */
  ok: z.literal(true),
  /** Rules whose schemas validated the metadata. */
  matched_rules: z.array(z.string()),
});

/** Response body for `POST /metadata`. */
export type MetadataResponse = z.infer<typeof metadataResponseSchema>;
