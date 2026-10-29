/**
 * @module api/wireBaseline.test
 * Wire baseline for the catalog slice routes: every scenario in `test/wire/scenarios` is replayed through the real server and must match what jeeves-watcher 0.20.0 sent (`test/wire/wire-0.20.0.json`), apart from the documented changes listed here.
 */

import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  runScenario,
  WIRE_SCENARIOS,
  type WireRecord,
} from '../test/wire/scenarios';
import { startWireApp, type WireApp } from '../test/wire/wireApp';

const baseline = JSON.parse(
  readFileSync(
    new URL('../test/wire/wire-0.20.0.json', import.meta.url),
    'utf8',
  ),
) as Record<string, WireRecord>;

/**
 * Documented wire changes, keyed by scenario: the expected record replaces
 * the baseline one. Empty until routes move to the catalog.
 */
const CHANGES: Partial<Record<string, (before: WireRecord) => WireRecord>> = {};

let wire: WireApp;

beforeAll(async () => {
  wire = await startWireApp();
}, 30_000);

afterAll(async () => {
  await wire.close();
});

describe('slice routes keep the 0.20.0 wire format', () => {
  it('has a baseline for every scenario and no stale ones', () => {
    expect(Object.keys(baseline).sort()).toEqual(
      WIRE_SCENARIOS.map((s) => s.name).sort(),
    );
  });

  it.each(WIRE_SCENARIOS.map((s) => [s.name, s] as const))(
    '%s',
    async (name, scenario) => {
      const before = baseline[name];
      const expected = CHANGES[name]?.(before) ?? before;
      expect(await runScenario(wire, scenario)).toEqual(expected);
    },
  );
});
