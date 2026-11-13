/**
 * @module uiHints
 * The `uiHint` vocabulary of rule schema properties (spec D206 (2)): the hints the service understands, which ones `listFacets` fills with recorded values, which ones `countFacets` answers with a range, and the hint of an `enum` without one. The single definition; pure, no I/O.
 *
 * @remarks
 * A property declaring a `uiHint` or an `enum` is a facet field. Any other
 * hint string still loads (the service logs a warning), and is answered as
 * {@link OTHER_UI_HINTS} are: no recorded values, value counts.
 */

/**
 * Hints that pick from a list of values: `listFacets` returns the values
 * recorded per rule when the property declares no `enum`, and
 * `countFacets` counts each value.
 */
export const ENUMERATED_UI_HINTS = [
  'dropdown',
  'tags',
  'select',
  'multiselect',
] as const;

/** Hints over an ordered field: `countFacets` answers `{ min, max }`. */
export const RANGE_UI_HINTS = ['number', 'date', 'range'] as const;

/**
 * Hints with neither recorded values nor a range: `listFacets` returns no
 * values, and `countFacets` counts each value.
 */
export const OTHER_UI_HINTS = ['text', 'check'] as const;

/** Every hint the service understands, in documentation order. */
export const UI_HINTS = [
  ...ENUMERATED_UI_HINTS,
  ...RANGE_UI_HINTS,
  ...OTHER_UI_HINTS,
] as const;

/** A `uiHint` the service understands. */
export type UiHint = (typeof UI_HINTS)[number];

/** A hint `listFacets` fills with recorded values. */
export type EnumeratedUiHint = (typeof ENUMERATED_UI_HINTS)[number];

/** The hint of a property that declares an `enum` and no `uiHint`. */
export const DEFAULT_ENUM_UI_HINT: EnumeratedUiHint = 'dropdown';

/** Membership in a hint list, for any string. */
function inList(list: readonly string[], hint: string): boolean {
  return list.includes(hint);
}

/**
 * Whether a hint is one the service understands.
 *
 * @param hint - A `uiHint` value.
 * @returns True for a member of {@link UI_HINTS}.
 */
export function isUiHint(hint: string): hint is UiHint {
  return inList(UI_HINTS, hint);
}

/**
 * Whether `listFacets` fills a field with this hint with recorded values.
 *
 * @param hint - A `uiHint` value.
 * @returns True for a member of {@link ENUMERATED_UI_HINTS}.
 */
export function isEnumeratedUiHint(hint: string): boolean {
  return inList(ENUMERATED_UI_HINTS, hint);
}

/**
 * Whether `countFacets` answers a field with this hint with a range.
 *
 * @param hint - A `uiHint` value.
 * @returns True for a member of {@link RANGE_UI_HINTS}.
 */
export function isRangeUiHint(hint: string): boolean {
  return inList(RANGE_UI_HINTS, hint);
}
