/**
 * @module api/reindexPrune.test
 * executePrune: the file queue is paused for the whole run and always resumed; a dry run deletes nothing; an incomplete scroll aborts the live prune; orphans are deleted in batches of 500 and reported to the callback; a delete failure fails the run.
 */

import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { computePrunePlan } from './prunePlan';
import { reportReindexCompletion } from './reindexCallback';
import { executePrune } from './reindexPrune';
import type { ExecuteReindexDeps } from './reindexTypes';

vi.mock('./prunePlan', () => ({ computePrunePlan: vi.fn() }));
vi.mock('./reindexCallback', () => ({
  reportReindexCompletion: vi.fn().mockResolvedValue(undefined),
}));

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${String(i)}`);

/** Deps with recording queue, tracker and vector store. */
function makeDeps() {
  const order: string[] = [];
  const queue = {
    pause: vi.fn(() => order.push('pause')),
    resume: vi.fn(() => order.push('resume')),
    waitForIdleWorkers: vi.fn(() => Promise.resolve()),
  };
  const vectorStore = { delete: vi.fn(() => Promise.resolve()) };
  const reindexTracker = { start: vi.fn(), complete: vi.fn() };
  const deps = {
    config: {},
    processor: {},
    logger: pino({ level: 'silent' }),
    queue,
    vectorStore,
    reindexTracker,
  } as unknown as ExecuteReindexDeps;
  return { deps, queue, vectorStore, reindexTracker, order };
}

/** Plan result with `n` orphans. */
function plan(n: number, incomplete = false) {
  return {
    plan: { total: 10, toProcess: 0, toDelete: n, byRoot: {}, incomplete },
    orphanedIds: ids(n),
  };
}

beforeEach(() => {
  vi.mocked(computePrunePlan).mockReset();
  vi.mocked(reportReindexCompletion).mockClear();
});

describe('executePrune', () => {
  it('dry run: plans with the queue paused, deletes nothing', async () => {
    const { deps, vectorStore, order } = makeDeps();
    vi.mocked(computePrunePlan).mockResolvedValue(plan(3));
    const result = await executePrune(deps, true);
    expect(result.plan?.toDelete).toBe(3);
    expect(vectorStore.delete).not.toHaveBeenCalled();
    expect(order).toEqual(['pause', 'resume']);
  });

  it('aborts a live prune whose scroll was incomplete', async () => {
    const { deps, vectorStore, queue } = makeDeps();
    vi.mocked(computePrunePlan).mockResolvedValue(plan(3, true));
    const result = await executePrune(deps, false);
    expect(result.errors).toBe(1);
    expect(vectorStore.delete).not.toHaveBeenCalled();
    expect(queue.resume).toHaveBeenCalledTimes(1);
  });

  it('deletes orphans in batches of 500 and reports completion', async () => {
    const { deps, vectorStore, reindexTracker, order } = makeDeps();
    vi.mocked(computePrunePlan).mockResolvedValue(plan(1200));
    const result = await executePrune(deps, false);
    expect(result.errors).toBe(0);
    expect(
      vectorStore.delete.mock.calls.map((c) => (c as unknown[][])[0].length),
    ).toEqual([500, 500, 200]);
    expect(reindexTracker.start).toHaveBeenCalledWith('prune');
    expect(reindexTracker.complete).toHaveBeenCalled();
    expect(reportReindexCompletion).toHaveBeenCalledWith(
      deps.config,
      expect.objectContaining({ scope: 'prune', pointsDeleted: 1200 }),
      deps.logger,
    );
    expect(order).toEqual(['pause', 'resume']);
  });

  it('fails the run when a delete fails, and resumes the queue', async () => {
    const { deps, vectorStore, queue } = makeDeps();
    vi.mocked(computePrunePlan).mockResolvedValue(plan(2));
    vectorStore.delete.mockRejectedValueOnce(new Error('qdrant down'));
    const result = await executePrune(deps, false);
    expect(result.errors).toBe(1);
    expect(reportReindexCompletion).toHaveBeenCalledWith(
      deps.config,
      expect.objectContaining({ errors: ['qdrant down'] }),
      deps.logger,
    );
    expect(queue.resume).toHaveBeenCalledTimes(1);
  });

  it('resumes the queue and rethrows when planning fails', async () => {
    const { deps, queue } = makeDeps();
    vi.mocked(computePrunePlan).mockRejectedValue(new Error('scroll failed'));
    await expect(executePrune(deps, false)).rejects.toThrow('scroll failed');
    expect(queue.resume).toHaveBeenCalledTimes(1);
  });
});
