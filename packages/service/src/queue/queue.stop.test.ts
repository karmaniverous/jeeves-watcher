/**
 * @module queue/queue.stop.test
 * EventQueue start/stop: events are held until start (the deprecated `process` alias starts too); stop cancels debounces, drops queued events, ignores new ones and resolves after in-flight work, releasing drain waiters.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventQueue, type WatchEvent } from './index';

const event = (path: string): WatchEvent => ({
  type: 'modify',
  path,
  priority: 'normal',
});

describe('EventQueue start/stop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds events until started; process() is an alias of start()', async () => {
    const fn = vi.fn();
    const queue = new EventQueue({ debounceMs: 10, concurrency: 1 });
    queue.enqueue(event('/a'), fn);
    await vi.advanceTimersByTimeAsync(20);
    expect(fn).not.toHaveBeenCalled();
    queue.process();
    await queue.drain();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('stop cancels debounces, drops queued work and ignores new events', async () => {
    const fn = vi.fn();
    const queue = new EventQueue({ debounceMs: 10, concurrency: 1 });
    queue.enqueue(event('/queued'), fn);
    await vi.advanceTimersByTimeAsync(20); // queued, not started
    queue.enqueue(event('/debouncing'), fn);

    await queue.stop();
    queue.enqueue(event('/late'), fn);
    queue.start();
    await vi.advanceTimersByTimeAsync(50);

    expect(fn).not.toHaveBeenCalled();
    await expect(queue.drain()).resolves.toBeUndefined();
  });

  it('stop resolves after in-flight work and releases drain waiters', async () => {
    let finish!: () => void;
    const fn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const queue = new EventQueue({ debounceMs: 1, concurrency: 1 });
    queue.start();
    queue.enqueue(event('/a'), fn);
    queue.enqueue(event('/b'), fn);
    await vi.advanceTimersByTimeAsync(5);
    expect(fn).toHaveBeenCalledOnce();

    let drained = false;
    void queue.drain().then(() => {
      drained = true;
    });
    let stopped = false;
    void queue.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(5);
    expect(stopped).toBe(false);

    finish();
    await vi.advanceTimersByTimeAsync(5);
    expect(stopped).toBe(true);
    expect(drained).toBe(true);
    // '/b' was queued behind '/a' and dropped by stop.
    expect(fn).toHaveBeenCalledOnce();
  });
});
