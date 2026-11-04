/**
 * @module test/wire/wireRecord
 * Records every wire scenario's answer to the JSON file named by `WIRE_RECORD`. Not part of the test suite (the `.record.ts` suffix is outside vitest's include): `scripts/capture-wire-0.20.0.mjs` copies it into a worktree at tag `service/0.20.0` and runs it there. Writes one file.
 */

import { writeFileSync } from 'node:fs';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { WIRE_SCENARIOS, type WireRecord } from './scenarios';
import { startWireApp, type WireApp } from './wireApp';
import { runScenario } from './wireRun';

let wire: WireApp;

beforeAll(async () => {
  wire = await startWireApp();
}, 30_000);

afterAll(async () => {
  await wire.close();
});

it('records every scenario', async () => {
  const out = process.env.WIRE_RECORD;
  expect(out, 'set WIRE_RECORD to the output path').toBeTruthy();
  const records: Record<string, WireRecord> = {};
  for (const scenario of WIRE_SCENARIOS) {
    records[scenario.name] = await runScenario(wire, scenario);
  }
  writeFileSync(out as string, JSON.stringify(records, null, 2) + '\n');
}, 300_000);
