/**
 * @module api/indexCheck.test
 * The `health.indexCheck` schema (D197): its whole shape is required, the five states only, and nullable end time and duration.
 */

import { describe, expect, it } from 'vitest';

import { indexCheckHealthSchema } from './indexCheck';
import { watcherHealthSchema } from './monitoring';

const pending = {
  state: 'pending',
  at: null,
  durationMs: null,
  checked: 0,
  removed: 0,
  skippedRoots: 0,
  capped: 0,
};

describe('indexCheckHealthSchema', () => {
  it('accepts a pending snapshot and a finished one', () => {
    expect(indexCheckHealthSchema.parse(pending)).toEqual(pending);
    const done = {
      ...pending,
      state: 'done',
      at: '2026-11-05T00:00:00.000Z',
      durationMs: 1234,
      checked: 333_000,
      removed: 12,
      skippedRoots: 1,
      capped: 1,
    };
    expect(indexCheckHealthSchema.parse(done)).toEqual(done);
  });

  it('accepts only the five states', () => {
    for (const state of ['pending', 'running', 'done', 'failed', 'off']) {
      expect(
        indexCheckHealthSchema.safeParse({ ...pending, state }).success,
      ).toBe(true);
    }
    expect(
      indexCheckHealthSchema.safeParse({ ...pending, state: 'skipped' })
        .success,
    ).toBe(false);
  });

  it('rejects a missing field', () => {
    const partial: Partial<typeof pending> = { ...pending };
    delete partial.capped;
    expect(indexCheckHealthSchema.safeParse(partial).success).toBe(false);
  });

  it('is declared on watcherHealthSchema (D122)', () => {
    const health = watcherHealthSchema.parse({ indexCheck: pending });
    expect(health.indexCheck).toEqual(pending);
  });
});
