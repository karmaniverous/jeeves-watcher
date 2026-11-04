/**
 * @module api/admin
 * Request schemas of the administrative endpoints: POST /points/delete, POST /rules/register, DELETE /rules/unregister, POST /rules/reapply. The service parses their bodies with these, like every other route. No I/O.
 */

import { z } from 'zod';

import { FILTER_REQUIRED_MESSAGE, qdrantFilter } from './common.js';

/** POST /points/delete request body. */
export const pointsDeleteRequestSchema = z.object({
  /** Native Qdrant filter selecting the points to delete. */
  filter: qdrantFilter(FILTER_REQUIRED_MESSAGE),
});

/** POST /points/delete request body. */
export type PointsDeleteRequest = z.infer<typeof pointsDeleteRequestSchema>;

/** A virtual-rule source name: a non-empty string. */
const ruleSourceSchema = z
  .string({ error: 'Missing required field: source' })
  .min(1, { error: 'Missing required field: source' });

const RULE_NAME_REQUIRED = 'Every rule must be an object with a name';

/** POST /rules/register request body. */
export const rulesRegisterRequestSchema = z.object({
  /** Registering source (e.g. a plugin name). */
  source: ruleSourceSchema,
  /** Inference rules; each needs a non-empty `name` (the rest is validated on registration). */
  rules: z.array(
    z.looseObject(
      {
        name: z
          .string({ error: RULE_NAME_REQUIRED })
          .min(1, { error: RULE_NAME_REQUIRED }),
      },
      { error: RULE_NAME_REQUIRED },
    ),
    { error: 'Missing required field: rules (array)' },
  ),
});

/** POST /rules/register request body. */
export type RulesRegisterRequest = z.infer<typeof rulesRegisterRequestSchema>;

/** DELETE /rules/unregister request body. */
export const rulesUnregisterRequestSchema = z.object({
  /** Source whose rules are removed. */
  source: ruleSourceSchema,
});

/** DELETE /rules/unregister request body. */
export type RulesUnregisterRequest = z.infer<
  typeof rulesUnregisterRequestSchema
>;

/** POST /rules/reapply request body. */
export const rulesReapplyRequestSchema = z.object({
  /** Globs selecting the indexed files to re-apply rules to. */
  globs: z
    .array(z.string().min(1), {
      error: 'Missing required field: globs (non-empty string array)',
    })
    .min(1, {
      error: 'Missing required field: globs (non-empty string array)',
    }),
});

/** POST /rules/reapply request body. */
export type RulesReapplyRequest = z.infer<typeof rulesReapplyRequestSchema>;

/** POST /points/delete response body: how many points were deleted. */
export const pointsDeleteResponseSchema = z.object({
  deleted: z.number().int().nonnegative(),
});

/** POST /points/delete response body. */
export type PointsDeleteResponse = z.infer<typeof pointsDeleteResponseSchema>;

/** POST /rules/register response body. */
export const rulesRegisterResponseSchema = z.object({
  source: z.string(),
  registered: z.number().int().nonnegative(),
  totalVirtualRules: z.number().int().nonnegative(),
});

/** POST /rules/register response body. */
export type RulesRegisterResponse = z.infer<typeof rulesRegisterResponseSchema>;

/** Response body of both rule unregister routes. */
export const rulesUnregisterResponseSchema = z.object({
  source: z.string(),
  removed: z.boolean(),
});

/** Response body of both rule unregister routes. */
export type RulesUnregisterResponse = z.infer<
  typeof rulesUnregisterResponseSchema
>;

/** Path parameters of DELETE /rules/unregister/:source. */
export const rulesUnregisterParamsSchema = z.object({
  source: ruleSourceSchema,
});

/** Path parameters of DELETE /rules/unregister/:source. */
export type RulesUnregisterParams = z.infer<typeof rulesUnregisterParamsSchema>;

/** POST /rules/reapply response body. */
export const rulesReapplyResponseSchema = z.object({
  matched: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
});

/** POST /rules/reapply response body. */
export type RulesReapplyResponse = z.infer<typeof rulesReapplyResponseSchema>;

/** POST /rebuild-metadata request body: takes no fields. */
export const rebuildMetadataRequestSchema = z.object({});

/** POST /rebuild-metadata request body. */
export type RebuildMetadataRequest = z.infer<
  typeof rebuildMetadataRequestSchema
>;

/** POST /rebuild-metadata response body. */
export const rebuildMetadataResponseSchema = z.object({ ok: z.literal(true) });

/** POST /rebuild-metadata response body. */
export type RebuildMetadataResponse = z.infer<
  typeof rebuildMetadataResponseSchema
>;
