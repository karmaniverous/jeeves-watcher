/**
 * @module app/shutdown.test
 * shutdownComponents order and safety: the API server closes before producers stop and queues drain and stop; a hung server close warns and shutdown continues; stores close only when every queue stop finished. drainQueues stops after a drain timeout and reports whether every stop finished (fake timers).
 */

import type pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { drainQueues, settlesWithin, shutdownComponents } from './shutdown';

const hang = () => new Promise<void>(() => undefined);

function warnLogger() {
  const warn = vi.fn();
  return { warn, logger: { warn } as unknown as pino.Logger };
}

function components(sourceStop: () => Promise<void>) {
  const order: string[] = [];
  const log = (step: string) => () => {
    order.push(step);
    return Promise.resolve();
  };
  const store = { close: vi.fn(() => order.push('store close')) };
  return {
    order,
    store,
    parts: {
      server: { close: log('server close') },
      producers: [{ stop: log('watcher stop') }, undefined],
      queue: { drain: log('queue drain'), stop: log('queue stop') },
      sourceQueue: {
        drain: log('source drain'),
        stop: () => {
          order.push('source stop');
          return sourceStop();
        },
      },
      valuesManager: {
        stopAutoFlush: vi.fn(),
        flush: vi.fn(() => order.push('values flush')),
      },
      stores: [store, undefined],
    },
  };
}

describe('shutdownComponents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes the server first and stores last', async () => {
    const { order, parts } = components(() => Promise.resolve());
    await shutdownComponents(parts, 1000, undefined);
    expect(order).toEqual([
      'server close',
      'watcher stop',
      'queue drain',
      'queue stop',
      'source drain',
      'source stop',
      'values flush',
      'store close',
    ]);
  });

  it('leaves stores open while an abandoned run is still in flight', async () => {
    const { order, store, parts } = components(
      () => new Promise<void>(() => undefined),
    );
    const warn = vi.fn();
    const done = shutdownComponents(parts, 1000, {
      warn,
    } as unknown as Parameters<typeof shutdownComponents>[2]);
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(store.close).not.toHaveBeenCalled();
    expect(order.at(-1)).toBe('values flush');
    expect(warn).toHaveBeenCalledWith(
      'Runs still in flight after shutdown timeout; stores left open',
    );
  });

  it('warns when the API server close times out and carries on', async () => {
    const { order, store, parts } = components(() => Promise.resolve());
    const { warn, logger } = warnLogger();
    const done = shutdownComponents(
      { ...parts, server: { close: hang } },
      1000,
      logger,
    );
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(warn).toHaveBeenCalledWith(
      { timeoutMs: 1000, step: 'API server close' },
      'API server close timeout hit, forcing shutdown',
    );
    expect(order[0]).toBe('watcher stop');
    expect(store.close).toHaveBeenCalledOnce();
  });

  it('leaves stores open when the file queue stop times out', async () => {
    const { order, store, parts } = components(() => Promise.resolve());
    const { logger } = warnLogger();
    const done = shutdownComponents(
      { ...parts, queue: { drain: () => Promise.resolve(), stop: hang } },
      1000,
      logger,
    );
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    // The source queue is still drained and stopped; stores stay open.
    expect(order).toContain('source stop');
    expect(store.close).not.toHaveBeenCalled();
  });
});

describe('drainQueues', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops the file queue after a drain timeout; idle when the stop finishes', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const { warn, logger } = warnLogger();
    const done = drainQueues({ queue: { drain: hang, stop } }, 500, logger);
    await vi.advanceTimersByTimeAsync(500);
    expect(await done).toBe(true);
    expect(stop).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      { timeoutMs: 500, step: 'Queue drain' },
      'Queue drain timeout hit, forcing shutdown',
    );
  });

  it('stops the source queue after a drain timeout; idle when the stop finishes', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const { warn, logger } = warnLogger();
    const done = drainQueues(
      { sourceQueue: { drain: hang, stop } },
      500,
      logger,
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(await done).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('reports not idle when a stop times out, and still stops the other queue', async () => {
    const sourceStop = vi.fn().mockResolvedValue(undefined);
    const { warn, logger } = warnLogger();
    const done = drainQueues(
      {
        queue: { drain: () => Promise.resolve(), stop: hang },
        sourceQueue: { drain: () => Promise.resolve(), stop: sourceStop },
      },
      500,
      logger,
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(await done).toBe(false);
    expect(sourceStop).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      { timeoutMs: 500, step: 'Queue stop' },
      'Queue stop timeout hit, forcing shutdown',
    );
  });
});

describe('settlesWithin', () => {
  it('treats a rejection as settled', async () => {
    expect(await settlesWithin(Promise.reject(new Error('x')), 10)).toBe(true);
  });
});
