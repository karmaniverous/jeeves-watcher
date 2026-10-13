/**
 * @module api/prunePlan.test
 * computePrunePlan: scrolls `source` with `file_path`, never selects source points (non-empty `source`, no `file_path`), prunes legacy file points carrying a rule-written `source`, keeps every chunk of a watched file that exists on disk and orphans every chunk of one that does not.
 */

import { access } from 'node:fs/promises';

import { pino } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listFilesFromGlobs } from './fileScan';
import { computePrunePlan, type PrunePlanDeps } from './prunePlan';

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  access: vi.fn(),
}));

vi.mock('./fileScan', () => ({
  listFilesFromGlobs: vi.fn(),
}));

/** Files that "exist on disk" for the mocked fs.access. */
let onDisk = new Set<string>();

beforeEach(() => {
  vi.clearAllMocks();
  onDisk = new Set();
  vi.mocked(listFilesFromGlobs).mockResolvedValue(['src/gone.ts']);
  vi.mocked(access).mockImplementation((path) =>
    onDisk.has(String(path))
      ? Promise.resolve()
      : Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  );
});

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

  it('never selects source points; file points carrying source are prunable', async () => {
    const { deps } = makeDeps([
      { id: 's1', payload: { source: 'app://chat/thread/1' } },
      {
        id: 's2',
        payload: { source: 'app://chat/thread/2', file_path: 'outside/x.ts' },
      },
      { id: 'f1', payload: { file_path: 'outside/b.ts' } },
      { id: 'f2', payload: { file_path: 'src/gone.ts' } },
      { id: 'n1', payload: {} },
      { id: 'n2', payload: { source: '' } },
    ]);

    const { plan, orphanedIds } = await computePrunePlan(deps);

    expect(orphanedIds.sort()).toEqual(['f1', 'f2', 'n1', 'n2', 's2']);
    expect(plan.total).toBe(6);
    expect(plan.toDelete).toBe(5);
  });

  it('selects nothing when every point is a source point', async () => {
    const { deps } = makeDeps([
      { id: 's1', payload: { source: 'app://a' } },
      { id: 's2', payload: { source: 'app://b' } },
    ]);
    const { orphanedIds } = await computePrunePlan(deps);
    expect(orphanedIds).toEqual([]);
  });
});

describe('computePrunePlan disk check', () => {
  const chunks = (file: string, prefix: string) =>
    [0, 1, 2].map((i) => ({
      id: `${prefix}${String(i)}`,
      payload: { file_path: file, chunk_index: i },
    }));

  it('keeps every chunk of a watched file that exists on disk', async () => {
    vi.mocked(listFilesFromGlobs).mockResolvedValue(['src/kept.ts']);
    onDisk.add('src/kept.ts');
    const { deps } = makeDeps(chunks('src/kept.ts', 'k'));

    const { plan, orphanedIds } = await computePrunePlan(deps);

    expect(orphanedIds).toEqual([]);
    expect(plan).toMatchObject({ total: 3, toDelete: 0 });
    expect(access).toHaveBeenCalledTimes(1);
  });

  it('orphans every chunk of a watched file missing from disk', async () => {
    vi.mocked(listFilesFromGlobs).mockResolvedValue([
      'src/kept.ts',
      'src/gone.ts',
    ]);
    onDisk.add('src/kept.ts');
    const { deps } = makeDeps([
      ...chunks('src/kept.ts', 'k'),
      ...chunks('src/gone.ts', 'g'),
    ]);

    const { plan, orphanedIds } = await computePrunePlan(deps);

    expect(orphanedIds.sort()).toEqual(['g0', 'g1', 'g2']);
    expect(plan).toMatchObject({ total: 6, toDelete: 3 });
  });

  it('orphans every chunk of a file outside the watch scope without a disk check', async () => {
    const { deps } = makeDeps(chunks('outside/x.ts', 'o'));
    const { orphanedIds } = await computePrunePlan(deps);
    expect(orphanedIds.sort()).toEqual(['o0', 'o1', 'o2']);
    expect(access).not.toHaveBeenCalled();
  });
});
