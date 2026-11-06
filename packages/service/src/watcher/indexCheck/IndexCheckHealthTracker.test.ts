/**
 * @module watcher/indexCheck/IndexCheckHealthTracker.test
 * `health.indexCheck` (D197): pending before the start walk ends, off when disabled, running, then done or failed with the end time, duration and counts.
 */

import { indexCheckHealthSchema } from '@karmaniverous/jeeves-watcher-core';
import { describe, expect, it } from 'vitest';

import { IndexCheckHealthTracker } from './IndexCheckHealthTracker';

const zero = { checked: 0, removed: 0, skippedRoots: 0, capped: 0 };

describe('IndexCheckHealthTracker', () => {
  it('starts pending with nulls and zero counts', () => {
    const snapshot = new IndexCheckHealthTracker().snapshot();
    expect(snapshot).toEqual({
      state: 'pending',
      at: null,
      durationMs: null,
      ...zero,
    });
    expect(indexCheckHealthSchema.parse(snapshot)).toEqual(snapshot);
  });

  it('reports off', () => {
    const tracker = new IndexCheckHealthTracker();
    tracker.off();
    expect(tracker.snapshot()).toMatchObject({ state: 'off', at: null });
  });

  it('runs, then ends done with its end time, duration and counts', () => {
    const tracker = new IndexCheckHealthTracker();
    tracker.start(new Date('2026-11-05T00:00:00.000Z'));
    expect(tracker.snapshot()).toMatchObject({ state: 'running', at: null });
    const counts = { checked: 10, removed: 2, skippedRoots: 1, capped: 1 };
    tracker.finish('done', counts, new Date('2026-11-05T00:00:01.500Z'));
    const snapshot = tracker.snapshot();
    expect(snapshot).toEqual({
      state: 'done',
      at: '2026-11-05T00:00:01.500Z',
      durationMs: 1500,
      ...counts,
    });
    counts.removed = 99;
    expect(tracker.snapshot().removed).toBe(2);
    expect(indexCheckHealthSchema.parse(snapshot)).toEqual(snapshot);
  });

  it('ends failed, with a zero duration if it never started', () => {
    const tracker = new IndexCheckHealthTracker();
    tracker.finish('failed', zero, new Date('2026-11-05T00:00:00.000Z'));
    expect(tracker.snapshot()).toMatchObject({
      state: 'failed',
      durationMs: 0,
    });
  });
});
