/**
 * @module schemas/sources
 * Zod schemas for configured `sources` (named callback endpoints for non-file documents), source references and the callback contract. No I/O.
 */

import { z } from 'zod';

/** Pattern every source name must match (≥ 2 chars, so never a drive letter). */
export const SOURCE_NAME_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/**
 * Pattern of a source reference: `<name>://<id>`, where `<id>` is 1–512
 * non-whitespace characters (`/`-separated segments allowed).
 */
export const SOURCE_REFERENCE_PATTERN = /^[a-z][a-z0-9-]{1,31}:\/\/\S{1,512}$/;

/** Placeholder in a source `url` template that is replaced with the document id. */
export const SOURCE_ID_PLACEHOLDER = '{id}';

/** HTTP status returned by a source callback when the document no longer exists. */
export const SOURCE_DOCUMENT_GONE_STATUS = 404;

/** A source name, e.g. `cg`. */
export const sourceNameSchema = z
  .string()
  .regex(SOURCE_NAME_PATTERN, 'Source name must match ^[a-z][a-z0-9-]{1,31}$')
  .describe('Source name: lowercase letter, then 1-31 of [a-z0-9-].');

/** A source reference, e.g. `cg://chat/thread/123`. */
export const sourceReferenceSchema = z
  .string()
  .regex(
    SOURCE_REFERENCE_PATTERN,
    'Source reference must match <name>://<id> (name ^[a-z][a-z0-9-]{1,31}$, id 1-512 non-whitespace characters)',
  )
  .describe('Source document reference: <name>://<id>.');

/** A source document reference string (`<name>://<id>`). */
export type SourceReference = z.infer<typeof sourceReferenceSchema>;

/** Configuration of a single named source. */
export const sourceConfigSchema = z.object({
  /** Callback URL template; must contain `{id}`. */
  url: z
    .string()
    .min(1)
    .refine((url) => url.includes(SOURCE_ID_PLACEHOLDER), {
      message: `url must contain the ${SOURCE_ID_PLACEHOLDER} placeholder`,
    })
    .describe(
      'Callback URL template. {id} is replaced with the document id (each /-segment URL-encoded, slashes kept). Supports ${ENV_VAR} substitution.',
    ),
  /** Request headers sent with every callback (e.g. Authorization). */
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Headers sent with every callback request (supports ${ENV_VAR} substitution).',
    ),
  /** Callback timeout in milliseconds. */
  timeoutMs: z
    .number()
    .int()
    .positive()
    .default(10000)
    .describe('Callback timeout in milliseconds. Default: 10000.'),
  /** Maximum parallel callbacks for this source. */
  concurrency: z
    .number()
    .int()
    .positive()
    .default(8)
    .describe(
      'Maximum parallel callbacks for this source (e.g. during reindex). Default: 8.',
    ),
});

/** Configuration of a single named source. */
export type SourceConfig = z.infer<typeof sourceConfigSchema>;

/** The `sources` config section: source name → source configuration. */
export const sourcesConfigSchema = z
  .record(sourceNameSchema, sourceConfigSchema)
  .describe(
    'Named sources for non-file documents, retrieved by callback. Keys are source names used in <name>://<id> references. Read at startup only.',
  );

/** The `sources` config section. */
export type SourcesConfig = z.infer<typeof sourcesConfigSchema>;

/**
 * A source document as returned by a source callback: a `GET` to the
 * configured URL answered with `200` and an `application/json` body. The body
 * is the record itself, as the owner stores it, with no envelope: any JSON
 * object. A `404` means the document no longer exists (see
 * {@link SOURCE_DOCUMENT_GONE_STATUS}); any other status is a transient failure.
 */
export const sourceDocumentSchema = z
  .record(z.string(), z.unknown())
  .describe('A source document: any JSON object returned by the callback.');

/** A source document returned by a source callback. */
export type SourceDocument = z.infer<typeof sourceDocumentSchema>;
