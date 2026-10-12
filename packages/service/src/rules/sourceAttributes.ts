/**
 * @module rules/sourceAttributes
 * Zod schema and builder for source-document rule attributes (`source` identity block + `json` record; no `file` key). Pure, no I/O.
 */

import { z } from 'zod';

/**
 * Attributes a source document is matched and resolved against. There is no
 * `file` key, so file rules (`file.path` globs) never match a source
 * document, and a source rule (`required: ["source"]`) never matches a file.
 */
export const sourceAttributesSchema = z.object({
  /** Identity of the source document. */
  source: z.object({
    /** Full reference, e.g. `app://chat/thread/6710c3`. */
    ref: z.string(),
    /** Source name, e.g. `app`. */
    name: z.string(),
    /** Opaque document id, e.g. `chat/thread/6710c3`. */
    id: z.string(),
    /** Designated rule name. */
    rule: z.string(),
    /** ISO 8601 retrieval time (server clock). */
    retrievedAt: z.string(),
  }),
  /** The JSON callback body (the record as the owner stores it). */
  json: z.record(z.string(), z.unknown()).optional(),
});

/** Attributes of a source document. */
export type SourceAttributes = z.infer<typeof sourceAttributesSchema>;

/** Inputs to {@link buildSourceAttributes}. */
export interface SourceAttributesInput {
  /** Full reference. */
  ref: string;
  /** Source name. */
  name: string;
  /** Opaque document id. */
  id: string;
  /** Designated rule name. */
  rule: string;
  /** The callback body. */
  body: Record<string, unknown>;
  /** Retrieval time. */
  retrievedAt: Date;
}

/**
 * Build {@link SourceAttributes} for a retrieved source document.
 *
 * @param input - Parsed reference, designated rule, body and retrieval time.
 * @returns The attributes.
 */
export function buildSourceAttributes(
  input: SourceAttributesInput,
): SourceAttributes {
  const { ref, name, id, rule, body, retrievedAt } = input;
  return {
    source: { ref, name, id, rule, retrievedAt: retrievedAt.toISOString() },
    json: body,
  };
}
