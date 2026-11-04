/**
 * @module api/configRoutes
 * Request and response schemas for the config inspection routes: `GET /config/schema`, `POST /config/match` and `POST /config/validate`. Envelopes are closed objects; user content (the JSON Schema document, test-path metadata, a candidate config) is an open record (spec D51). No I/O.
 */

import { z } from 'zod';

/** A config location and what is wrong (or notable) there. */
const configIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});

/** Response body of `GET /config/schema`: the merged config JSON Schema document. */
export const getConfigSchemaResponseSchema = z
  .record(z.string(), z.unknown())
  .describe('JSON Schema (draft 2020-12) for the watcher config.');

/** Response body of {@link getConfigSchemaResponseSchema}. */
export type GetConfigSchemaResponse = z.infer<
  typeof getConfigSchemaResponseSchema
>;

/** Request body of `POST /config/match`. */
export const matchConfigRequestSchema = z.object({
  paths: z
    .array(z.string(), { error: 'Request body must include "paths" array' })
    .describe('File paths to test against the watch scope and rules.'),
});

/** Request body of {@link matchConfigRequestSchema}. */
export type MatchConfigRequest = z.infer<typeof matchConfigRequestSchema>;

/** Response body of `POST /config/match`: one entry per requested path, in order. */
export const matchConfigResponseSchema = z.object({
  matches: z.array(
    z.object({
      rules: z.array(z.string()),
      watched: z.boolean(),
    }),
  ),
});

/** Response body of {@link matchConfigResponseSchema}. */
export type MatchConfigResponse = z.infer<typeof matchConfigResponseSchema>;

/** Request body of `POST /config/validate`. */
export const validateConfigRequestSchema = z.object({
  config: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Partial config merged over the current one; omit to check it.'),
  testPaths: z
    .array(z.string())
    .optional()
    .describe('Paths to run through the candidate config.'),
});

/** Request body of {@link validateConfigRequestSchema}. */
export type ValidateConfigRequest = z.infer<typeof validateConfigRequestSchema>;

/** Response body of `POST /config/validate`. */
export const validateConfigResponseSchema = z.object({
  valid: z.boolean(),
  errors: z.array(configIssueSchema).optional(),
  warnings: z.array(configIssueSchema).optional(),
  testResults: z
    .array(
      z.object({
        path: z.string(),
        matchedRules: z.array(z.string()),
        metadata: z.record(z.string(), z.unknown()),
        error: z.string().optional(),
      }),
    )
    .optional(),
});

/** Response body of {@link validateConfigResponseSchema}. */
export type ValidateConfigResponse = z.infer<
  typeof validateConfigResponseSchema
>;
