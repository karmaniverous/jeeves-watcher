/**
 * @module test/wire/wireErrors
 * Records the 0.22.0 error overlay (spec 0.22.0 Design 5) to the file named by `WIRE_RECORD`: the answer to every scenario the 0.20.0 baseline recorded as an error, and to every 0.22.0 scenario (`scenarios022`). Not part of the test suite (the `.record.ts` suffix is outside vitest's include). Run from `packages/service` with `WIRE_RECORD_SUITE=wireErrors WIRE_RECORD=src/test/wire/wire-errors-0.22.0.json npx vitest run -c vitest.wire-record.config.mts`, then review the diff by hand. Writes one file.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { WIRE_SCENARIOS, type WireRecord } from './scenarios';
import { WIRE_SCENARIOS_022 } from './scenarios022';
import { startWireApp, type WireApp } from './wireApp';
import { runScenario } from './wireRun';

let wire: WireApp;

beforeAll(async () => {
  wire = await startWireApp();
}, 30_000);

afterAll(async () => {
  await wire.close();
});

it('records the error overlay', async () => {
  const out = process.env.WIRE_RECORD;
  expect(out, 'set WIRE_RECORD to the output path').toBeTruthy();
  const baseline = JSON.parse(
    readFileSync(new URL('./wire-0.20.0.json', import.meta.url), 'utf8'),
  ) as Record<string, WireRecord>;
  const scenarios = [
    ...WIRE_SCENARIOS.filter((s) => baseline[s.name].status >= 400),
    ...WIRE_SCENARIOS_022,
  ];
  const records: Record<string, WireRecord> = {};
  for (const scenario of scenarios) {
    records[scenario.name] = await runScenario(wire, scenario);
  }
  writeFileSync(out as string, JSON.stringify(records, null, 2) + '\n');
}, 300_000);
