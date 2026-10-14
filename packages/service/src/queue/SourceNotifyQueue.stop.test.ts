/**
 * @module queue/SourceNotifyQueue.stop.test
 * Source notify queue stop: pending and owed runs are dropped (their callers reject), new work is refused, in-flight runs finish, and an outstanding drain() resolves (fake timers).
 */

import type { DocumentResult } from '@karmaniverous/jeeves-watcher-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SourceProcess } from './SourceNotifyQueue';
import {
  SourceNotifyQueue,
  SourceNotifyQueueStoppedError,
} from './SourceNotifyQueue';

const RUN_MS = 100;

/** A processor whose runs each finish after {@link RUN_MS}, recording calls. */
function createProcessor() {
  const calls: Array<{ ref: string; rule: string }> = [];
  const processor: SourceProcess = {
    process: (ref, rule) => {
      calls.push({ ref, rule });
      return new Promise<DocumentResult>((resolve) => {
        setTimeout(() => {
          resolve({ source: ref, status: 'indexed' });
        }, RUN_MS);
      });
    },
  };
  return { processor, calls };
}

describe('SourceNotifyQueue stop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops pending and owed work, refuses new work and waits for in-flight runs', async () => {
    const { processor, calls } = createProcessor();
    const queue = new SourceNotifyQueue(processor, { concurrency: 1 });
    queue.start();
    const first = queue.processNow('app://a', 'r');
    const owed = queue.processNow('app://a', 'r');
    const pending = queue.processNow('app://b', 'r');

    const stopped = vi.fn();
    void queue.stop().then(stopped);
    await expect(owed).rejects.toBeInstanceOf(SourceNotifyQueueStoppedError);
    await expect(pending).rejects.toBeInstanceOf(SourceNotifyQueueStoppedError);
    expect(stopped).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(RUN_MS);
    expect(stopped).toHaveBeenCalledOnce();
    await expect(first).resolves.toMatchObject({ status: 'indexed' });
    expect(queue.enqueue('app://c', 'r')).toBe(false);
    await expect(queue.processNow('app://c', 'r')).rejects.toBeInstanceOf(
      SourceNotifyQueueStoppedError,
    );
    await queue.drain();
    expect(calls).toEqual([{ ref: 'app://a', rule: 'r' }]);
  });

  it('resolves an outstanding drain() when it drops the pending work', async () => {
    const { processor, calls } = createProcessor();
    const queue = new SourceNotifyQueue(processor);
    // Not started: the work stays pending, so drain() cannot resolve on its own.
    queue.enqueue('app://a', 'r');
    queue.enqueue('app://b', 'r');
    const drained = vi.fn();
    void queue.drain().then(drained);
    await vi.advanceTimersByTimeAsync(RUN_MS);
    expect(drained).not.toHaveBeenCalled();

    await queue.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(drained).toHaveBeenCalledOnce();
    expect(calls).toEqual([]);
  });
});
