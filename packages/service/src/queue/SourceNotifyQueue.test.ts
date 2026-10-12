/**
 * @module queue/SourceNotifyQueue.test
 * Unit tests for the source notify queue: pending merge, dirty re-run, burst coalescing, ordering, concurrency, pause/resume, stop, processNow and error isolation (fake timers).
 */

import type { DocumentResult } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SourceProcessorInterface } from '../processor/types';
import { combinePausableQueues } from './pausable';
import {
  SourceNotifyQueue,
  SourceNotifyQueueStoppedError,
} from './SourceNotifyQueue';

const RUN_MS = 100;

/**
 * Fake source + processor: each run reads the reference's current content
 * when it starts (the retrieval), finishes after {@link RUN_MS}, and records
 * what it indexed.
 */
function createFake(failRefs: string[] = []) {
  const content = new Map<string, string>();
  const indexed = new Map<string, string>();
  const calls: Array<{ ref: string; rule: string }> = [];
  let active = 0;
  let maxActive = 0;
  const processor: SourceProcessorInterface = {
    processSource: (ref, rule) => {
      calls.push({ ref, rule });
      if (failRefs.includes(ref)) throw new Error(`boom ${ref}`);
      const seen = content.get(ref) ?? 'none';
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<DocumentResult>((resolve) => {
        setTimeout(() => {
          active -= 1;
          indexed.set(ref, seen);
          resolve({
            source: ref,
            status: 'indexed',
            matched_rules: [`${rule}:${seen}`],
          });
        }, RUN_MS);
      });
    },
  };
  return { content, indexed, calls, processor, maxActive: () => maxActive };
}

