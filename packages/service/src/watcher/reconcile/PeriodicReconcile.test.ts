/**
 * @module watcher/reconcile/PeriodicReconcile.test
 * Periodic reconciliation (D111) on a fake clock: per-root stagger after each root's initial scan, then every interval; 0 disables it; a refresh (reload) changes the interval without a rebuild; stop clears every timer.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import { PeriodicReconcile, renewThenReconcile } from './PeriodicReconcile';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

/** A scheduler over `roots` recording each run's root and time. */
function setup(roots: string[], interval: { ms: number }) {
  const runs: string[] = [];
  const periodic = new PeriodicReconcile({
    roots,
    intervalMs: () => interval.ms,
    run: (root) => {
      runs.push(`${root}@${String(Date.now())}`);
      return Promise.resolve();
    },
    onRunError: () => undefined,
  });
  return { periodic, runs };
}

describe('PeriodicReconcile', () => {
  it('staggers each root to i * interval / n after its scan, then repeats', async () => {
    vi.setSystemTime(0);
    const { periodic, runs } = setup(['a', 'b'], { ms: 1000 });
    periodic.arm('a');
    periodic.arm('b');
    await vi.advanceTimersByTimeAsync(2500);
    expect(runs).toEqual(['a@500', 'b@1000', 'a@1500', 'b@2000', 'a@2500']);
    periodic.stop();
  });

  it('does nothing while the interval is 0, and a refresh arms it', async () => {
    vi.setSystemTime(0);
    const interval = { ms: 0 };
    const { periodic, runs } = setup(['a'], interval);
    periodic.arm('a');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(runs).toEqual([]);
    interval.ms = 300;
    periodic.refresh();
    await vi.advanceTimersByTimeAsync(700);
    expect(runs).toEqual(['a@10300', 'a@10600']);
    periodic.stop();
  });

  it('a refresh changes the interval without waiting for the old one', async () => {
    vi.setSystemTime(0);
    const interval = { ms: 60_000 };
    const { periodic, runs } = setup(['a'], interval);
    periodic.arm('a');
    await vi.advanceTimersByTimeAsync(1000);
    interval.ms = 100;
    periodic.refresh();
    await vi.advanceTimersByTimeAsync(250);
    expect(runs).toEqual(['a@1100', 'a@1200']);
    interval.ms = 0;
    periodic.refresh();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runs).toHaveLength(2);
    periodic.stop();
  });

  it('keeps the running timers when a refresh leaves the interval unchanged', async () => {
    vi.setSystemTime(0);
    const { periodic, runs } = setup(['a', 'b'], { ms: 1000 });
    periodic.arm('a');
    periodic.arm('b');
    for (let t = 0; t < 10; t++) {
      await vi.advanceTimersByTimeAsync(300);
      periodic.refresh();
    }
    expect(runs).toEqual([
      'a@500',
      'b@1000',
      'a@1500',
      'b@2000',
      'a@2500',
      'b@3000',
    ]);
    periodic.stop();
  });

  it('a root scheduled between the config change and the refresh does not hide the others', async () => {
    vi.setSystemTime(0);
    const interval = { ms: 0 };
    const { periodic, runs } = setup(['a', 'b'], interval);
    periodic.arm('a');
    interval.ms = 1000;
    // b's initial scan ends after the new config is published, before refresh.
    periodic.arm('b');
    periodic.refresh();
    await vi.advanceTimersByTimeAsync(1000);
    expect(runs).toEqual(['a@500', 'b@1000']);
    periodic.stop();
  });

  it('reports a rejected run and schedules the next', async () => {
    vi.setSystemTime(0);
    const onRunError = vi.fn();
    const periodic = new PeriodicReconcile({
      roots: ['a'],
      intervalMs: () => 100,
      run: () => Promise.reject(new Error('renew failed')),
      onRunError,
    });
    periodic.arm('a');
    await vi.advanceTimersByTimeAsync(250);
    expect(onRunError).toHaveBeenCalledTimes(2);
    expect(onRunError).toHaveBeenCalledWith('a', expect.any(Error));
    periodic.stop();
  });

  it('renews then reconciles the root; a rebuilt source reconciles every root', async () => {
    const reconciled: string[] = [];
    let rebuilt = false;
    const onRebuilt = vi.fn();
    const deps = {
      renew: () => Promise.resolve({ rebuilt }),
      reconcile: (dir: string) => {
        reconciled.push(dir);
        return Promise.resolve();
      },
      roots: ['a', 'b'],
      onRebuilt,
    };
    await renewThenReconcile(deps, 'b');
    expect(reconciled).toEqual(['b']);
    rebuilt = true;
    await renewThenReconcile(deps, 'b');
    expect(reconciled).toEqual(['b', 'a', 'b']);
    expect(onRebuilt).toHaveBeenCalledOnce();
  });

  it('does not reschedule a run that ends after stop', async () => {
    const latch: { open?: () => void } = {};
    let runs = 0;
    const periodic = new PeriodicReconcile({
      roots: ['a'],
      intervalMs: () => 100,
      run: () => {
        runs++;
        return new Promise<void>((resolve) => {
          latch.open = resolve;
        });
      },
      onRunError: () => undefined,
    });
    periodic.arm('a');
    await vi.advanceTimersByTimeAsync(100);
    expect(runs).toBe(1);
    periodic.stop();
    latch.open?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(runs).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs nothing after stop, nor for a later arm', async () => {
    const { periodic, runs } = setup(['a'], { ms: 100 });
    periodic.arm('a');
    periodic.stop();
    periodic.arm('a');
    await vi.advanceTimersByTimeAsync(1000);
    expect(runs).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
