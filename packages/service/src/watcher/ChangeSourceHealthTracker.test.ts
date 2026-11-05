/**
 * @module watcher/ChangeSourceHealthTracker.test
 * `health.changeSource` in D133's whole shape (D157): zeros and nulls at start under chokidar, counters, unavailable roots, a fresh attach on rebuild, and the last exit for a restart (D196).
 */

import { changeSourceHealthSchema } from '@karmaniverous/jeeves-watcher-core';
import { describe, expect, it } from 'vitest';

import { ChangeSourceHealthTracker } from './ChangeSourceHealthTracker';

describe('ChangeSourceHealthTracker', () => {
  it('starts with chokidar, zero counts and null timestamps', () => {
    const snapshot = new ChangeSourceHealthTracker().snapshot();
    expect(snapshot).toEqual({
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
      lastRestartCause: null,
      lastRestartAt: null,
    });
    expect(changeSourceHealthSchema.parse(snapshot)).toEqual(snapshot);
  });

  it('counts, times and reads the pending set live', () => {
    const tracker = new ChangeSourceHealthTracker();
    let pending = 3;
    tracker.attach('chokidar', () => pending);
    tracker.recordResubscribe();
    tracker.recordRenewFailure();
    tracker.recordReconcileEvents(2);
    tracker.recordReconcileEvents(1);
    tracker.recordReconcileError();
    tracker.recordReconcile(42, new Date('2026-11-05T01:02:03.000Z'));
    tracker.setUnavailable('/a', true);
    tracker.setUnavailable('/a', true);
    tracker.setUnavailable('/b', true);
    tracker.setUnavailable('/b', false);
    pending = 5;
    expect(tracker.snapshot()).toEqual({
      source: 'chokidar',
      resubscribes: 1,
      unavailableRoots: 1,
      reconcileEvents: 3,
      reconcileErrors: 1,
      lastReconcileAt: '2026-11-05T01:02:03.000Z',
      lastReconcileDurationMs: 42,
      pendingStability: 5,
      lastRenewDurationMs: null,
      renewFailures: 1,
      lastRestartCause: null,
      lastRestartAt: null,
    });
  });

  it('reports the exit for a restart this process started after, across a re-attach (D196)', () => {
    const tracker = new ChangeSourceHealthTracker();
    tracker.recordRestart({
      cause: 'subscription-error',
      at: '2026-11-05T16:00:00.000Z',
    });
    tracker.attach('parcel', () => 0);
    const snapshot = tracker.snapshot();
    expect(snapshot).toMatchObject({
      lastRestartCause: 'subscription-error',
      lastRestartAt: '2026-11-05T16:00:00.000Z',
    });
    expect(changeSourceHealthSchema.parse(snapshot)).toEqual(snapshot);
  });

  it('keeps counters across a re-attach but forgets unavailable roots', () => {
    const tracker = new ChangeSourceHealthTracker();
    tracker.recordReconcileEvents(4);
    tracker.setUnavailable('/a', true);
    tracker.attach('chokidar', () => 0);
    expect(tracker.snapshot()).toMatchObject({
      reconcileEvents: 4,
      unavailableRoots: 0,
    });
  });
});
