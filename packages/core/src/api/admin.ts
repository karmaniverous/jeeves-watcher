/**
 * @module api/admin
 * Request schemas of the administrative endpoints: POST /points/delete, POST /rules/register, DELETE /rules/unregister, POST /rules/reapply. The service parses their bodies with these, like every other route. No I/O.
 */

import { z } from 'zod';

/** POST /points/delete request body. */
export const pointsDeleteRequestSchema = z.object({
  /** Native Qdrant filter selecting the points to delete. */
  filter: z.record(z.string(), z.unknown(), {
    error: 'Missing required field: filter (object)',
  }),
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
