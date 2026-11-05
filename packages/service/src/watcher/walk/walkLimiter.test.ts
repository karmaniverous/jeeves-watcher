/**
 * @module watcher/walk/walkLimiter.test
 * The walk limiter (D170): never more than its maximum in flight, FIFO, slots released on failure; and concurrent walks share the process-wide 8.
 */

import type { Dirent, Stats } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { walk, type WalkFs } from './Walker';
import { createLimiter, WALK_CONCURRENCY } from './walkLimiter';

/** A call that resolves after `turns` event-loop turns, tracking in-flight calls. */
function tracker() {
  const state = { active: 0, peak: 0 };
  const call = async (turns = 2) => {
    state.active++;
    state.peak = Math.max(state.peak, state.active);
    for (let i = 0; i < turns; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    state.active--;
  };
  return { state, call };
}

describe('createLimiter', () => {
  it('keeps at most max calls in flight and runs them all', async () => {
    const limit = createLimiter(3);
    const { state, call } = tracker();
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        limit(async () => {
          await call();
          order.push(i);
        }),
      ),
    );
    expect(state.peak).toBe(3);
    expect(order).toHaveLength(20);
  });

  it('frees the slot of a failed call', async () => {
    const limit = createLimiter(1);
    await expect(limit(() => Promise.reject(new Error('x')))).rejects.toThrow(
      'x',
    );
    await expect(limit(() => Promise.resolve(7))).resolves.toBe(7);
  });

  it('does not let a newcomer overtake a waiter at a release', async () => {
    const limit = createLimiter(1);
    const { state, call } = tracker();
    const first = limit(() => call(5));
    const waiter = limit(() => call(5));
    await first;
    const newcomer = limit(() => call(5));
    await Promise.all([waiter, newcomer]);
    expect(state.peak).toBe(1);
  });
});

describe('walk concurrency (D170)', () => {
  it('never has more than 8 fs calls in flight across concurrent walks', async () => {
    const { state, call } = tracker();
    const dirent = (name: string, dir: boolean) =>
      ({
        name,
        isDirectory: () => dir,
        isFile: () => !dir,
        isSymbolicLink: () => false,
      }) as Dirent;
    const fs: WalkFs = {
      readdir: async (dir) => {
        await call();
        const depth = dir.split(/[\\/]/).length;
        return depth < 4
          ? Array.from({ length: 5 }, (_, i) => dirent(`d${String(i)}`, true))
          : Array.from({ length: 10 }, (_, i) =>
              dirent(`f${String(i)}.md`, false),
            );
      },
      stat: async () => {
        await call();
        return { isFile: () => true, size: 1, mtimeMs: 1 } as Stats;
      },
    };
    const options = { prune: () => false, include: () => true, fs };
    const results = await Promise.all([
      walk('/a', options),
      walk('/b', options),
      walk('/c', options),
    ]);
    expect(results.map((r) => r.size)).toEqual([250, 250, 250]);
    expect(state.peak).toBe(WALK_CONCURRENCY);
  });
});
