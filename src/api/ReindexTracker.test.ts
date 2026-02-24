import { describe, expect, it } from 'vitest';

import { ReindexTracker } from './ReindexTracker';

describe('ReindexTracker', () => {
  it('initial state is inactive', () => {
    const tracker = new ReindexTracker();
    expect(tracker.getStatus()).toEqual({ active: false });
  });

  it('start(rules) sets active state with scope and timestamp', () => {
    const tracker = new ReindexTracker();
    tracker.start('rules');
    const status = tracker.getStatus();
    expect(status.active).toBe(true);
    expect(status.scope).toBe('rules');
    expect(status.startedAt).toBeDefined();
    // Verify ISO 8601 format
    expect(new Date(status.startedAt!).toISOString()).toBe(status.startedAt);
  });

  it('start(full) sets scope to full', () => {
    const tracker = new ReindexTracker();
    tracker.start('full');
    expect(tracker.getStatus().scope).toBe('full');
  });

  it('complete() resets to inactive', () => {
    const tracker = new ReindexTracker();
    tracker.start('rules');
    tracker.complete();
    expect(tracker.getStatus()).toEqual({ active: false });
  });

  it('complete() without start is safe', () => {
    const tracker = new ReindexTracker();
    tracker.complete();
    expect(tracker.getStatus()).toEqual({ active: false });
  });
});
