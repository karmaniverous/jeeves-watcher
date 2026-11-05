/**
 * @module api/catalog/countFacetsPlan
 * What `countFacets` asks Qdrant (spec Design 12, D96, D123, D155): each field's mode (value counts or a range) from its uiHint when every in-scope rule declaring it agrees, else from its payload index type; a `400` for fields without a usable index; and the count filter (caller filter, rule scope and `chunk_index = 0` nested under `must`, so a caller's top-level `should` keeps its meaning). Pure.
 */

import {
  FIELD_CHUNK_INDEX,
  FIELD_MATCHED_RULES,
  FIELD_SOURCE_RULE,
} from '../../processor/payloadFields';
import { invalidRequest } from '../requestError';
import { DEFAULT_ENUM_HINT, type RuleSchema } from './ruleSchemas';

/** How a field is answered: value counts, or `{ min, max }`. */
export type FacetMode = 'counts' | 'range';

/** One field to answer, and how. */
export interface FieldPlan {
  /** Payload field. */
  field: string;
  /** Value counts or a range. */
  mode: FacetMode;
}

/** uiHints answered with a range (all other hints get value counts). */
const RANGE_HINTS = new Set(['number', 'date', 'range']);

/** Payload index types Qdrant can count values on. */
const COUNT_INDEX_TYPES = new Set(['keyword', 'integer', 'bool']);

/** Payload index types an ordered scroll can read a range from. */
const RANGE_INDEX_TYPES = new Set(['integer', 'float', 'datetime']);

/** Index types each mode needs, as listed in the 400. */
const NEEDED: Record<FacetMode, string> = {
  counts: 'keyword, integer or bool',
  range: 'integer, float or datetime',
};

/**
 * The hint every rule declaring `field` gives it (`enum` without a uiHint
 * counts as `dropdown`), or undefined when none declares it, one declares
 * it without a hint, or the hints disagree.
 *
 * @param field - Payload field.
 * @param rules - In-scope rule schemas.
 * @returns The agreed hint, or undefined.
 */
export function agreedHint(
  field: string,
  rules: readonly RuleSchema[],
): string | undefined {
  const hints = new Set<string | undefined>();
  for (const { properties } of rules) {
    const prop = properties[field] as (typeof properties)[string] | undefined;
    if (!prop) continue;
    hints.add(
      prop.uiHint ?? (prop.enum !== undefined ? DEFAULT_ENUM_HINT : undefined),
    );
  }
  return hints.size === 1 ? [...hints][0] : undefined;
}

/**
 * Decide each field's mode and check it has a usable payload index.
 *
 * @param fields - Requested fields (duplicates are planned once).
 * @param rules - In-scope rule schemas (for uiHints).
 * @param indexTypes - Payload index type by field.
 * @returns The plan, in request order.
 * @throws A `400 invalid_request` naming every field without a usable index.
 */
export function planFields(
  fields: readonly string[],
  rules: readonly RuleSchema[],
  indexTypes: Readonly<Record<string, string>>,
): FieldPlan[] {
  const plans: FieldPlan[] = [];
  const unusable: Record<string, { mode: FacetMode; index: string | null }> =
    {};
  for (const field of new Set(fields)) {
    const index = (indexTypes[field] as string | undefined) ?? null;
    const hint = agreedHint(field, rules);
    const mode: FacetMode =
      hint !== undefined
        ? RANGE_HINTS.has(hint)
          ? 'range'
          : 'counts'
        : index !== null &&
            RANGE_INDEX_TYPES.has(index) &&
            !COUNT_INDEX_TYPES.has(index)
          ? 'range'
          : 'counts';
    const usable =
      index !== null &&
      (mode === 'range' ? RANGE_INDEX_TYPES : COUNT_INDEX_TYPES).has(index);
    if (usable) plans.push({ field, mode });
    else unusable[field] = { mode, index };
  }
  const names = Object.keys(unusable);
  if (names.length > 0) {
    throw invalidRequest(
      `No usable payload index for field${names.length === 1 ? '' : 's'}: ${names.join(', ')}`,
      {
        message: `Value counts need a ${NEEDED.counts} payload index; a range needs ${NEEDED.range}. Configure them in vectorStore.payloadIndexes.`,
        details: { fields: unusable },
      },
    );
  }
  return plans;
}

/**
 * The filter facet counts run on: the caller's filter, the rule scope (a
 * file document's `matched_rules` or a source document's `source_rule`)
 * and `chunk_index = 0`, each nested under `must`.
 *
 * @param filter - Caller's Qdrant filter.
 * @param rules - Rule names scoping the count.
 * @returns The Qdrant filter.
 */
export function countFilter(
  filter?: Record<string, unknown>,
  rules?: readonly string[],
): Record<string, unknown> {
  const must: Array<Record<string, unknown>> = [];
  if (filter) must.push(filter);
  if (rules) {
    must.push({
      should: [
        { key: FIELD_MATCHED_RULES, match: { any: [...rules] } },
        { key: FIELD_SOURCE_RULE, match: { any: [...rules] } },
      ],
    });
  }
  must.push({ key: FIELD_CHUNK_INDEX, match: { value: 0 } });
  return { must };
}
