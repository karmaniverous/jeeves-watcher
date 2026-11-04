/**
 * @module api/wireBaseline.test
 * Wire baseline for every catalog route: every scenario in `test/wire/scenarios` is replayed through the real server and must match what jeeves-watcher 0.20.0 sent (`test/wire/wire-0.20.0.json`), apart from the documented changes listed here.
 *
 * Documented changes: request-validation 400s, which the catalog now
 * produces (`test/wire/wire-catalog-400.json`): still `400 invalid_request`,
 * but `error` is the first issue's message and `details` lists catalog
 * issues (`slot`, `path`, `code`, `message`, `params`); and the approved
 * 0.21.0 departures (`test/wire/departures`), each stripped from the
 * received record before the comparison.
 */

import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { captureLogger, RESPONSE_MISMATCH } from '../test/wire/captureLogger';
import { WIRE_DEPARTURES } from '../test/wire/departures';
import { WIRE_SCENARIOS, type WireRecord } from '../test/wire/scenarios';
import { startWireApp, type WireApp } from '../test/wire/wireApp';
import { runScenario } from '../test/wire/wireRun';

const baseline = JSON.parse(
  readFileSync(
    new URL('../test/wire/wire-0.20.0.json', import.meta.url),
    'utf8',
  ),
) as Record<string, WireRecord>;

const catalog400 = JSON.parse(
  readFileSync(
    new URL('../test/wire/wire-catalog-400.json', import.meta.url),
    'utf8',
  ),
) as Record<string, WireRecord>;

/**
 * Documented wire changes, keyed by scenario: the expected record replaces
 * the baseline one. Each is a request-validation failure that was already a
 * `400 invalid_request`; only the body's `error` text and `details` change.
 */
const CHANGES: Partial<Record<string, (before: WireRecord) => WireRecord>> =
  Object.fromEntries(
    Object.entries(catalog400).map(([name, after]) => [
      name,
      (before: WireRecord) => {
        expect(before.status).toBe(400);
        expect(before.body).toMatchObject({ code: 'invalid_request' });
        return after;
      },
    ]),
  );

let wire: WireApp;
const captured = captureLogger();

beforeAll(async () => {
  wire = await startWireApp(captured.logger);
}, 30_000);

afterAll(async () => {
  await wire.close();
});

describe('catalog routes keep the 0.20.0 wire format', () => {
  it('has a baseline for every scenario and no stale ones', () => {
    expect(Object.keys(baseline).sort()).toEqual(
      WIRE_SCENARIOS.map((s) => s.name).sort(),
    );
  });

  it('documents changes only for known scenarios', () => {
    for (const name of [
      ...Object.keys(catalog400),
      ...Object.keys(WIRE_DEPARTURES),
    ]) {
      expect(baseline).toHaveProperty([name]);
    }
  });

  it.each(WIRE_SCENARIOS.map((s) => [s.name, s] as const))(
    '%s',
    async (name, scenario) => {
      const before = baseline[name];
      const expected = CHANGES[name]?.(before) ?? before;
      const received = await runScenario(wire, scenario);
      const departure = WIRE_DEPARTURES[name];
      const { record, stripped } = departure?.strip(received) ?? {
        record: received,
        stripped: 1,
      };
      // A departure that strips nothing no longer happens: remove it.
      expect({ name, departureApplies: stripped > 0 }).toEqual({
        name,
        departureApplies: true,
      });
      expect(record).toEqual(expected);
    },
  );
});

describe('catalog response validation', () => {
  it('logs no response mismatch across every scenario', () => {
    const mismatches = captured.records.filter((r) =>
      r.msg.startsWith(RESPONSE_MISMATCH),
    );
    expect(mismatches).toEqual([]);
  });
});
