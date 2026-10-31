/**
 * @module api/healthTypes.test
 * The trackers' status types are watcher-core's `GET /status` health schema types; at run time, real tracker output parses unchanged against those schemas (`reindexStatusSchema`, `initialScanStatusSchema`).
 */

import {
  initialScanStatusSchema,
  reindexStatusSchema,
} from '@karmaniverous/jeeves-watcher-core';
import { describe, expect, it } from 'vitest';

import { InitialScanTracker } from './InitialScanTracker';
import { ReindexTracker } from './ReindexTracker';

describe('tracker status output', () => {
  it('reindex tracker output parses unchanged', () => {
    const tracker = new ReindexTracker();
    tracker.start('full');
    tracker.setTotal(3);
    const status = tracker.getStatus();
    expect(reindexStatusSchema.parse(status)).toEqual(status);
  });

  it('initial-scan tracker output parses unchanged', () => {
    const tracker = new InitialScanTracker();
    tracker.start();
    tracker.setMatched(2);
    tracker.incrementEnqueued();
    tracker.complete();
    const status = tracker.getStatus();
    expect(initialScanStatusSchema.parse(status)).toEqual(status);
  });
});
