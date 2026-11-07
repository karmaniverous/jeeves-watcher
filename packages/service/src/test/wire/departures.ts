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

/** The 0.20.0 `vcs.commitMessage.model` default (retired by Anthropic: #308). */
const RETIRED_COMMIT_MODEL = 'claude-haiku-4-0';

/** The 0.20.0 description of `vcs.commitMessage.model`. */
const RETIRED_COMMIT_MODEL_DESCRIPTION = `AI model for commit message generation. Default: "${RETIRED_COMMIT_MODEL}".`;

/**
 * Deep-copy `value`, restoring the 0.20.0 default and description of every
 * `vcs.commitMessage.model` schema (one whose description starts like it
 * and whose default is not the retired model).
 */
function restoreCommitMessageModel(value: Json, counter: { n: number }): Json {
  if (Array.isArray(value)) {
    return value.map((v) => restoreCommitMessageModel(v, counter));
  }
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = restoreCommitMessageModel(v, counter);
  }
  const { default: model, description } = out;
  if (
    typeof description === 'string' &&
    description.startsWith('AI model for commit message generation.') &&
    model !== RETIRED_COMMIT_MODEL
  ) {
    out.default = RETIRED_COMMIT_MODEL;
    out.description = RETIRED_COMMIT_MODEL_DESCRIPTION;
    counter.n++;
  }
  return out;
}

/**
 * Strip the 0.21.0 additions from a config JSON schema. `GET /config/schema`
 * serves only the public keys; `watch` is one, and its `paths[].vcs`
 * override (D12) extends the whole `vcs` schema, so `maxFileBytes` appears
 * there (approved departure, D185). `logging.rotation`, `processing` and
 * `embedding.alertUrl` are not public and never appear. The merged
 * `issues[].type` enum gains `too_large` (B5a, Design 2), and `watch` gains
 * `reconcileIntervalMs` (B5b, D111, Design 2), `changeSource` (C2, D125,
 * Design 2) and `indexCheckOnStart` (P13a, D197). After 0.21.0 the
 * `vcs.commitMessage.model` default (and its description) changes from the
 * retired `claude-haiku-4-0` to `claude-haiku-5-5` (#308).
 */
function stripNewConfigKeys(received: WireRecord): {
  record: WireRecord;
  stripped: number;
} {
  const counter = { n: 0 };
  const counts: number[] = [];
  /** Apply one strip, recording how many keys it removed. */
  const step = (strip: (value: Json) => Json, value: Json): Json => {
    const before = counter.n;
    const out = strip(value);
    counts.push(counter.n - before);
    return out;
  };
  const watchKey = (key: string) => (value: Json) =>
    stripSchemaProperty(
      value,
      key,
      (p) => 'stabilityThresholdMs' in p,
      counter,
    );
  let body = step(
    (value) =>
      stripSchemaProperty(
        value,
        'maxFileBytes',
        (p) => 'maxConsecutiveFailures' in p,
        counter,
      ),
    received.body,
  );
  for (const key of [
    'reconcileIntervalMs',
    'changeSource',
    'indexCheckOnStart',
  ]) {
    body = step(watchKey(key), body);
  }
  body = step((value) => stripTooLargeIssueType(value, counter), body);
  body = step((value) => restoreCommitMessageModel(value, counter), body);
  // Every departure must still happen, or one of them is stale.
  const stripped = counts.every((n) => n > 0) ? counter.n : 0;
  return { record: { ...received, body }, stripped };
}

/** The `health` keys 0.21.0 adds to `/status`. */
const NEW_HEALTH_KEYS = ['vcs', 'changeSource', 'indexCheck'];

/**
 * Strip `health.vcs`, `health.changeSource` and `health.indexCheck` from a
 * `/status` record; all must be present, or one departure is stale.
 */
function stripNewHealthKeys(received: WireRecord): {
  record: WireRecord;
  stripped: number;
} {
  const body = received.body as { health?: Record<string, Json> };
  const health = body.health;
  if (!health || !NEW_HEALTH_KEYS.every((key) => key in health)) {
    return { record: received, stripped: 0 };
  }
  const rest = NEW_HEALTH_KEYS.reduce(withoutKey, health);
  return {
    record: { ...received, body: { ...body, health: rest } },
    stripped: NEW_HEALTH_KEYS.length,
  };
}

const CONFIG_KEYS: WireDeparture = {
  reason:
    'P5 B2: watch.paths[].vcs gains maxFileBytes (D80 via the D12 per-root override), approved departure D185; P9 B5a: issues[].type gains too_large (D44); P11 B5b: watch gains reconcileIntervalMs (D111); P13 C2: watch gains changeSource (D125); P13a: watch gains indexCheckOnStart (D197), Design 2; #308: vcs.commitMessage.model default claude-haiku-5-5 (claude-haiku-4-0 retired)',
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
    reason:
      'P5 B2: GET /status health gains vcs (D86); P11 B5b: health gains changeSource (D133, D157); P13a: health gains indexCheck (D197), Design 2',
    strip: stripNewHealthKeys,
  },
  configSchema: CONFIG_KEYS,
  'configSchema unknown query': CONFIG_KEYS,
  'vcsExclude add': EXCLUDE_RESPONSE,
  'vcsExclude add with root': EXCLUDE_RESPONSE,
  'vcsExclude unknown key': EXCLUDE_RESPONSE,
};
