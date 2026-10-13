/**
 * @module sources/types
 * Zod schemas and derived types for source callback outcomes (document / gone / error) and reference rejections. Pure declarations; no I/O.
 */

import {
  documentRejectionCodeSchema,
  issueTypeSchema,
  sourceDocumentSchema,
} from '@karmaniverous/jeeves-watcher-core';
import { z } from 'zod';

/**
 * Error codes a source callback can produce: the subset of the canonical
 * issue codes that belong to retrieval.
 */
export const sourceErrorCodeSchema = issueTypeSchema.extract([
  'source_unavailable',
  'unsupported_content_type',
]);

/** A source callback error code. */
export type SourceErrorCode = z.infer<typeof sourceErrorCodeSchema>;

/** `200` + `application/json` + JSON object body: the document itself. */
export const sourceDocumentResultSchema = z.object({
  kind: z.literal('document'),
  /** The record as the owner stores it. */
  body: sourceDocumentSchema,
});

/** `404`: the document no longer exists. */
export const sourceGoneResultSchema = z.object({
  kind: z.literal('gone'),
});

/** Any other outcome. The message never contains header values or the URL. */
export const sourceErrorResultSchema = z.object({
  kind: z.literal('error'),
  code: sourceErrorCodeSchema,
  /** Human-readable cause, safe to log and to record as an issue. */
  message: z.string(),
});

/** Outcome of one source callback (discriminated on `kind`). */
export const sourceRetrievalResultSchema = z.discriminatedUnion('kind', [
  sourceDocumentResultSchema,
  sourceGoneResultSchema,
  sourceErrorResultSchema,
]);

/** Outcome of one source callback. */
export type SourceRetrievalResult = z.infer<typeof sourceRetrievalResultSchema>;

/**
 * Why a reference was rejected before any request was made:
 * `invalid_reference` (not `<name>://<id>`), `unknown_source` (name not in
 * config `sources`), `invalid_id` (empty, `.` or `..` segment, or the built
 * URL would leave the configured origin). The reference-level subset of
 * core `documentRejectionCodeSchema`.
 */
export const sourceRejectionCodeSchema = documentRejectionCodeSchema.extract([
  'invalid_reference',
  'unknown_source',
  'invalid_id',
]);

/** A reference rejection code. */
export type SourceRejectionCode = z.infer<typeof sourceRejectionCodeSchema>;

/** A parsed `<name>://<id>` reference. */
export const parsedSourceReferenceSchema = z.object({
  /** The full reference string. */
  ref: z.string(),
  /** Source name. */
  name: z.string(),
  /** Opaque document id. */
  id: z.string(),
});

/** A parsed `<name>://<id>` reference. */
export type ParsedSourceReference = z.infer<typeof parsedSourceReferenceSchema>;

/** A reference resolved against config: parsed parts plus the URL to request. */
export const resolvedSourceReferenceSchema = parsedSourceReferenceSchema.extend(
  {
    /** Callback URL built from `sources.<name>.url`. */
    url: z.string(),
  },
);

/** A reference resolved against config. */
export type ResolvedSourceReference = z.infer<
  typeof resolvedSourceReferenceSchema
>;

/** Inputs to one callback request. */
export const sourceRequestSchema = z.object({
  /** Source name, used in messages. */
  name: z.string(),
  /** URL built from config (never caller-supplied). */
  url: z.string(),
  /** Configured headers (already `${ENV}`-substituted). */
  headers: z.record(z.string(), z.string()),
  /** Abort the request (including the body read) after this many ms. */
  timeoutMs: z.number().int().positive(),
});

/** Inputs to one callback request. */
export type SourceRequest = z.infer<typeof sourceRequestSchema>;

/**
 * Thrown (or rejected) when a reference cannot be retrieved for a reason
 * known before any request is made. No request is ever sent for a rejected
 * reference.
 */
export class SourceReferenceError extends Error {
  /** Rejection code. */
  readonly code: SourceRejectionCode;

  /**
   * @param code - Rejection code.
   * @param message - Human-readable reason (never contains header values).
   */
  constructor(code: SourceRejectionCode, message: string) {
    super(message);
    this.name = 'SourceReferenceError';
    this.code = code;
  }
}
