/**
 * @module api/handlers/configSchema
 * Returns the JSON Schema describing the merged config document.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { inferenceRuleSchema } from '../../config/schemas';

/**
 * Extended inference rule schema including runtime `values` field.
 */
const inferenceRuleWithValuesSchema = inferenceRuleSchema.extend({
  /** Runtime-accumulated distinct values per property. */
  values: z.record(z.string(), z.array(z.unknown())).optional(),
});

/**
 * Merged config schema describing the virtual document (authored + runtime).
 */
const mergedConfigSchema = z.object({
  /** Optional description of this watcher deployment's organizational strategy. */
  description: z.string().optional(),
  /** Search configuration including score thresholds. */
  search: z
    .object({
      scoreThresholds: z
        .object({
          strong: z.number(),
          relevant: z.number(),
          noise: z.number(),
        })
        .optional(),
    })
    .optional(),
  /** Global named schema collection. */
  schemas: z.array(z.unknown()),
  /** Rules for inferring metadata from document properties (with runtime values). */
  inferenceRules: z.array(inferenceRuleWithValuesSchema),
  /** Reusable named JsonMap transformations. */
  maps: z.record(z.string(), z.unknown()).optional(),
  /** Reusable named Handlebars templates. */
  templates: z.record(z.string(), z.unknown()).optional(),
  /** Custom Handlebars helper registration. */
  templateHelpers: z.record(z.string(), z.unknown()).optional(),
  /** Custom JsonMap lib function registration. */
  mapHelpers: z.record(z.string(), z.unknown()).optional(),
  /** Named Qdrant filter patterns for skill-activated behaviors. */
  slots: z.record(z.string(), z.unknown()).optional(),
  /** Current embedding issues. */
  issues: z.record(z.string(), z.array(z.unknown())).optional(),
});

/**
 * Handler for `GET /config/schema`.
 *
 * @param req - Fastify request.
 * @param res - Fastify response.
 */
export function createConfigSchemaHandler() {
  return async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
    const schema = z.toJSONSchema(mergedConfigSchema);
    res.send(schema);
  };
}
