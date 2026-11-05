/**
 * @module api/catalog/boundedRun.test
 * Bounded task runs (D96): at most `concurrency` tasks at once, each told the seconds left, nothing started past the budget, in-flight results discarded and reported pending, and the first failure thrown.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OUT_OF_BUDGET, runBounded, withinBudget } from './boundedRun';

describe('withinBudget', () => {
  it('returns the result when it comes in time', async () => {
    const done = withinBudget(after(50, 'x')(), 100);
    await vi.advanceTimersByTimeAsync(50);
    await expect(done).resolves.toBe('x');
  });

  it('gives OUT_OF_BUDGET when the budget runs out first', async () => {
    const done = withinBudget(after(200, 'x')(), 100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(done).resolves.toBe(OUT_OF_BUDGET);
  });

  it('treats a spent budget as none left', async () => {
    const done = withinBudget(after(10, 'x')(), -5);
    await vi.advanceTimersByTimeAsync(0);
    await expect(done).resolves.toBe(OUT_OF_BUDGET);
  });
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A task resolving `value` after `ms` (fake timers). */
const after =
  <T>(ms: number, value: T) =>
  () =>
    new Promise<T>((resolve) => {
      setTimeout(() => {
        resolve(value);
      }, ms);
    });

describe('runBounded', () => {
  it('runs at most `concurrency` tasks at a time and collects every result', async () => {
    let running = 0;
    let peak = 0;
    const tasks = Array.from({ length: 10 }, (_, i) => ({
      key: `f${String(i)}`,
      run: async () => {
        running++;
        peak = Math.max(peak, running);
        await after(100, undefined)();
        running--;
        return i;
      },
    }));
    const done = runBounded(tasks, { concurrency: 4, budgetMs: 10_000 });
    await vi.advanceTimersByTimeAsync(300);
    const { results, pending } = await done;
    expect(peak).toBe(4);
    expect(pending).toEqual([]);
    expect([...results.values()]).toHaveLength(10);
    expect(results.get('f9')).toBe(9);
  });

  it('gives each task the whole seconds left in the budget (at least 1)', async () => {
    const timeouts: number[] = [];
    const tasks = [0, 1, 2].map((i) => ({
      key: String(i),
      run: (timeoutS: number) => {
        timeouts.push(timeoutS);
        return after(4_000, i)();
      },
    }));
    const done = runBounded(tasks, { concurrency: 1, budgetMs: 10_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    const { pending } = await done;
    expect(timeouts).toEqual([10, 6, 2]);
    expect(pending).toEqual(['2']);
  });

  it('never gives a task less than 1 s, even with no time left on the clock', async () => {
    // deadline, budget timer, loop check, then the task's timeout.
    const clock = [0, 0, 0, 1_000];
    const timeouts: number[] = [];
    const { results } = await runBounded(
      [
        {
          key: 'a',
          run: (timeoutS: number) => {
            timeouts.push(timeoutS);
            return Promise.resolve('a');
          },
        },
      ],
      { concurrency: 1, budgetMs: 1_000, now: () => clock.shift() ?? 1_000 },
    );
    expect(timeouts).toEqual([1]);
    expect(results.get('a')).toBe('a');
  });

  it('starts no task once the deadline has passed, even before the budget timer fires', async () => {
    let t = 0;
    const started: string[] = [];
    const { results, pending } = await runBounded(
      ['a', 'b'].map((key) => ({
        key,
        run: () => {
          started.push(key);
          t = 2_000;
          return Promise.resolve(key);
        },
      })),
      { concurrency: 1, budgetMs: 1_000, now: () => t },
    );
    expect(started).toEqual(['a']);
    expect(results.get('a')).toBe('a');
    expect(pending).toEqual(['b']);
  });

  it('starts nothing past the budget and discards late results', async () => {
    const started: string[] = [];
    const tasks = ['a', 'b', 'c', 'd', 'e'].map((key, i) => ({
      key,
      run: () => {
        started.push(key);
        return after(i === 0 ? 50 : 300, key)();
      },
    }));
    const done = runBounded(tasks, { concurrency: 2, budgetMs: 200 });
    await vi.advanceTimersByTimeAsync(200);
    const { results, pending } = await done;
    expect([...results.keys()]).toEqual(['a']);
    expect(pending).toEqual(['b', 'c', 'd', 'e']);
    expect(started).toEqual(['a', 'b', 'c']);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(started).toEqual(['a', 'b', 'c']);
    expect(results.size).toBe(1);
  });

  it('throws the first failure without waiting for slower tasks', async () => {
    const tasks = [
      { key: 'slow', run: after(5_000, 1) },
      {
        key: 'bad',
        run: () => Promise.reject(new Error('bad filter')),
      },
      { key: 'later', run: () => Promise.reject(new Error('second')) },
    ];
    const done = runBounded(tasks, { concurrency: 2, budgetMs: 10_000 });
    const settled = done.then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(await settled).toEqual(new Error('bad filter'));
  });

  it('ignores a failure after the budget', async () => {
    const tasks = [
      {
        key: 'late',
        run: () =>
          new Promise<number>((_, reject) => {
            setTimeout(() => {
              reject(new Error('timed out in Qdrant'));
            }, 500);
          }),
      },
    ];
    const done = runBounded(tasks, { concurrency: 4, budgetMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(done).resolves.toEqual({
      results: new Map(),
      pending: ['late'],
    });
    await vi.advanceTimersByTimeAsync(500);
  });

  it('settles at once with no tasks', async () => {
    await expect(
      runBounded([], { concurrency: 4, budgetMs: 10 }),
    ).resolves.toEqual({ results: new Map(), pending: [] });
  });
});
