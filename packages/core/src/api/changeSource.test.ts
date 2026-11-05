/**
 * @module api/changeSource.test
 * The `health.changeSource` schema (D133, D157): its whole shape is required, sources are chokidar or parcel, and nullable timestamps.
 */

import { describe, expect, it } from 'vitest';

import { changeSourceHealthSchema } from './changeSource';

const fresh = {
  source: 'chokidar',
  resubscribes: 0,
  unavailableRoots: 0,
  reconcileEvents: 0,
  reconcileErrors: 0,
  lastReconcileAt: null,
  lastReconcileDurationMs: null,
  pendingStability: 0,
  lastRenewDurationMs: null,
  renewFailures: 0,
};

describe('changeSourceHealthSchema', () => {
  it('accepts a fresh chokidar snapshot and a parcel one with values', () => {
    expect(changeSourceHealthSchema.parse(fresh)).toEqual(fresh);
    const parcel = {
      ...fresh,
      source: 'parcel',
      lastReconcileAt: '2026-11-05T00:00:00.000Z',
      lastReconcileDurationMs: 12,
      lastRenewDurationMs: 3,
    };
    expect(changeSourceHealthSchema.parse(parcel)).toEqual(parcel);
  });

  it('rejects an unknown source and a missing field', () => {
    expect(
      changeSourceHealthSchema.safeParse({ ...fresh, source: 'fs' }).success,
    ).toBe(false);
    const partial: Partial<typeof fresh> = { ...fresh };
    delete partial.pendingStability;
    expect(changeSourceHealthSchema.safeParse(partial).success).toBe(false);
  });
});
