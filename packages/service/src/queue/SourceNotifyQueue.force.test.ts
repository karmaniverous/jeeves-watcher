/**
 * @module queue/SourceNotifyQueue.force.test
 * Source notify queue: `force` reaches process and merges as OR into a pending or dirty run; an unexpected process rejection records an `extraction_error` issue carrying the designated rule, a tagged one keeps its code and details (fake timers).
 */

import type { DocumentResult } from '@karmaniverous/jeeves-watcher-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProcessingFailure } from '../processor/issueRecording';
import type { SourceProcess } from './SourceNotifyQueue';
import { SourceNotifyQueue } from './SourceNotifyQueue';

const RUN_MS = 100;

function createProcessor() {
  const calls: Array<{ ref: string; rule: string; force?: boolean }> = [];
  const processor: SourceProcess = {
    process: (ref, rule, options) => {
      calls.push({ ref, rule, force: options?.force });
      return new Promise<DocumentResult>((resolve) => {
        setTimeout(() => {
          resolve({ source: ref, status: 'indexed' });
        }, RUN_MS);
      });
    },
  };
  return { processor, calls };
}

describe('SourceNotifyQueue force', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes force to process; notifications never force', async () => {
    const { processor, calls } = createProcessor();
    const queue = new SourceNotifyQueue(processor);
    queue.start();
    const forced = queue.processNow('app://a', 'r', { force: true });
    queue.enqueue('app://b', 'r');
    await vi.advanceTimersByTimeAsync(RUN_MS);
    await forced;
    expect(calls).toEqual([
      { ref: 'app://a', rule: 'r', force: true },
      { ref: 'app://b', rule: 'r', force: false },
    ]);
  });

  it('merges force as OR into a pending run (latest rule wins)', async () => {
    const { processor, calls } = createProcessor();
    const queue = new SourceNotifyQueue(processor);
    const forced = queue.processNow('app://a', 'r1', { force: true });
    queue.enqueue('app://a', 'r2');
    queue.start();
    await vi.advanceTimersByTimeAsync(RUN_MS);
    await forced;
    expect(calls).toEqual([{ ref: 'app://a', rule: 'r2', force: true }]);
  });

  it('merges force into the dirty re-run of an in-flight reference', async () => {
    const { processor, calls } = createProcessor();
    const queue = new SourceNotifyQueue(processor);
    queue.start();
    queue.enqueue('app://a', 'r');
    await vi.advanceTimersByTimeAsync(10);
    const forced = queue.processNow('app://a', 'r', { force: true });
    queue.enqueue('app://a', 'r');
    await vi.advanceTimersByTimeAsync(2 * RUN_MS);
    await forced;
    expect(calls).toEqual([
      { ref: 'app://a', rule: 'r', force: false },
      { ref: 'app://a', rule: 'r', force: true },
    ]);
  });
});

describe('SourceNotifyQueue unexpected rejection', () => {
  it('records an extraction_error issue with the designated rule', async () => {
    const processor: SourceProcess = {
      process: () => Promise.reject(new Error('kaboom')),
    };
    const issues = { record: vi.fn(), clear: vi.fn() };
    const queue = new SourceNotifyQueue(processor, {}, undefined, issues);
    queue.start();

    const result = await queue.processNow('app://a', 'chat');

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'extraction_error', message: 'kaboom' },
    });
    expect(issues.clear).toHaveBeenCalledWith('app://a');
    expect(issues.record).toHaveBeenCalledWith(
      'app://a',
      'extraction_error',
      'kaboom',
      expect.objectContaining({ rule: 'chat' }),
    );
  });

  it('keeps the code and details of a tagged rejection (same recording as a processed failure)', async () => {
    const details = [{ stage: 'schema' }];
    const processor: SourceProcess = {
      process: () =>
        Promise.reject(
          new ProcessingFailure('upsert_error', new Error('down'), details),
        ),
    };
    const issues = { record: vi.fn(), clear: vi.fn() };
    const queue = new SourceNotifyQueue(processor, {}, undefined, issues);
    queue.start();

    const result = await queue.processNow('app://a', 'chat');

    expect(result).toEqual({
      source: 'app://a',
      status: 'failed',
      error: { code: 'upsert_error', message: 'down', details },
    });
    expect(issues.record).toHaveBeenCalledWith(
      'app://a',
      'upsert_error',
      'down',
      {
        operation: 'Source notify run failed unexpectedly',
        rule: 'chat',
        details,
      },
    );
  });
});
