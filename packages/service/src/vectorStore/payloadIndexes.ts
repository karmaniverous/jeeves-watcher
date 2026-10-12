/**
 * @module vectorStore/payloadIndexes
 * Plans and creates missing Qdrant payload indexes (configured `vectorStore.payloadIndexes` plus system `source`/`source_rule` keyword indexes). Never drops; warns on type mismatch.
 */

import type { PayloadIndexConfig } from '@karmaniverous/jeeves-watcher-core';
import type { QdrantClient, Schemas } from '@qdrant/js-client-rest';
import type pino from 'pino';

import { getLogger } from '../util/logger';

/**
 * Keyword indexes the watcher always ensures, regardless of configuration.
 * A configured entry for the same field takes precedence.
 */
export const SYSTEM_PAYLOAD_INDEXES: readonly PayloadIndexConfig[] = [
  { field: 'source', type: 'keyword' },
  { field: 'source_rule', type: 'keyword' },
];

/** An existing index whose type differs from the desired one. */
export interface PayloadIndexMismatch {
  /** Payload field name. */
  field: string;
  /** Desired (configured or system) index type. */
  expected: PayloadIndexConfig['type'];
  /** Index type currently reported by Qdrant. */
  actual: string;
}

/** Result of {@link planPayloadIndexes}. */
export interface PayloadIndexPlan {
  /** Indexes to create, in desired order. */
  create: PayloadIndexConfig[];
  /** Existing indexes with a different type; left untouched. */
  mismatches: PayloadIndexMismatch[];
}

/**
 * Decide which payload indexes to create. Pure.
 *
 * System indexes come first; configured entries override a system entry for
 * the same field, and a later configured entry overrides an earlier one.
 * Fields already indexed with the same type are skipped; fields indexed with
 * a different type are reported as mismatches and never recreated.
 *
 * @param configured - Configured `vectorStore.payloadIndexes` (may be undefined).
 * @param existing - Qdrant `payload_schema`: field name to its index info.
 * @returns The creation plan.
 */
export function planPayloadIndexes(
  configured: readonly PayloadIndexConfig[] | undefined,
  existing: Record<string, { data_type?: string } | undefined>,
): PayloadIndexPlan {
  const desired = new Map<string, PayloadIndexConfig>();
  for (const index of [...SYSTEM_PAYLOAD_INDEXES, ...(configured ?? [])]) {
    desired.set(index.field, index);
  }

  const plan: PayloadIndexPlan = { create: [], mismatches: [] };
  for (const index of desired.values()) {
    const current = existing[index.field];
    if (!current) {
      plan.create.push(index);
    } else if (current.data_type !== index.type) {
      plan.mismatches.push({
        field: index.field,
        expected: index.type,
        actual: current.data_type ?? 'unknown',
      });
    }
  }
  return plan;
}

/**
 * Map a configured index to a Qdrant `field_schema`, translating
 * `isTenant` → `is_tenant` and `isPrincipal` → `is_principal`. Pure.
 *
 * @param index - Configured payload index.
 * @returns The Qdrant payload field schema.
 */
export function toQdrantFieldSchema(
  index: PayloadIndexConfig,
): Schemas['PayloadFieldSchema'] {
  if (index.isTenant && (index.type === 'keyword' || index.type === 'uuid')) {
    return { type: index.type, is_tenant: true };
  }
  if (
    index.isPrincipal &&
    (index.type === 'integer' ||
      index.type === 'float' ||
      index.type === 'datetime')
  ) {
    return { type: index.type, is_principal: true };
  }
  return index.type;
}

/** The subset of the Qdrant client used to manage payload indexes. */
export type PayloadIndexClient = Pick<
  QdrantClient,
  'getCollection' | 'createPayloadIndex'
>;

/**
 * Create every missing payload index on a collection. Never drops or
 * recreates an index; a type mismatch is logged at `warn` and left alone.
 *
 * @param client - Qdrant client (or compatible subset).
 * @param collectionName - Target collection (must already exist).
 * @param configured - Configured `vectorStore.payloadIndexes`.
 * @param logger - Optional pino logger; falls back to console for warnings.
 * @throws Error naming the field when Qdrant rejects an index creation.
 */
export async function ensurePayloadIndexes(
  client: PayloadIndexClient,
  collectionName: string,
  configured: readonly PayloadIndexConfig[] | undefined,
  logger?: pino.Logger,
): Promise<void> {
  const info = await client.getCollection(collectionName);
  const plan = planPayloadIndexes(configured, info.payload_schema);

  for (const mismatch of plan.mismatches) {
    getLogger(logger).warn(
      { collectionName, ...mismatch },
      'Existing payload index type differs from configuration; leaving it unchanged',
    );
  }

  for (const index of plan.create) {
    try {
      await client.createPayloadIndex(collectionName, {
        field_name: index.field,
        field_schema: toQdrantFieldSchema(index),
        wait: true,
      });
    } catch (error) {
      throw new Error(
        `Failed to create payload index on "${index.field}": ${String(error)}`,
        { cause: error },
      );
    }
    logger?.info(
      { collectionName, field: index.field, type: index.type },
      'Payload index created',
    );
  }
}
