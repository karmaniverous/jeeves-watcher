/**
 * @module schemas/payloadIndexes
 * Zod schema for `vectorStore.payloadIndexes`: configured Qdrant payload indexes, including tenant and principal flags. No I/O.
 */

import { z } from 'zod';

import { SYSTEM_PAYLOAD_INDEX_FIELDS } from '../reservedFields.js';

/** Qdrant payload index types supported by `vectorStore.payloadIndexes`. */
export const payloadIndexTypeSchema = z
  .enum(['keyword', 'integer', 'float', 'bool', 'datetime', 'uuid', 'text'])
  .describe('Qdrant payload index type.');

/** A Qdrant payload index type. */
export type PayloadIndexType = z.infer<typeof payloadIndexTypeSchema>;

/** An index type that may carry `isTenant: true`. */
export type TenantIndexType = Extract<PayloadIndexType, 'keyword' | 'uuid'>;

/** An index type that may carry `isPrincipal: true`. */
export type PrincipalIndexType = Extract<
  PayloadIndexType,
  'integer' | 'float' | 'datetime'
>;

/** Index types that may carry `isTenant: true` (Qdrant `is_tenant`). */
const TENANT_INDEX_TYPES: readonly TenantIndexType[] = ['keyword', 'uuid'];

/** Index types that may carry `isPrincipal: true` (Qdrant `is_principal`). */
const PRINCIPAL_INDEX_TYPES: readonly PrincipalIndexType[] = [
  'integer',
  'float',
  'datetime',
];

/**
 * Whether an index type may carry `isTenant: true` (Qdrant `is_tenant`).
 *
 * @param type - Payload index type.
 * @returns `true` for `keyword` and `uuid`.
 */
export function isTenantIndexType(
  type: PayloadIndexType,
): type is TenantIndexType {
  return (TENANT_INDEX_TYPES as readonly string[]).includes(type);
}

/**
 * Whether an index type may carry `isPrincipal: true` (Qdrant
 * `is_principal`).
 *
 * @param type - Payload index type.
 * @returns `true` for `integer`, `float` and `datetime`.
 */
export function isPrincipalIndexType(
  type: PayloadIndexType,
): type is PrincipalIndexType {
  return (PRINCIPAL_INDEX_TYPES as readonly string[]).includes(type);
}

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
    if (val.isTenant && !isTenantIndexType(val.type)) {
      ctx.addIssue({
        code: 'custom',
        path: ['isTenant'],
        message: `isTenant is only valid for ${TENANT_INDEX_TYPES.join('/')} indexes (got "${val.type}")`,
      });
    }
    if (val.isPrincipal && !isPrincipalIndexType(val.type)) {
      ctx.addIssue({
        code: 'custom',
        path: ['isPrincipal'],
        message: `isPrincipal is only valid for ${PRINCIPAL_INDEX_TYPES.join('/')} indexes (got "${val.type}")`,
      });
    }
  });

/** A configured Qdrant payload index. */
export type PayloadIndexConfig = z.infer<typeof payloadIndexSchema>;

const systemIndexFields = new Set<string>(SYSTEM_PAYLOAD_INDEX_FIELDS);

/**
 * The `vectorStore.payloadIndexes` list. Each `field` may appear once, and
 * the system-indexed fields (`source`, `source_rule`) are rejected: the
 * watcher always keeps a keyword index on them.
 */
export const payloadIndexesSchema = z
  .array(payloadIndexSchema)
  .superRefine((indexes, ctx) => {
    const seen = new Set<string>();
    indexes.forEach(({ field }, i) => {
      if (systemIndexFields.has(field)) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'field'],
          message: `"${field}" is a system field the watcher always indexes (keyword); remove this entry`,
        });
      } else if (seen.has(field)) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'field'],
          message: `Duplicate payload index for field "${field}"; each field may be indexed once`,
        });
      }
      seen.add(field);
    });
  });
