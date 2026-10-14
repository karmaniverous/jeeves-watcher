/**
 * @module api/handlers/configSchema
 * Returns the JSON Schema of the merged config document served by GET /config, derived from the core config schema (the public allow-list) plus the runtime fields. Pure.
 */

import { issueRecordSchema } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  inferenceRuleSchema,
  jeevesWatcherConfigSchema,
} from '../../config/schemas';
import { PUBLIC_CONFIG_KEYS } from '../publicConfig';

type PublicConfigKey = (typeof PUBLIC_CONFIG_KEYS)[number];

/** Pick mask selecting exactly the public allow-list from the core schema. */
const PUBLIC_MASK = Object.fromEntries(
  PUBLIC_CONFIG_KEYS.map((key) => [key, true]),
) as Record<PublicConfigKey, true>;

const { mapHelpers, templateHelpers } = jeevesWatcherConfigSchema.shape;

/** Introspected helper exports (`<namespace>_<name>` → description). */
const helperExportsSchema = z
  .record(z.string(), z.string())
  .optional()
  .describe('Introspected helper exports, when available.');

/**
 * The merged config document of `GET /config`: the core config schema
 * reduced to the public allow-list (`PUBLIC_CONFIG_KEYS`), with the runtime
 * additions: each rule's `source` and `values`, helper `exports`, and
 * `issues`. Every top-level key is always present in the document.
 */
export const mergedConfigSchema = jeevesWatcherConfigSchema
  .pick(PUBLIC_MASK)
  .required()
  .extend({
    /** Config rules then virtual rules, with their runtime fields. */
    inferenceRules: z.array(
      inferenceRuleSchema.extend({
        /** `config`, or the source that registered the virtual rule. */
        source: z
          .string()
          .describe('"config", or the source that registered the rule.'),
        /** Runtime-accumulated distinct values per property. */
        values: z
          .record(z.string(), z.array(z.unknown()))
          .describe('Distinct values seen per property (files only).'),
      }),
    ),
    /** Map helpers, with their introspected exports. */
    mapHelpers: z.record(
      z.string(),
      mapHelpers.unwrap().valueType.extend({ exports: helperExportsSchema }),
    ),
    /** Template helpers, with their introspected exports. */
    templateHelpers: z.record(
      z.string(),
      templateHelpers
        .unwrap()
        .valueType.extend({ exports: helperExportsSchema }),
    ),
    /** Current runtime issues, as in `GET /issues`. */
    issues: z
      .record(z.string(), z.array(issueRecordSchema))
      .describe('Current runtime issues, as in GET /issues.'),
  });

/**
 * Handler for `GET /config/schema`: the JSON Schema of
 * {@link mergedConfigSchema}.
 *
 * @returns The Fastify handler.
 */
export function createConfigSchemaHandler() {
  return async (_req: FastifyRequest, res: FastifyReply): Promise<void> => {
    const schema = z.toJSONSchema(mergedConfigSchema, {
      unrepresentable: 'any',
    });
    res.send(schema);
  };
}
