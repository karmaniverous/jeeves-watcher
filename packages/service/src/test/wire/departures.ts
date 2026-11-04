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
  /**
   * Remove from the 0.20.0 record the keys the departure replaces (absent
   * when it only adds).
   */
  retire?: (expected: WireRecord) => WireRecord;
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

/** What B5a's `too_large` issue type appends to the issue-code description. */
const TOO_LARGE_DESCRIPTION =
  ', too_large (over a processing ceiling; its points were deleted)';

/**
 * Deep-copy `value`, removing `too_large` from every issue-code enum (one
 * that lists `type_collision`) and its clause from that enum's description.
 */
function stripTooLargeIssueType(value: Json, counter: { n: number }): Json {
  if (Array.isArray(value)) {
    return value.map((v) => stripTooLargeIssueType(v, counter));
  }
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = stripTooLargeIssueType(v, counter);
  }
  const { enum: values, description } = out;
  if (
    Array.isArray(values) &&
    values.includes('type_collision') &&
    values.includes('too_large')
  ) {
    out.enum = values.filter((v) => v !== 'too_large');
    counter.n++;
    if (
      typeof description === 'string' &&
      description.includes(TOO_LARGE_DESCRIPTION)
    ) {
      out.description = description.replace(TOO_LARGE_DESCRIPTION, '');
      counter.n++;
    }
  }
  return out;
}

/**
 * Strip the 0.21.0 additions from a config JSON schema. `GET /config/schema`
 * serves only the public keys; `watch` is one, and its `paths[].vcs`
 * override (D12) extends the whole `vcs` schema, so `maxFileBytes` appears
 * there (approved departure, D185). `logging.rotation`, `processing` and
 * `embedding.alertUrl` are not public and never appear. The merged
 * `issues[].type` enum gains `too_large` (B5a, Design 2).
 */
function stripNewConfigKeys(received: WireRecord): {
  record: WireRecord;
  stripped: number;
} {
  const counter = { n: 0 };
  const withoutKeys = stripSchemaProperty(
    received.body,
    'maxFileBytes',
    (p) => 'maxConsecutiveFailures' in p,
    counter,
  );
  const vcsStripped = counter.n;
  const body = stripTooLargeIssueType(withoutKeys, counter);
  // Both departures must still happen, or one of them is stale.
  const stripped = vcsStripped > 0 && counter.n > vcsStripped ? counter.n : 0;
  return { record: { ...received, body }, stripped };
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
    'P5 B2: watch.paths[].vcs gains maxFileBytes (D80 via the D12 per-root override), approved departure D185; P9 B5a: issues[].type gains too_large (D44), Design 2',
  strip: stripNewConfigKeys,
};

/**
 * `POST /vcs/exclude` writes `.git/info/exclude` and reports what it
 * untracked: `file` and `untracked` replace 0.20.0's `gitignorePath` (B4,
 * Design 2). The strip checks their values for the fixture (the root's
 * exclude file; nothing tracked matches `tmp/*.log`).
 */
const EXCLUDE_RESPONSE: WireDeparture = {
  reason:
    'P6 B4: POST /vcs/exclude answers { ok, file, action, untracked } (D54, D71), Design 2',
  strip: (received) => {
    const body = received.body as Record<string, Json>;
    if (body.file !== '{root}/.git/info/exclude' || body.untracked !== 0) {
      return { record: received, stripped: 0 };
    }
    const record = withoutKey(withoutKey(body, 'file'), 'untracked');
    return { record: { ...received, body: record }, stripped: 2 };
  },
  retire: (expected) => ({
    ...expected,
    body: withoutKey(expected.body as Record<string, Json>, 'gitignorePath'),
  }),
};

/** Approved departures by scenario name. */
export const WIRE_DEPARTURES: Partial<Record<string, WireDeparture>> = {
  status: {
    reason: 'P5 B2: GET /status health gains vcs (D86), Design 2',
    strip: stripHealthVcs,
  },
  configSchema: CONFIG_KEYS,
  'configSchema unknown query': CONFIG_KEYS,
  'vcsExclude add': EXCLUDE_RESPONSE,
  'vcsExclude add with root': EXCLUDE_RESPONSE,
  'vcsExclude unknown key': EXCLUDE_RESPONSE,
};
