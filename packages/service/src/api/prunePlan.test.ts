/**
 * @module api/prunePlan.test
 * Prune guard (row 27): computePrunePlan scrolls `source` with `file_path` and never selects points carrying `source`.
 */

import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { computePrunePlan, type PrunePlanDeps } from './prunePlan';

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  access: vi
    .fn()
    .mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
}));

vi.mock('./fileScan', () => ({
  listFilesFromGlobs: vi.fn().mockResolvedValue(['src/gone.ts']),
}));

function makeDeps(points: Array<{ id: string; payload: object }>) {
  const scrollPage = vi
    .fn()
    .mockResolvedValueOnce({ points, nextCursor: undefined });
  const deps: PrunePlanDeps = {
    config: {
      watch: { paths: ['src/**'], ignored: [] },
    } as unknown as PrunePlanDeps['config'],
    vectorStore: { scrollPage } as unknown as PrunePlanDeps['vectorStore'],
    logger: pino({ level: 'silent' }),
  };
  return { deps, scrollPage };
}

describe('computePrunePlan prune guard', () => {
  it('requests source alongside file_path', async () => {
    const { deps, scrollPage } = makeDeps([]);
    await computePrunePlan(deps);
    expect(scrollPage).toHaveBeenCalledWith(undefined, 500, undefined, [
      'file_path',
      'source',
    ]);
  });

  it('never selects points carrying source', async () => {
    const { deps } = makeDeps([
      { id: 's1', payload: { source: 'cg://chat/thread/1' } },
      {
        id: 's2',
        payload: { source: 'cg://chat/thread/2', file_path: 'outside/x.ts' },
      },
      { id: 'f1', payload: { file_path: 'outside/b.ts' } },
      { id: 'f2', payload: { file_path: 'src/gone.ts' } },
      { id: 'n1', payload: {} },
    ]);

    const { plan, orphanedIds } = await computePrunePlan(deps);

    expect(orphanedIds.sort()).toEqual(['f1', 'f2', 'n1']);
    expect(plan.total).toBe(5);
    expect(plan.toDelete).toBe(3);
  });

  it('selects nothing when every point is a source point', async () => {
    const { deps } = makeDeps([
      { id: 's1', payload: { source: 'cg://a' } },
      { id: 's2', payload: { source: 'cg://b' } },
    ]);
    const { orphanedIds } = await computePrunePlan(deps);
    expect(orphanedIds).toEqual([]);
  });
});
