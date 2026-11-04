/**
 * @module test/wire/departures
 * Approved 0.21.0 wire departures (spec Design 2), by scenario: each removes from a received record exactly what its spec item added, so the rest must still match the 0.20.0 baseline. Pure.
 *
 * A departure fails when the key it strips is absent, so a departure that
 * no longer happens is noticed and removed.
 */

import type { WireRecord } from './scenarios';

/** One approved departure. */
export interface WireDeparture {
  /** Spec item and decision that approve it. */
  reason: string;
  /**
   * Remove the departure's additions from a received record.
   *
   * @returns The record as 0.20.0 would have sent it, and how many keys
   *   were stripped (at least one, or the departure is stale).
   */
  strip: (received: WireRecord) => { record: WireRecord; stripped: number };
}

type Json = unknown;

/** A shallow copy of `record` without `key`. */
function withoutKey(
  record: Record<string, Json>,
  key: string,
): Record<string, Json> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

/**
 * Deep-copy `value`, deleting `properties[key]` from every JSON-schema
 * object whose `properties` satisfy `where`.
 */
function stripSchemaProperty(
  value: Json,
  key: string,
  where: (properties: Record<string, Json>) => boolean,
  counter: { n: number },
): Json {
  if (Array.isArray(value)) {
    return value.map((v) => stripSchemaProperty(v, key, where, counter));
  }
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = stripSchemaProperty(v, key, where, counter);
  }
  const properties = out.properties;
  if (
    typeof properties === 'object' &&
    properties !== null &&
    key in properties &&
    where(properties as Record<string, Json>)
  ) {
    out.properties = withoutKey(properties as Record<string, Json>, key);
    const required = out.required;
    if (Array.isArray(required))
      out.required = required.filter((r) => r !== key);
    counter.n++;
  }
  return out;
}

/** Strip the 0.21.0 config keys added so far from a config JSON schema. */
function stripNewConfigKeys(received: WireRecord): {
  record: WireRecord;
  stripped: number;
} {
  const counter = { n: 0 };
  let body = stripSchemaProperty(
    received.body,
    'maxFileBytes',
    (p) => 'maxConsecutiveFailures' in p,
    counter,
  );
  body = stripSchemaProperty(
    body,
    'rotation',
    (p) => 'file' in p && 'level' in p,
    counter,
  );
  return { record: { ...received, body }, stripped: counter.n };
}

/** Strip `health.vcs` from a `/status` record. */
function stripHealthVcs(received: WireRecord): {
  record: WireRecord;
  stripped: number;
} {
  const body = received.body as { health?: Record<string, Json> };
  if (!body.health || !('vcs' in body.health)) {
    return { record: received, stripped: 0 };
  }
  const health = withoutKey(body.health, 'vcs');
  return { record: { ...received, body: { ...body, health } }, stripped: 1 };
}

const CONFIG_KEYS: WireDeparture = {
  reason:
    'P5 B2/B3: config schema gains vcs.maxFileBytes (D80) and logging.rotation (D171), Design 10',
  strip: stripNewConfigKeys,
};

/** Approved departures by scenario name. */
export const WIRE_DEPARTURES: Partial<Record<string, WireDeparture>> = {
  status: {
    reason: 'P5 B2: GET /status health gains vcs (D86), Design 2',
    strip: stripHealthVcs,
  },
  configSchema: CONFIG_KEYS,
  'configSchema unknown query': CONFIG_KEYS,
};
