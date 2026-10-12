/**
 * @module schemas/payloadIndexes
 * Zod schema for `vectorStore.payloadIndexes`: configured Qdrant payload indexes, including tenant and principal flags. No I/O.
 */

import { z } from 'zod';

/** Qdrant payload index types supported by `vectorStore.payloadIndexes`. */
export const payloadIndexTypeSchema = z
  .enum(['keyword', 'integer', 'float', 'bool', 'datetime', 'uuid', 'text'])
  .describe('Qdrant payload index type.');

/** A Qdrant payload index type. */
export type PayloadIndexType = z.infer<typeof payloadIndexTypeSchema>;

/** Index types that may carry `isTenant: true` (Qdrant `is_tenant`). */
const TENANT_INDEX_TYPES: readonly PayloadIndexType[] = ['keyword', 'uuid'];

/** Index types that may carry `isPrincipal: true` (Qdrant `is_principal`). */
const PRINCIPAL_INDEX_TYPES: readonly PayloadIndexType[] = [
  'integer',
  'float',
  'datetime',
];

/**
 * A single configured payload index.
 *
 * `isTenant` is valid only for `keyword`/`uuid`; `isPrincipal` only for
 * `integer`/`float`/`datetime`. Both constraints are enforced by refinement.
 */
export const payloadIndexSchema = z
  .object({
    /** Payload field to index. */
    field: z.string().min(1).describe('Payload field name to index.'),
    /** Qdrant index type. */
    type: payloadIndexTypeSchema,
    /** Mark the index as a tenant index (keyword/uuid only). */
    isTenant: z
      .boolean()
      .optional()
      .describe(
        'Qdrant is_tenant: optimise storage for per-tenant filtering (keyword/uuid only).',
      ),
    /** Mark the index as a principal index (integer/float/datetime only). */
    isPrincipal: z
      .boolean()
      .optional()
      .describe(
        'Qdrant is_principal: optimise storage for range filtering (integer/float/datetime only).',
      ),
  })
  .superRefine((val, ctx) => {
    if (val.isTenant && !TENANT_INDEX_TYPES.includes(val.type)) {
      ctx.addIssue({
        code: 'custom',
        path: ['isTenant'],
        message: `isTenant is only valid for ${TENANT_INDEX_TYPES.join('/')} indexes (got "${val.type}")`,
      });
    }
    if (val.isPrincipal && !PRINCIPAL_INDEX_TYPES.includes(val.type)) {
      ctx.addIssue({
        code: 'custom',
        path: ['isPrincipal'],
        message: `isPrincipal is only valid for ${PRINCIPAL_INDEX_TYPES.join('/')} indexes (got "${val.type}")`,
      });
    }
  });

/** A configured Qdrant payload index. */
export type PayloadIndexConfig = z.infer<typeof payloadIndexSchema>;
