/**
 * @module watcher/stability/StabilityTicker.test
 * The shared stability ticker (D128) on a fake clock and fake `stat`: one timer, at most 2,000 stats per tick oldest-checked first, settling after the threshold, at once for 0; and the D142 settle decision.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileStats } from '../inventory/Inventory';
import {
  MAX_STATS_PER_TICK,
  settledEvent,
  type SettledPath,
  StabilityTicker,
} from './StabilityTicker';

/** A fake filesystem of sizes; a missing path is gone. */
function fakeFs() {
  const sizes = new Map<string, number>();
  const statted: string[] = [];
  const stat = (path: string): Promise<FileStats | undefined> => {
    statted.push(path);
    const size = sizes.get(path);
    return Promise.resolve(
      size === undefined ? undefined : { size, mtimeMs: 1000 + size },
    );
  };
  return { sizes, statted, stat };
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setInterval', 'clearInterval', 'setTimeout', 'Date'],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('StabilityTicker', () => {
  it('settles a path once its size has held for the threshold', async () => {
    const fs = fakeFs();
    const settled: SettledPath[] = [];
    const ticker = new StabilityTicker({
      thresholdMs: 1000,
      stat: fs.stat,
      onSettled: (s) => settled.push(s),
    });
    fs.sizes.set('a', 1);
    ticker.enter('a', 'a', true);
    await vi.advanceTimersByTimeAsync(600);
    fs.sizes.set('a', 5); // still being written
    await vi.advanceTimersByTimeAsync(900);
    expect(settled).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    expect(settled).toEqual([
      { path: 'a', stats: { size: 5, mtimeMs: 1005 }, synthetic: true },
    ]);
    expect(ticker.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs one timer for any number of paths, at min(250, threshold/4)', async () => {
    const fs = fakeFs();
    const ticker = new StabilityTicker({
      thresholdMs: 400,
      stat: fs.stat,
      onSettled: () => undefined,
    });
    for (let i = 0; i < 50; i++) {
      fs.sizes.set(String(i), i);
      ticker.enter(String(i), String(i), true);
    }
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(fs.statted).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(fs.statted).toHaveLength(50);
  });

  it('stats at most 2,000 paths per tick, oldest-checked first', async () => {
    const fs = fakeFs();
    const ticker = new StabilityTicker({
      thresholdMs: 1000,
      stat: fs.stat,
      onSettled: () => undefined,
    });
    const total = MAX_STATS_PER_TICK + 500;
    for (let i = 0; i < total; i++) {
      fs.sizes.set(`p${String(i)}`, 1);
      ticker.enter(`p${String(i)}`, `p${String(i)}`, true);
    }
    await vi.advanceTimersByTimeAsync(250);
    expect(fs.statted).toHaveLength(MAX_STATS_PER_TICK);
    expect(fs.statted[0]).toBe('p0');
    await vi.advanceTimersByTimeAsync(250);
    // The 500 never checked go first, then the oldest-checked.
    expect(
      fs.statted.slice(MAX_STATS_PER_TICK, MAX_STATS_PER_TICK + 2),
    ).toEqual([
      `p${String(MAX_STATS_PER_TICK)}`,
      `p${String(MAX_STATS_PER_TICK + 1)}`,
    ]);
    expect(fs.statted.slice(-1)).toEqual([`p${String(1499)}`]);
  });

  it('settles after one stat when the threshold is 0 or unset, without a timer', async () => {
    for (const thresholdMs of [0, undefined]) {
      const fs = fakeFs();
      const settled: string[] = [];
      const ticker = new StabilityTicker({
        thresholdMs,
        stat: fs.stat,
        onSettled: (s) => settled.push(s.path),
      });
      fs.sizes.set('a', 3);
      ticker.enter('a', 'a', false);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toEqual(['a']);
    }
  });

  it('drops a path that vanished, and a joined wait stays one entry', async () => {
    const fs = fakeFs();
    const settled: SettledPath[] = [];
    const ticker = new StabilityTicker({
      thresholdMs: 100,
      stat: fs.stat,
      onSettled: (s) => settled.push(s),
    });
    ticker.enter('gone', 'gone', true);
    fs.sizes.set('b', 2);
    ticker.enter('b', 'b', true);
    ticker.enter('b', 'b', false);
    expect(ticker.size).toBe(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(settled).toEqual([
      { path: 'b', stats: { size: 2, mtimeMs: 1002 }, synthetic: false },
    ]);
    expect(ticker.size).toBe(0);
  });

  it('drops the pending paths under a directory (root unavailable)', () => {
    const fs = fakeFs();
    const ticker = new StabilityTicker({
      thresholdMs: 100,
      stat: fs.stat,
      onSettled: () => undefined,
    });
    for (const key of ['/r/a', '/r/sub/b', '/rx/c', '/other/d']) {
      ticker.enter(key, key, true);
    }
    ticker.dropUnder('/R');
    expect(ticker.size).toBe(2);
    ticker.stop();
  });

  it('skips a tick while the previous one is still statting', async () => {
    const statted: string[] = [];
    const latch: { open?: () => void } = {};
    const ticker = new StabilityTicker({
      thresholdMs: 100,
      stat: (path) => {
        statted.push(path);
        return new Promise((resolve) => {
          latch.open = () => {
            resolve({ size: 1, mtimeMs: 1 });
          };
        });
      },
      onSettled: () => undefined,
    });
    ticker.enter('a', 'a', true);
    await vi.advanceTimersByTimeAsync(100);
    expect(statted).toEqual(['a']);
    latch.open?.();
    await vi.advanceTimersByTimeAsync(0);
    ticker.stop();
    expect(statted).toEqual(['a']);
  });

  it('forgets everything on stop and ignores later entries', async () => {
    const fs = fakeFs();
    const settled: string[] = [];
    const ticker = new StabilityTicker({
      thresholdMs: 100,
      stat: fs.stat,
      onSettled: (s) => settled.push(s.path),
    });
    fs.sizes.set('a', 1);
    ticker.enter('a', 'a', true);
    ticker.stop();
    ticker.enter('b', 'b', true);
    await vi.advanceTimersByTimeAsync(500);
    expect(settled).toEqual([]);
    expect(ticker.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cannot settle a path early when the watcher stalls between a stat and its continuation (#306)', async () => {
    let clock = 0;
    let release: (() => void) | undefined;
    let stall = false;
    const settled: string[] = [];
    const stats: FileStats = { size: 1, mtimeMs: 1 };
    const ticker = new StabilityTicker({
      thresholdMs: 1000,
      now: () => clock,
      stat: () =>
        stall
          ? new Promise((resolve) => {
              release = () => {
                resolve(stats);
              };
            })
          : Promise.resolve(stats),
      onSettled: (s) => settled.push(s.path),
    });
    ticker.enter('a', 'a', false);
    // First tick at 250: the size is first seen, so it holds from 250.
    clock = 250;
    await vi.advanceTimersByTimeAsync(250);
    // Second tick at 500 stats the same size, but the watcher stalls
    // before the stat's continuation runs, until well past the threshold.
    stall = true;
    clock = 500;
    await vi.advanceTimersByTimeAsync(250);
    expect(release).toBeDefined();
    clock = 10_000;
    release?.();
    await vi.advanceTimersByTimeAsync(0);
    // Only 250 ms of stability were observed: not settled.
    expect(settled).toEqual([]);
    expect(ticker.size).toBe(1);
    ticker.stop();
  });
});

describe('settledEvent (D142)', () => {
  const stats = { size: 3, mtimeMs: 9 };

  it('adds a path the inventory lacks', () => {
    expect(settledEvent(undefined, stats)).toBe('add');
  });

  it('drops a path the inventory holds with the same size and mtime', () => {
    expect(settledEvent({ path: 'p', size: 3, mtimeMs: 9 }, stats)).toBe(
      undefined,
    );
  });

  it('changes a path whose mtime or size differs', () => {
    expect(settledEvent({ path: 'p', size: 3, mtimeMs: 8 }, stats)).toBe(
      'change',
    );
    expect(settledEvent({ path: 'p', size: 4, mtimeMs: 9 }, stats)).toBe(
      'change',
    );
  });

  it('drops a path a real event already put in a stats-less inventory', () => {
    expect(settledEvent({ path: 'p' }, stats)).toBe(undefined);
  });
});
