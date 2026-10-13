/**
 * @module api/documents
 * Zod request/response schemas for source-document notification (POST /documents, 202 or ?wait=true) and deletion (POST /documents/delete). No I/O.
 */

import { z } from 'zod';

import { sourceReferenceSchema } from '../schemas/sources.js';
import { documentErrorSchema, nonEmptyQdrantFilterSchema } from './common.js';
import { issueTypeSchema } from './monitoring.js';

/** Maximum number of documents in one `POST /documents` request. */
export const MAX_DOCUMENTS_PER_REQUEST = 100;

/** Maximum number of references in one `POST /documents/delete` request. */
export const MAX_DELETE_SOURCES_PER_REQUEST = 1000;

/**
 * The `documents` array of a notify request: 1 to
 * {@link MAX_DOCUMENTS_PER_REQUEST} items of the given schema.
 *
 * @param item - Schema of one document.
 * @returns The bounded array schema.
 */
const documentsArray = <T extends z.ZodType>(item: T) =>
  z
    .array(item)
    .min(1, 'documents must contain at least one entry')
    .max(
      MAX_DOCUMENTS_PER_REQUEST,
      `documents must contain at most ${String(MAX_DOCUMENTS_PER_REQUEST)} entries`,
    );

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
  documents: documentsArray(documentNotificationSchema),
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
  documents: documentsArray(
    documentNotificationSchema.extend({
      /** Reference as submitted; validated per document. */
      source: z.string().min(1, 'source must be a non-empty string'),
    }),
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

/** Why a notification was rejected: a typed code plus a message. */
export const documentRejectionErrorSchema = documentErrorSchema
  .omit({ details: true })
  .extend({
    /** Rejection code. */
    code: documentRejectionCodeSchema,
  });

/** Why a notification was rejected. */
export type DocumentRejectionError = z.infer<
  typeof documentRejectionErrorSchema
>;

/** A notification rejected by synchronous validation. */
export const documentRejectionSchema = z.object({
  /** The reference as submitted. */
  source: z.string(),
  /** Why it was rejected. */
  error: documentRejectionErrorSchema,
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

/**
 * Code of a failed per-document result: the issue type of a processing
 * failure, or (with `?wait=true`) the rejection code of a notification that
 * failed synchronous validation.
 */
export const documentFailureCodeSchema = z.union([
  issueTypeSchema,
  documentRejectionCodeSchema,
]);

/** Code of a failed per-document result. */
export type DocumentFailureCode = z.infer<typeof documentFailureCodeSchema>;

/** Failure detail of a per-document result: typed code, message, optional details. */
export const documentFailureSchema = documentErrorSchema.extend({
  /** Issue type or rejection code. */
  code: documentFailureCodeSchema,
});

/** Failure detail of a per-document result. */
export type DocumentFailure = z.infer<typeof documentFailureSchema>;

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
  error: documentFailureSchema.optional(),
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
 * Qdrant filter with at least one condition (a condition-free filter such as
 * `{}` or `{ must: [] }` is rejected). The server constrains the filter to
 * points carrying `source` and no `file_path`.
 */
export const documentsDeleteRequestSchema = z.union([
  z.strictObject({
    /** References of the documents to delete: 1 to {@link MAX_DELETE_SOURCES_PER_REQUEST}. */
    sources: z
      .array(sourceReferenceSchema)
      .min(1, 'sources must contain at least one reference')
      .max(
        MAX_DELETE_SOURCES_PER_REQUEST,
        `sources must contain at most ${String(MAX_DELETE_SOURCES_PER_REQUEST)} references`,
      ),
  }),
  z.strictObject({
    /** Qdrant filter selecting the documents to delete (at least one condition). */
    filter: nonEmptyQdrantFilterSchema,
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
