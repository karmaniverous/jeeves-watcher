/**
 * @module api/healthTypes.test
 * The service's tracker status types match watcher-core's `GET /status` health schemas (`reindexStatusSchema`, `initialScanStatusSchema`), so the catalog's status response describes what the trackers report: type equality at compile time, and real tracker output parsing unchanged at run time.
 */

import {
  type InitialScanStatus as CoreInitialScanStatus,
  initialScanStatusSchema,
  type ReindexStatus as CoreReindexStatus,
  reindexStatusSchema,
} from '@karmaniverous/jeeves-watcher-core';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  type InitialScanStatus,
  InitialScanTracker,
} from './InitialScanTracker';
import { type ReindexStatus, ReindexTracker } from './ReindexTracker';

describe('tracker status types', () => {
  it('ReindexStatus equals the core schema type and parses unchanged', () => {
    expectTypeOf<ReindexStatus>().toEqualTypeOf<CoreReindexStatus>();
    const tracker = new ReindexTracker();
    tracker.start('full');
    tracker.setTotal(3);
    const status = tracker.getStatus();
    expect(reindexStatusSchema.parse(status)).toEqual(status);
  });

  it('InitialScanStatus equals the core schema type and parses unchanged', () => {
    expectTypeOf<InitialScanStatus>().toEqualTypeOf<CoreInitialScanStatus>();
    const tracker = new InitialScanTracker();
    tracker.start();
    tracker.setMatched(2);
    tracker.incrementEnqueued();
    tracker.complete();
    const status = tracker.getStatus();
    expect(initialScanStatusSchema.parse(status)).toEqual(status);
  });
});
