/**
 * @module api/handlers/reindexSources.test
 * reindexSources: distinct references, stored-rule lookups with bounded concurrency, unindexed references counted but skipped, plan grouped by source name, enqueue only on a live run.
 */

import { describe, expect, it, vi } from 'vitest';

import { reindexSources } from './reindexSources';

/** Ops whose storedRule resolves after a tick and tracks concurrency. */
function makeOps(rules: Record<string, string>) {
  let active = 0;
  let maxActive = 0;
  const storedRule = vi.fn(async (ref: string) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return rules[ref] ?? null;
  });
  return { storedRule, max: () => maxActive };
}

describe('reindexSources', () => {
  it('enqueues indexed references with their stored rule', async () => {
    const ops = makeOps({ 'app://1': 'r1', 'other://2': 'r2' });
    const queue = { enqueue: vi.fn(() => true) };

    const result = await reindexSources(
      { ops, queue },
      ['app://1', 'app://1', 'other://2', 'app://missing'],
      false,
    );

    expect(result).toEqual({
      status: 'started',
      scope: 'path',
      plan: {
        total: 3,
        toProcess: 2,
        toDelete: 0,
        byRoot: { app: 1, other: 1 },
      },
    });
    expect(ops.storedRule).toHaveBeenCalledTimes(3);
    expect(queue.enqueue.mock.calls).toEqual([
      ['app://1', 'r1'],
      ['other://2', 'r2'],
    ]);
  });

  it('plans without enqueueing on a dry run', async () => {
    const ops = makeOps({ 'app://1': 'r1' });
    const queue = { enqueue: vi.fn(() => true) };
    const result = await reindexSources({ ops, queue }, ['app://1'], true);
    expect(result.status).toBe('dry_run');
    expect(result.plan?.toProcess).toBe(1);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('bounds the stored-rule lookups in flight', async () => {
    const refs = Array.from({ length: 20 }, (_, i) => `app://${String(i)}`);
    const ops = makeOps({});
    await reindexSources(
      { ops, queue: { enqueue: vi.fn(() => true) }, concurrency: 3 },
      refs,
      true,
    );
    expect(ops.storedRule).toHaveBeenCalledTimes(20);
    expect(ops.max()).toBeLessThanOrEqual(3);
  });
});
