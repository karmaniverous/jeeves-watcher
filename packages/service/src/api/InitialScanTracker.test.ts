/**
 * @module api/InitialScanTracker.test
 * The initial-scan tracker's `GET /status` snapshot through its lifecycle (not started, scanning, complete), each parsed by watcher-core's `initialScanStatusSchema`.
 */

import { initialScanStatusSchema } from '@karmaniverous/jeeves-watcher-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InitialScanTracker } from './InitialScanTracker';

afterEach(() => {
  vi.useRealTimers();
});

describe('InitialScanTracker', () => {
  it('reports only inactive before the scan starts', () => {
    expect(new InitialScanTracker().getStatus()).toEqual({ active: false });
  });

  it('reports progress while scanning and the duration once complete', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const tracker = new InitialScanTracker();
    tracker.start();
    tracker.setMatched(3);
    tracker.incrementEnqueued();
    tracker.incrementEnqueued();

    const scanning = tracker.getStatus();
    expect(scanning).toEqual({
      active: true,
      filesMatched: 3,
      filesEnqueued: 2,
      startedAt: '2026-01-01T00:00:00.000Z',
    });

    vi.setSystemTime(new Date('2026-01-01T00:00:01.500Z'));
    tracker.complete();
    const done = tracker.getStatus();
    expect(done).toEqual({
      active: false,
      filesMatched: 3,
      filesEnqueued: 2,
      completedAt: '2026-01-01T00:00:01.500Z',
      durationMs: 1500,
    });

    for (const status of [scanning, done]) {
      expect(initialScanStatusSchema.parse(status)).toEqual(status);
    }
  });

  it('reports only inactive when completed without a start', () => {
    const tracker = new InitialScanTracker();
    tracker.complete();
    expect(tracker.getStatus()).toEqual({ active: false });
  });
});
