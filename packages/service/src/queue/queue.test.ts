import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventQueue, type ProcessFn, type WatchEvent } from './index';

describe('EventQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces events for the same file within the window', async () => {
    const processed: string[] = [];
    const fn: ProcessFn = (event) => {
      processed.push(event.path);
    };

    const queue = new EventQueue({
      debounceMs: 100,
      concurrency: 5,
    });
    queue.process();

    const event: WatchEvent = {
      type: 'modify',
      path: '/a.txt',
      priority: 'normal',
    };
    queue.enqueue(event, fn);
    queue.enqueue(event, fn);
    queue.enqueue(event, fn);

    // Advance past debounce window
    await vi.advanceTimersByTimeAsync(150);
    await queue.drain();

    expect(processed).toEqual(['/a.txt']);
  });

  it('processes different files independently', async () => {
    const processed: string[] = [];
    const fn: ProcessFn = (event) => {
      processed.push(event.path);
    };

    const queue = new EventQueue({
      debounceMs: 50,
      concurrency: 5,
    });
    queue.process();

    queue.enqueue({ type: 'modify', path: '/a.txt', priority: 'normal' }, fn);
    queue.enqueue({ type: 'modify', path: '/b.txt', priority: 'normal' }, fn);

    await vi.advanceTimersByTimeAsync(100);
    await queue.drain();

    expect(processed).toHaveLength(2);
    expect(processed).toContain('/a.txt');
    expect(processed).toContain('/b.txt');
  });

  it('respects concurrency limit', async () => {
    let maxConcurrent = 0;
    let current = 0;

    const fn: ProcessFn = async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 100));
      current--;
    };

    const queue = new EventQueue({
      debounceMs: 10,
      concurrency: 2,
    });
    queue.process();

    for (let i = 0; i < 5; i++) {
      queue.enqueue(
        { type: 'modify', path: `/${String(i)}.txt`, priority: 'normal' },
        fn,
      );
    }

    // Advance past debounce
    await vi.advanceTimersByTimeAsync(20);
    // Advance through processing
    await vi.advanceTimersByTimeAsync(500);
    await queue.drain();

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('drain resolves immediately when queue is empty', async () => {
    const queue = new EventQueue({
      debounceMs: 50,
      concurrency: 5,
    });
    queue.process();

    // Should resolve immediately without hanging
    await queue.drain();
    expect(true).toBe(true);
  });

  it('prioritizes normal events over low priority', async () => {
    const processed: string[] = [];
    const fn: ProcessFn = (event) => {
      processed.push(event.path);
    };

    const queue = new EventQueue({
      debounceMs: 10,
      concurrency: 1,
    });

    // Enqueue low first, then normal - but don't start processing yet
    queue.enqueue({ type: 'modify', path: '/low.txt', priority: 'low' }, fn);
    queue.enqueue(
      { type: 'modify', path: '/normal.txt', priority: 'normal' },
      fn,
    );

    // Advance past debounce so both are queued
    await vi.advanceTimersByTimeAsync(20);

    // Now start processing
    queue.process();
    await vi.advanceTimersByTimeAsync(10);
    await queue.drain();

    // Normal should be processed first
    expect(processed[0]).toBe('/normal.txt');
    expect(processed[1]).toBe('/low.txt');
  });

  it('debounce keeps the latest event for a path', async () => {
    const types: string[] = [];
    const fn: ProcessFn = (event) => {
      types.push(event.type);
    };

    const queue = new EventQueue({
      debounceMs: 100,
      concurrency: 5,
    });
    queue.process();

    queue.enqueue({ type: 'create', path: '/a.txt', priority: 'normal' }, fn);
    await vi.advanceTimersByTimeAsync(50);
    queue.enqueue({ type: 'modify', path: '/a.txt', priority: 'normal' }, fn);

    await vi.advanceTimersByTimeAsync(150);
    await queue.drain();

    expect(types).toEqual(['modify']);
  });
});
