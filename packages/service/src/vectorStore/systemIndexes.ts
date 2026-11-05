/**
 * @module vectorStore/systemIndexes
 * System payload indexes (D74, D154, D155): created at startup by background wait=true calls (startup never waits), reported as building, ready, conflict or failed; plus keyword-index readiness for by-filter writes. Qdrant I/O.
 *
 * `chunk_index` (integer) lets `countFacets` count documents, not chunks;
 * `file_path` (keyword) serves metadata writes by filter (D139);
 * `matched_rules` (keyword) serves rule-scoped counts (D155). A field
 * already indexed with another type is left alone (`conflict`): writes keep
 * using ID addressing, and `countFacets` answers 503 naming the index.
 */

import type { QdrantClient } from '@qdrant/js-client-rest';
import type pino from 'pino';

import {
  FIELD_CHUNK_INDEX,
  FIELD_FILE_PATH,
  FIELD_MATCHED_RULES,
} from '../processor/payloadFields';
import { getLogger } from '../util/logger';
import { normalizeError } from '../util/normalizeError';

/** State of one system index (`GET /status` `health.collection.systemIndexes`). */
export type SystemIndexState = 'building' | 'ready' | 'conflict' | 'failed';

/** A system index: field and Qdrant index type. */
export interface SystemIndex {
  /** Payload field. */
  field: string;
  /** Qdrant index type. */
  type: 'keyword' | 'integer';
}

/** The system indexes, in creation order. */
export const SYSTEM_INDEXES: readonly SystemIndex[] = [
  { field: FIELD_CHUNK_INDEX, type: 'integer' },
  { field: FIELD_FILE_PATH, type: 'keyword' },
  { field: FIELD_MATCHED_RULES, type: 'keyword' },
];

/** The subset of the Qdrant client used here. */
export type SystemIndexClient = Pick<
  QdrantClient,
  'getCollection' | 'createPayloadIndex'
>;

/** Payload schema as reported by Qdrant: field to its index type. */
export type PayloadSchema = Record<string, { data_type?: string } | undefined>;

/** Tracks the system indexes of one collection and its keyword indexes. */
export class SystemIndexTracker {
  private readonly states = new Map<string, SystemIndexState>();
  private readonly keywordFields = new Set<string>();
  private settled: Promise<void> = Promise.resolve();

  /**
   * @param indexes - The system indexes (default {@link SYSTEM_INDEXES}).
   */
  constructor(
    private readonly indexes: readonly SystemIndex[] = SYSTEM_INDEXES,
  ) {}

  /**
   * Read the collection's payload schema, then start a background creation
   * for every missing system index. Resolves once the schema is read; the
   * creations are not awaited (see {@link whenSettled}).
   *
   * @param client - Qdrant client.
   * @param collectionName - The collection (must exist).
   * @param logger - Logger.
   */
  async start(
    client: SystemIndexClient,
    collectionName: string,
    logger?: pino.Logger,
  ): Promise<void> {
    const log = errorLogger(logger);
    const schema = await readSchema(client, collectionName);
    for (const [field, info] of Object.entries(schema)) {
      if (info?.data_type === 'keyword') this.keywordFields.add(field);
    }
    const builds: Array<Promise<void>> = [];
    for (const index of this.indexes) {
      const current = schema[index.field]?.data_type;
      if (current === index.type) {
        this.states.set(index.field, 'ready');
      } else if (current !== undefined) {
        this.states.set(index.field, 'conflict');
        log.error(
          {
            collectionName,
            field: index.field,
            expected: index.type,
            actual: current,
          },
          'System payload index field already has another index type; leaving it unchanged (what needs it stays unavailable or falls back)',
        );
      } else {
        this.states.set(index.field, 'building');
        builds.push(this.build(client, collectionName, index, logger));
      }
    }
    this.settled = Promise.all(builds).then(() => undefined);
  }

  /** @returns A promise that settles once every background build has ended. */
  whenSettled(): Promise<void> {
    return this.settled;
  }

  /**
   * Whether `field` has a ready keyword index: a system field once its
   * build returned; any other field (e.g. `source`) when the startup schema
   * had a keyword index on it.
   *
   * @param field - Payload field.
   * @returns True when a by-filter write on `field` may be used.
   */
  keywordIndexReady(field: string): boolean {
    const state = this.states.get(field);
    if (state !== undefined) {
      return state === 'ready' && this.typeOf(field) === 'keyword';
    }
    return this.keywordFields.has(field);
  }

  /**
   * @param field - A system index field.
   * @returns Its state, or undefined before {@link start} (or for a field
   *   that is not a system index).
   */
  state(field: string): SystemIndexState | undefined {
    return this.states.get(field);
  }

  /** @returns Each system index's state (empty before {@link start}). */
  snapshot(): Record<string, SystemIndexState> {
    return Object.fromEntries(this.states);
  }

  private typeOf(field: string): SystemIndex['type'] | undefined {
    return this.indexes.find((i) => i.field === field)?.type;
  }

  /** One background `wait=true` creation. */
  private async build(
    client: SystemIndexClient,
    collectionName: string,
    index: SystemIndex,
    logger?: pino.Logger,
  ): Promise<void> {
    const log = errorLogger(logger);
    try {
      await client.createPayloadIndex(collectionName, {
        field_name: index.field,
        field_schema: index.type,
        wait: true,
      });
      this.states.set(index.field, 'ready');
      logger?.info(
        { collectionName, field: index.field, type: index.type },
        'System payload index ready',
      );
    } catch (error) {
      // A client timeout can end the call while Qdrant finishes the build.
      const schema = await readSchema(client, collectionName).catch(
        (): PayloadSchema => ({}),
      );
      const created = schema[index.field]?.data_type === index.type;
      this.states.set(index.field, created ? 'ready' : 'failed');
      log.error(
        { collectionName, field: index.field, err: normalizeError(error) },
        created
          ? 'System payload index call failed, but the index exists; using it'
          : 'System payload index creation failed; what needs it stays unavailable (or falls back) until the next start',
      );
    }
  }
}

/** Error-level logging through pino, or the console fallback's warn. */
function errorLogger(logger?: pino.Logger): {
  error: (obj: Record<string, unknown>, msg: string) => void;
} {
  if (logger)
    return {
      error: (obj, msg) => {
        logger.error(obj, msg);
      },
    };
  const fallback = getLogger();
  return {
    error: (obj, msg) => {
      fallback.warn(obj, msg);
    },
  };
}

/**
 * Read a collection's payload schema (field to its index info).
 *
 * @param client - Qdrant client.
 * @param collectionName - Collection.
 * @returns The payload schema.
 */
export async function readSchema(
  client: Pick<SystemIndexClient, 'getCollection'>,
  collectionName: string,
): Promise<PayloadSchema> {
  const info = await client.getCollection(collectionName);
  return info.payload_schema;
}