describe('SourceNotifyQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds work until started, then merges pending notifications (latest rule wins)', async () => {
    const fake = createFake();
    const queue = new SourceNotifyQueue(fake.processor);
    queue.enqueue('cg://a', 'r1');
    queue.enqueue('cg://a', 'r2');
    await vi.advanceTimersByTimeAsync(RUN_MS * 3);
    expect(fake.calls).toEqual([]);

    queue.start();
    await vi.advanceTimersByTimeAsync(RUN_MS);
    await queue.drain();
    expect(fake.calls).toEqual([{ ref: 'cg://a', rule: 'r2' }]);
  });

  it('processes references in first-notified order; a merge keeps its place', async () => {
    const fake = createFake();
    const queue = new SourceNotifyQueue(fake.processor, { concurrency: 1 });
    queue.enqueue('cg://a', 'r');
    queue.enqueue('cg://b', 'r');
    queue.enqueue('cg://a', 'r');
    queue.enqueue('cg://c', 'r');
    queue.start();
    await vi.advanceTimersByTimeAsync(RUN_MS * 5);
    expect(fake.calls.map((c) => c.ref)).toEqual([
      'cg://a',
      'cg://b',
      'cg://c',
    ]);
  });

  it('treats references case-sensitively', async () => {
    const fake = createFake();
    const queue = new SourceNotifyQueue(fake.processor);
    queue.enqueue('cg://AbC', 'r');
    queue.enqueue('cg://abc', 'r');
    queue.start();
    await vi.advanceTimersByTimeAsync(RUN_MS);
    expect(fake.calls).toHaveLength(2);
  });

  it('re-runs a reference notified while in flight exactly once, with the latest rule', async () => {
    const fake = createFake();
    const queue = new SourceNotifyQueue(fake.processor);
    queue.start();
    queue.enqueue('cg://a', 'r1');
    expect(fake.calls).toHaveLength(1);
    queue.enqueue('cg://a', 'r2');
    queue.enqueue('cg://a', 'r3');
    queue.enqueue('cg://a', 'r4');
    expect(fake.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(RUN_MS * 5);
    await queue.drain();
    expect(fake.calls).toEqual([
      { ref: 'cg://a', rule: 'r1' },
      { ref: 'cg://a', rule: 'r4' },
    ]);
  });

  it('collapses a burst of 20 notifies to at most 2 runs; the final state wins', async () => {
    const fake = createFake();
    const queue = new SourceNotifyQueue(fake.processor);
    queue.start();
    for (let i = 1; i <= 20; i++) {
      fake.content.set('cg://a', `v${String(i)}`);
      queue.enqueue('cg://a', 'r');
      await vi.advanceTimersByTimeAsync(RUN_MS / 50);
    }
    await vi.advanceTimersByTimeAsync(RUN_MS * 3);
    await queue.drain();
    expect(fake.calls.length).toBeLessThanOrEqual(2);
    expect(fake.indexed.get('cg://a')).toBe('v20');
  });

  it('caps concurrency and still processes everything', async () => {
    const fake = createFake();
    const queue = new SourceNotifyQueue(fake.processor, { concurrency: 2 });
    queue.start();
    for (const id of ['a', 'b', 'c', 'd', 'e'])
      queue.enqueue(`cg://${id}`, 'r');
    expect(fake.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(RUN_MS * 3);
    await queue.drain();
    expect(fake.calls).toHaveLength(5);
    expect(fake.maxActive()).toBe(2);
  });

  it('rejects an invalid concurrency', () => {
    const fake = createFake();
    expect(
      () => new SourceNotifyQueue(fake.processor, { concurrency: 0 }),
    ).toThrow();
  });

  it('pause stops new runs (including owed re-runs) until resume', async () => {
    const fake = createFake();
    const queue = new SourceNotifyQueue(fake.processor);
    queue.start();
    queue.enqueue('cg://a', 'r');
    queue.pause();
    queue.enqueue('cg://a', 'r');
    queue.enqueue('cg://b', 'r');

    const idle = vi.fn();
    void queue.waitForIdleWorkers().then(idle);
    await vi.advanceTimersByTimeAsync(RUN_MS);
    expect(idle).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(RUN_MS * 3);
    expect(fake.calls).toHaveLength(1);

    queue.resume();
    await vi.advanceTimersByTimeAsync(RUN_MS * 2);
    await queue.drain();
    // The owed re-run joins the back of the line, behind cg://b.
    expect(fake.calls.map((c) => c.ref)).toEqual([
      'cg://a',
      'cg://b',
      'cg://a',
    ]);
  });

  it('combinePausableQueues drives several queues as one', async () => {
    const fake = createFake();
    const q1 = new SourceNotifyQueue(fake.processor);
    const q2 = new SourceNotifyQueue(fake.processor);
    const both = combinePausableQueues(q1, undefined, q2);
    q1.start();
    q2.start();
    q1.enqueue('cg://a', 'r');
    both.pause();
    q2.enqueue('cg://b', 'r');
    const idle = both.waitForIdleWorkers();
    await vi.advanceTimersByTimeAsync(RUN_MS);
    await idle;
    expect(fake.calls.map((c) => c.ref)).toEqual(['cg://a']);
    both.resume();
    await vi.advanceTimersByTimeAsync(RUN_MS);
    expect(fake.calls.map((c) => c.ref)).toEqual(['cg://a', 'cg://b']);
  });

  it('stop drops pending and owed work, refuses new work and waits for in-flight runs', async () => {
    const fake = createFake();
    const queue = new SourceNotifyQueue(fake.processor, { concurrency: 1 });
    queue.start();
    const first = queue.processNow('cg://a', 'r');
    const owed = queue.processNow('cg://a', 'r');
    const pending = queue.processNow('cg://b', 'r');

    const stopped = vi.fn();
    void queue.stop().then(stopped);
    await expect(owed).rejects.toBeInstanceOf(SourceNotifyQueueStoppedError);
    await expect(pending).rejects.toBeInstanceOf(SourceNotifyQueueStoppedError);
    expect(stopped).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(RUN_MS);
    expect(stopped).toHaveBeenCalledOnce();
    await expect(first).resolves.toMatchObject({ status: 'indexed' });
    expect(queue.enqueue('cg://c', 'r')).toBe(false);
    await expect(queue.processNow('cg://c', 'r')).rejects.toBeInstanceOf(
      SourceNotifyQueueStoppedError,
    );
    await queue.drain();
    expect(fake.calls).toEqual([{ ref: 'cg://a', rule: 'r' }]);
  });

  it('processNow while in flight waits for the dirty re-run and returns post-call state', async () => {
    const fake = createFake();
    const queue = new SourceNotifyQueue(fake.processor);
    queue.start();
    fake.content.set('cg://a', 'v1');
    queue.enqueue('cg://a', 'r');
    await vi.advanceTimersByTimeAsync(RUN_MS / 2);

    fake.content.set('cg://a', 'v2');
    const result = queue.processNow('cg://a', 'r');
    await vi.advanceTimersByTimeAsync(RUN_MS * 2);
    await expect(result).resolves.toEqual({
      source: 'cg://a',
      status: 'indexed',
      matched_rules: ['r:v2'],
    });
    expect(fake.calls).toHaveLength(2);
  });

  it('processNow joins a pending run instead of adding one', async () => {
    const fake = createFake();
    const queue = new SourceNotifyQueue(fake.processor);
    queue.enqueue('cg://a', 'r1');
    const result = queue.processNow('cg://a', 'r2');
    queue.start();
    await vi.advanceTimersByTimeAsync(RUN_MS);
    await expect(result).resolves.toMatchObject({ matched_rules: ['r2:none'] });
    expect(fake.calls).toHaveLength(1);
  });

  it('isolates failures: a rejecting run yields a failed result and the queue keeps going', async () => {
    const fake = createFake(['cg://bad']);
    const error = vi.fn();
    const logger = { error } as unknown as pino.Logger;
    const queue = new SourceNotifyQueue(fake.processor, {}, logger);
    queue.start();

    const bad = queue.processNow('cg://bad', 'r');
    await expect(bad).resolves.toEqual({
      source: 'cg://bad',
      status: 'failed',
      error: { code: 'extraction_error', message: 'boom cg://bad' },
    });
    expect(error).toHaveBeenCalledOnce();

    queue.enqueue('cg://bad', 'r');
    queue.enqueue('cg://good', 'r');
    await vi.advanceTimersByTimeAsync(RUN_MS);
    await queue.drain();
    expect(fake.indexed.get('cg://good')).toBe('none');
    expect(fake.calls.map((c) => c.ref)).toEqual([
      'cg://bad',
      'cg://bad',
      'cg://good',
    ]);
  });

  it('drain resolves only after owed re-runs complete', async () => {
    const fake = createFake();
    const queue = new SourceNotifyQueue(fake.processor);
    queue.start();
    queue.enqueue('cg://a', 'r');
    queue.enqueue('cg://a', 'r');
    const drained = vi.fn();
    void queue.drain().then(drained);
    await vi.advanceTimersByTimeAsync(RUN_MS);
    expect(drained).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RUN_MS);
    expect(drained).toHaveBeenCalledOnce();
    expect(fake.calls).toHaveLength(2);
  });
});
