/**
 * @module filters
 * Filter helpers `f`: optional sugar producing native Qdrant filter objects (eq, any, range, isEmpty, and, or, not), merging nested filters where the logic allows. Pure.
 */

import type { QdrantFilter } from '@karmaniverous/jeeves-watcher-core';

/** A scalar matched exactly by {@link f.eq}. */
export type MatchValue = string | number | boolean;

/** Range bounds for {@link f.range}: numbers, or RFC 3339 strings for datetime-indexed fields. */
export interface RangeBounds {
  /** Greater than. */
  gt?: number | string;
  /** Greater than or equal. */
  gte?: number | string;
  /** Less than. */
  lt?: number | string;
  /** Less than or equal. */
  lte?: number | string;
}

type Clause = 'must' | 'should' | 'must_not';
const CLAUSES: readonly Clause[] = ['must', 'should', 'must_not'];

/**
 * The single clause of a filter whose only key is that clause, with its
 * conditions; `undefined` for anything else (mixed clauses, `min_should`, …).
 */
function soleClause(
  filter: QdrantFilter,
): { clause: Clause; conditions: unknown[] } | undefined {
  const keys = Object.keys(filter);
  if (keys.length !== 1) return undefined;
  const clause = CLAUSES.find((c) => c === keys[0]);
  const conditions = clause === undefined ? undefined : filter[clause];
  if (clause === undefined || !Array.isArray(conditions)) return undefined;
  return { clause, conditions: conditions as unknown[] };
}

const single = (condition: Record<string, unknown>): QdrantFilter => ({
  must: [condition],
});

/** A filter that is a single positive condition: returns that condition. */
function asCondition(filter: QdrantFilter): unknown {
  const sole = soleClause(filter);
  return sole?.clause === 'must' && sole.conditions.length === 1
    ? sole.conditions[0]
    : filter;
}

/**
 * AND: merges `must` and `must_not` lists (both are conjunctive), hoists the
 * first `should`-only operand, and nests anything else as a condition.
 */
function and(...filters: QdrantFilter[]): QdrantFilter {
  const must: unknown[] = [];
  const mustNot: unknown[] = [];
  let should: unknown[] | undefined;
  for (const filter of filters) {
    const sole = soleClause(filter);
    if (sole?.clause === 'must') must.push(...sole.conditions);
    else if (sole?.clause === 'must_not') mustNot.push(...sole.conditions);
    else if (sole?.clause === 'should' && should === undefined) {
      should = sole.conditions;
    } else must.push(filter);
  }
  return {
    ...(must.length > 0 ? { must } : {}),
    ...(should === undefined ? {} : { should }),
    ...(mustNot.length > 0 ? { must_not: mustNot } : {}),
  };
}

/** OR: merges `should` lists, unwraps single conditions, nests the rest. */
function or(...filters: QdrantFilter[]): QdrantFilter {
  const should: unknown[] = [];
  for (const filter of filters) {
    const sole = soleClause(filter);
    if (sole?.clause === 'should') should.push(...sole.conditions);
    else should.push(asCondition(filter));
  }
  return { should };
}

/**
 * NOT: `not(any of xs)` becomes `must_not: xs`; a single negated condition
 * becomes `must`; `not(none of xs)` becomes `should: xs`; else nested.
 */
function not(filter: QdrantFilter): QdrantFilter {
  const sole = soleClause(filter);
  if (sole?.clause === 'should') return { must_not: sole.conditions };
  if (sole?.clause === 'must_not') {
    return sole.conditions.length === 1
      ? { must: sole.conditions }
      : { should: sole.conditions };
  }
  return { must_not: [asCondition(filter)] };
}

/**
 * Filter helpers. Each returns a native Qdrant filter, usable directly as
 * `filter` in `search`, `scan` or `documents.delete`, or as an operand of
 * `and` / `or` / `not`.
 *
 * @example
 * ```ts
 * f.and(f.eq('type', 'chat_history'), f.eq('user_id', uid));
 * // { must: [{ key: 'type', match: { value: 'chat_history' } }, { key: 'user_id', match: { value: uid } }] }
 * ```
 */
export const f = {
  /**
   * Exact match.
   *
   * @param key - Payload field.
   * @param value - Value to match.
   * @returns `{ must: [{ key, match: { value } }] }`.
   */
  eq: (key: string, value: MatchValue): QdrantFilter =>
    single({ key, match: { value } }),
  /**
   * Match any of the values.
   *
   * @param key - Payload field.
   * @param values - Candidate values.
   * @returns `{ must: [{ key, match: { any: values } }] }`.
   */
  any: (key: string, values: readonly (string | number)[]): QdrantFilter =>
    single({ key, match: { any: [...values] } }),
  /**
   * Range condition.
   *
   * @param key - Payload field (numeric, or datetime-indexed with string bounds).
   * @param bounds - Any of `gt`, `gte`, `lt`, `lte`.
   * @returns `{ must: [{ key, range: bounds }] }`.
   */
  range: (key: string, bounds: RangeBounds): QdrantFilter =>
    single({ key, range: { ...bounds } }),
  /**
   * Field is missing, null or an empty array.
   *
   * @param key - Payload field.
   * @returns `{ must: [{ is_empty: { key } }] }`.
   */
  isEmpty: (key: string): QdrantFilter => single({ is_empty: { key } }),
  /** All operands must match. */
  and,
  /** At least one operand must match. */
  or,
  /** The operand must not match. */
  not,
} as const;
