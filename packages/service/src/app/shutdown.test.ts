/**
 * @module app/shutdown.test
 * shutdownComponents order and safety: the API server closes before producers stop and queues drain; stores close only when every queue step finished; a hung source queue leaves stores open after the timeout (fake timers).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { settlesWithin, shutdownComponents } from './shutdown';

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
      queue: { drain: log('queue drain') },
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
});

describe('settlesWithin', () => {
  it('treats a rejection as settled', async () => {
    expect(await settlesWithin(Promise.reject(new Error('x')), 10)).toBe(true);
  });
});
