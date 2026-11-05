/**
 * @module vectorStore/facets
 * Qdrant reads behind `countFacets` (spec Design 12): approximate facet counts (D194), one-point ordered scrolls for a field's range, and the collection's payload index types. Every count and scroll passes Qdrant's `timeout` (whole seconds) so an abandoned call also stops in Qdrant. Qdrant I/O.
 */

import type { QdrantClient } from '@qdrant/js-client-rest';

import { readSchema, type SystemIndexState } from './systemIndexes';

/** A facet value as Qdrant reports it. */
export type FacetValue = string | number | boolean;

/** One counted value. */
export interface FacetHit {
  /** The payload value. */
  value: FacetValue;
  /** Points holding it. */
  count: number;
}

/** Which end of a range an ordered scroll reads. */
export type RangeEnd = 'min' | 'max';

/** A range bound: a number, a stored date string, or null when nothing matched. */
export type RangeBound = number | string | null;

/** One facet count or range read: field, filter and Qdrant timeout. */
export interface FacetRead {
  /** Payload field. */
  field: string;
  /** Qdrant filter (already scoped by the caller). */
  filter: Record<string, unknown>;
  /** Qdrant `timeout` query parameter, whole seconds. */
  timeoutS: number;
}

/** Facet reads used by `countFacets` (`VectorStoreClient.facets`). */
export interface FacetStore {
  /**
   * Approximate value counts of a field, highest first (D194).
   *
   * @param read - Field, filter and timeout.
   * @param limit - Most values returned.
   * @returns The counted values.
   */
  facetCounts(read: FacetRead, limit: number): Promise<FacetHit[]>;

  /**
   * One end of a field's range over the filter.
   *
   * @param read - Field, filter and timeout.
   * @param end - `min` or `max`.
   * @returns The bound, or null when no point holds the field.
   */
  rangeBound(read: FacetRead, end: RangeEnd): Promise<RangeBound>;

  /** @returns Payload index type by field (`keyword`, `integer`, ...). */
  payloadIndexTypes(): Promise<Record<string, string>>;

  /**
   * @param field - A system index field (`chunk_index`, `matched_rules`).
   * @returns Its state, or undefined before startup.
   */
  systemIndexState(field: string): SystemIndexState | undefined;
}

/** The subset of the Qdrant client used here. */
export type FacetClient = Pick<
  QdrantClient,
  'facet' | 'scroll' | 'getCollection'
>;

/** {@link FacetStore} over one Qdrant collection (`VectorStoreClient.facets`). */
export class QdrantFacetStore implements FacetStore {
  /**
   * @param client - Qdrant client.
   * @param collectionName - Collection.
   * @param indexState - System index state by field.
   */
  constructor(
    private readonly client: FacetClient,
    private readonly collectionName: string,
    private readonly indexState: (
      field: string,
    ) => SystemIndexState | undefined,
  ) {}

  /** {@inheritDoc FacetStore.facetCounts} */
  facetCounts(read: FacetRead, limit: number): Promise<FacetHit[]> {
    return facetCounts(this.client, this.collectionName, read, limit);
  }

  /** {@inheritDoc FacetStore.rangeBound} */
  rangeBound(read: FacetRead, end: RangeEnd): Promise<RangeBound> {
    return rangeBound(this.client, this.collectionName, read, end);
  }

  /** {@inheritDoc FacetStore.payloadIndexTypes} */
  payloadIndexTypes(): Promise<Record<string, string>> {
    return payloadIndexTypes(this.client, this.collectionName);
  }

  /** {@inheritDoc FacetStore.systemIndexState} */
  systemIndexState(field: string): SystemIndexState | undefined {
    return this.indexState(field);
  }
}

/**
 * The collection's payload index types, by field.
 *
 * @param client - Qdrant client.
 * @param collectionName - Collection.
 * @returns Index type by field (fields without a type are left out).
 */
export async function payloadIndexTypes(
  client: Pick<FacetClient, 'getCollection'>,
  collectionName: string,
): Promise<Record<string, string>> {
  const schema = await readSchema(client, collectionName);
  return Object.fromEntries(
    Object.entries(schema).flatMap(([field, info]) =>
      info?.data_type ? [[field, info.data_type]] : [],
    ),
  );
}

/**
 * Approximate facet counts: Qdrant's default mode, asked for explicitly
 * (D194; exact counts failed the D104 latency gate).
 *
 * @param client - Qdrant client.
 * @param collectionName - Collection.
 * @param read - Field, filter and timeout.
 * @param limit - Most values returned.
 * @returns The counted values, highest first.
 */
export async function facetCounts(
  client: Pick<FacetClient, 'facet'>,
  collectionName: string,
  read: FacetRead,
  limit: number,
): Promise<FacetHit[]> {
  const { hits } = await client.facet(collectionName, {
    key: read.field,
    filter: read.filter,
    limit,
    exact: false,
    timeout: read.timeoutS,
  });
  return hits.map(({ value, count }) => ({ value, count }));
}

/**
 * One end of a field's range: a one-point scroll ordered by the field
 * (an index lookup on its range-capable payload index).
 *
 * @param client - Qdrant client.
 * @param collectionName - Collection.
 * @param read - Field, filter and timeout.
 * @param end - `min` (ascending) or `max` (descending).
 * @returns The bound, or null when no point matches.
 */
export async function rangeBound(
  client: Pick<FacetClient, 'scroll'>,
  collectionName: string,
  read: FacetRead,
  end: RangeEnd,
): Promise<RangeBound> {
  const { points } = await client.scroll(collectionName, {
    filter: read.filter,
    limit: 1,
    with_payload: [read.field],
    with_vector: false,
    order_by: { key: read.field, direction: end === 'min' ? 'asc' : 'desc' },
    timeout: read.timeoutS,
  });
  const point = points.at(0);
  if (!point) return null;
  const value = payloadValue(point.payload ?? {}, read.field);
  return extremeOf(value, end) ?? orderValue(point.order_value);
}

/**
 * A payload value by (possibly dotted) key. Pure.
 *
 * @param payload - Point payload.
 * @param key - Field, e.g. `meta.size`.
 * @returns The value, or undefined.
 */
function payloadValue(payload: Record<string, unknown>, key: string): unknown {
  if (key in payload) return payload[key];
  let current: unknown = payload;
  for (const part of key.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Sort key of a range value: the number, or a date string's time. */
function sortKey(value: number | string): number {
  return typeof value === 'number' ? value : Date.parse(value);
}

/**
 * The smallest (`min`) or largest (`max`) number or date string in a value
 * that may be an array (a multi-valued field). Pure.
 *
 * @param value - Payload value.
 * @param end - Which extreme.
 * @returns The extreme, or undefined when the value holds none.
 */
export function extremeOf(
  value: unknown,
  end: RangeEnd,
): number | string | undefined {
  const candidates = (Array.isArray(value) ? value : [value]).filter(
    (v): v is number | string =>
      typeof v === 'number' ||
      (typeof v === 'string' && !Number.isNaN(Date.parse(v))),
  );
  let best: number | string | undefined;
  for (const candidate of candidates) {
    if (
      best === undefined ||
      (end === 'min'
        ? sortKey(candidate) < sortKey(best)
        : sortKey(candidate) > sortKey(best))
    ) {
      best = candidate;
    }
  }
  return best;
}

/** Qdrant's `order_value` as a bound (a number), or null. */
function orderValue(value: unknown): RangeBound {
  return typeof value === 'number' ? value : null;
}
