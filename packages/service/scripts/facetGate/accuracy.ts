/**
 * @module scripts/facetGate/accuracy
 * Approximate-count accuracy of the facet gate (spec D194): per field, Qdrant's approximate facet counts against its exact counts over the same filter. Pure.
 */

/** One counted value. */
export interface CountHit {
  /** The payload value. */
  value: string | number | boolean;
  /** Points holding it. */
  count: number;
}

/** How far a field's approximate counts are from its exact counts. */
export interface FieldAccuracy {
  /** Payload field. */
  field: string;
  /** Distinct values in the exact result. */
  exactValues: number;
  /** Distinct values in the approximate result. */
  approxValues: number;
  /** Largest `|approx - exact|` over the top values by exact count. */
  topMaxAbsError: number;
  /** Largest `|approx - exact| / exact` over the top values (0 to 1+). */
  topMaxRelError: number;
  /** Top values (by exact count) missing from the approximate result. */
  topMissing: string[];
  /** Share of values in both results whose counts differ (0 to 1). */
  differingShare: number;
  /** Values in the exact result only. */
  exactOnly: string[];
  /** Values in the approximate result only. */
  approxOnly: string[];
  /** Smallest exact count in the exact result (where its list was cut). */
  exactCutoff: number | null;
}

const key = (value: CountHit['value']) => `${typeof value}:${String(value)}`;

/**
 * Compare a field's approximate counts with its exact counts.
 *
 * @param field - Payload field.
 * @param exact - Exact counts, any order.
 * @param approx - Approximate counts, any order.
 * @param top - How many top values (by exact count) the error maxima cover.
 * @returns The field's accuracy.
 */
export function compareCounts(
  field: string,
  exact: readonly CountHit[],
  approx: readonly CountHit[],
  top = 10,
): FieldAccuracy {
  const approxBy = new Map(approx.map((h) => [key(h.value), h]));
  const exactBy = new Map(exact.map((h) => [key(h.value), h]));
  const ranked = [...exact].sort((a, b) => b.count - a.count);

  let topMaxAbsError = 0;
  let topMaxRelError = 0;
  const topMissing: string[] = [];
  for (const hit of ranked.slice(0, top)) {
    const other = approxBy.get(key(hit.value));
    if (!other) {
      topMissing.push(String(hit.value));
      continue;
    }
    const abs = Math.abs(other.count - hit.count);
    topMaxAbsError = Math.max(topMaxAbsError, abs);
    if (hit.count > 0) {
      topMaxRelError = Math.max(topMaxRelError, abs / hit.count);
    }
  }

  let shared = 0;
  let differing = 0;
  for (const hit of exact) {
    const other = approxBy.get(key(hit.value));
    if (!other) continue;
    shared++;
    if (other.count !== hit.count) differing++;
  }

  return {
    field,
    exactValues: exact.length,
    approxValues: approx.length,
    topMaxAbsError,
    topMaxRelError,
    topMissing,
    differingShare: shared === 0 ? 0 : differing / shared,
    exactOnly: exact
      .filter((h) => !approxBy.has(key(h.value)))
      .map((h) => String(h.value)),
    approxOnly: approx
      .filter((h) => !exactBy.has(key(h.value)))
      .map((h) => String(h.value)),
    exactCutoff: ranked.length > 0 ? ranked[ranked.length - 1].count : null,
  };
}

/**
 * Whether approximate counts stay within the gate's accuracy threshold (the
 * P10 stop condition, not a number D194 sets; D194 leaves materiality to the
 * owner): no top value missing and none off by more than `maxRel` relative.
 * Only the top values decide; error in less common values is reported by
 * {@link compareCounts} (`differingShare`, `exactOnly`, `approxOnly`) but not
 * bounded here.
 *
 * @param fields - Per-field accuracy.
 * @param maxRel - Largest acceptable relative error (default 5%).
 * @returns True when every field is within the bound.
 */
export function withinBound(
  fields: readonly FieldAccuracy[],
  maxRel = 0.05,
): boolean {
  return fields.every(
    (f) => f.topMissing.length === 0 && f.topMaxRelError <= maxRel,
  );
}
