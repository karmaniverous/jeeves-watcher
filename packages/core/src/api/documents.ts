/**
 * @module api/documents
 * Zod request/response schemas for source-document notification (POST /documents, 202 or ?wait=true) and deletion (POST /documents/delete). No I/O.
 */

import { z } from 'zod';

import { sourceReferenceSchema } from '../schemas/sources.js';
import { documentErrorSchema, qdrantFilterSchema } from './common.js';

/** Maximum number of documents in one `POST /documents` request. */
export const MAX_DOCUMENTS_PER_REQUEST = 100;

/**
 * A document notification: the reference of a changed source document and
 * the rule that indexes it. Notify only: content is always retrieved through
 * the source callback, so unknown keys (e.g. inline content) are rejected.
 */
export const documentNotificationSchema = z.strictObject({
  /** Source reference (`<name>://<id>`). */
  source: sourceReferenceSchema,
  /** Name of the inference rule that indexes the document. */
  rule: z.string().min(1, 'rule must be a non-empty string'),
});

/** A document notification. */
export type DocumentNotification = z.infer<typeof documentNotificationSchema>;

/** Request body for `POST /documents`. */
export const documentsRequestSchema = z.object({
  /** Documents to (re)index: 1 to {@link MAX_DOCUMENTS_PER_REQUEST}. */
  documents: z
    .array(documentNotificationSchema)
    .min(1, 'documents must contain at least one entry')
    .max(
      MAX_DOCUMENTS_PER_REQUEST,
      `documents must contain at most ${String(MAX_DOCUMENTS_PER_REQUEST)} entries`,
    ),
});

/** Request body for `POST /documents`. */
export type DocumentsRequest = z.infer<typeof documentsRequestSchema>;

/**
 * Envelope the service parses `POST /documents` with: the shape of
 * {@link documentsRequestSchema}, but `source` is any non-empty string, so a
 * malformed reference rejects only its own document (`invalid_reference` in
 * `rejected`) instead of the whole request. Shape errors (count, missing or
 * empty `rule`, unknown keys) still fail the request with `400`.
 */
export const documentsEnvelopeSchema = z.object({
  /** Documents to (re)index: 1 to {@link MAX_DOCUMENTS_PER_REQUEST}. */
  documents: z
    .array(
      documentNotificationSchema.extend({
        /** Reference as submitted; validated per document. */
        source: z.string().min(1, 'source must be a non-empty string'),
      }),
    )
    .min(1, 'documents must contain at least one entry')
    .max(
      MAX_DOCUMENTS_PER_REQUEST,
      `documents must contain at most ${String(MAX_DOCUMENTS_PER_REQUEST)} entries`,
    ),
});

/** Envelope of a `POST /documents` request (references not yet validated). */
export type DocumentsEnvelope = z.infer<typeof documentsEnvelopeSchema>;

/**
 * Codes of notifications rejected by synchronous validation:
 * `invalid_reference` (not `<name>://<id>`), `unknown_source` (name not in
 * config `sources`), `invalid_id` (empty, `.` or `..` id segment),
 * `rule_missing` (no rule of that name in the merged rule set) and
 * `queue_stopped` (the service is shutting down).
 */
export const documentRejectionCodeSchema = z.enum([
  'invalid_reference',
  'unknown_source',
  'invalid_id',
  'rule_missing',
  'queue_stopped',
]);

/** Code of a notification rejected by synchronous validation. */
export type DocumentRejectionCode = z.infer<typeof documentRejectionCodeSchema>;

/**
 * Query string for `POST /documents`. `wait` accepts a boolean or the strings
 * `true`/`false`/`1`/`0`.
 */
export const documentsQuerySchema = z.object({
  /** Process synchronously and return per-document results. */
  wait: z
    .union([
      z.boolean(),
      z.stringbool({ truthy: ['true', '1'], falsy: ['false', '0'] }),
    ])
    .optional(),
});

/** Query string for `POST /documents`. */
export type DocumentsQuery = z.infer<typeof documentsQuerySchema>;

/** A notification rejected by synchronous validation. */
export const documentRejectionSchema = z.object({
  /** The reference as submitted. */
  source: z.string(),
  /** Why it was rejected. */
  error: documentErrorSchema.omit({ details: true }),
});

/** A notification rejected by synchronous validation. */
export type DocumentRejection = z.infer<typeof documentRejectionSchema>;

/** `202` response body for `POST /documents` (asynchronous, the default). */
export const documentsAcceptedResponseSchema = z.object({
  /** References enqueued for processing. */
  accepted: z.array(z.string()),
  /** Notifications rejected by synchronous validation. */
  rejected: z.array(documentRejectionSchema),
});

/** `202` response body for `POST /documents`. */
export type DocumentsAcceptedResponse = z.infer<
  typeof documentsAcceptedResponseSchema
>;

/** Outcome of processing one document synchronously. */
export const documentResultStatusSchema = z.enum([
  'indexed',
  'unchanged',
  'deleted',
  'failed',
]);

/** Outcome of processing one document synchronously. */
export type DocumentResultStatus = z.infer<typeof documentResultStatusSchema>;

/** Per-document result of `POST /documents?wait=true`. */
export const documentResultSchema = z.object({
  /** The reference processed. */
  source: z.string(),
  /** Outcome. */
  status: documentResultStatusSchema,
  /** Number of chunks written (when indexed). */
  chunks: z.number().int().nonnegative().optional(),
  /** Rules that matched (when indexed or unchanged). */
  matched_rules: z.array(z.string()).optional(),
  /** Failure detail (when failed). */
  error: documentErrorSchema.optional(),
});

/** Per-document result of `POST /documents?wait=true`. */
export type DocumentResult = z.infer<typeof documentResultSchema>;

/** `200` response body for `POST /documents?wait=true`. */
export const documentsResultsResponseSchema = z.object({
  /** One result per submitted document. */
  results: z.array(documentResultSchema),
});

/** `200` response body for `POST /documents?wait=true`. */
export type DocumentsResultsResponse = z.infer<
  typeof documentsResultsResponseSchema
>;

/**
 * Request body for `POST /documents/delete`: either explicit references or a
 * Qdrant filter (constrained server-side to points carrying `source`).
 */
export const documentsDeleteRequestSchema = z.union([
  z.strictObject({
    /** References of the documents to delete. */
    sources: z
      .array(sourceReferenceSchema)
      .min(1, 'sources must contain at least one reference'),
  }),
  z.strictObject({
    /** Qdrant filter selecting the documents to delete. */
    filter: qdrantFilterSchema,
  }),
]);

/** Request body for `POST /documents/delete`. */
export type DocumentsDeleteRequest = z.infer<
  typeof documentsDeleteRequestSchema
>;

/** Response body for `POST /documents/delete`. */
export const documentsDeleteResponseSchema = z.object({
  /** Number of documents (not points) removed. */
  deleted: z.number().int().nonnegative(),
});

/** Response body for `POST /documents/delete`. */
export type DocumentsDeleteResponse = z.infer<
  typeof documentsDeleteResponseSchema
>;
