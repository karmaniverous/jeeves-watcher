/**
 * @module api/executeReindex.prune.test
 * executeReindex prune scope over mocks (fake timers for scroll retries): a live prune deletes exactly the orphaned ids and keeps a watched file present on disk; dry-run and live plans are identical; a failed page is retried from the same cursor; an exhausted scroll leaves an incomplete plan and the live prune deletes nothing; filter-first orphan detection.
 */

import { access } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeDeps } from '../test/reindexDeps';
import { executeReindex, type ExecuteReindexDeps } from './executeReindex';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<object>();
  return {
    ...original,
    access: vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      ),
  };
});

// Intercept listFilesFromGlobs and listFilesFromWatchRoots.
vi.mock('./fileScan', async (importOriginal) => {
  const original = await importOriginal<object>();
  return {
    ...original,
    listFilesFromGlobs: vi.fn().mockResolvedValue([]),
    listFilesFromWatchRoots: vi.fn().mockResolvedValue([]),
  };
});

import { listFilesFromGlobs } from './fileScan';

const listFilesFromGlobsMock = vi.mocked(listFilesFromGlobs);
const accessMock = vi.mocked(access);
const fetchFailed = () => new TypeError('fetch failed');

/** Deps over a vector store with the given scroll and delete mocks. */
function pruneDeps(
  scrollPage: ReturnType<typeof vi.fn>,
  del: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
) {
  return makeDeps({
    vectorStore: {
      scrollPage,
      delete: del,
    } as unknown as ExecuteReindexDeps['vectorStore'],
  }).deps;
}

/** Run a reindex to completion, flushing retry back-off timers. */
async function run(
  deps: ExecuteReindexDeps,
  dryRun: boolean,
): ReturnType<typeof executeReindex> {
  const pending = executeReindex(deps, { scope: 'prune', dryRun });
  await vi.runAllTimersAsync();
  return pending;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('executeReindex prune (live)', () => {
  it('deletes exactly the orphaned ids and keeps a watched file on disk', async () => {
    listFilesFromGlobsMock.mockResolvedValueOnce(['src/a.ts']);
    accessMock.mockResolvedValueOnce(undefined);
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const scrollPageFn = vi.fn().mockResolvedValueOnce({
      points: [
        { id: 'p1', payload: { file_path: 'src/a.ts' } },
        { id: 'p2', payload: { file_path: 'outside/b.ts' } },
      ],
      nextCursor: undefined,
    });

    const result = await run(pruneDeps(scrollPageFn, deleteFn), false);

    expect(result.errors).toBe(0);
    expect(result.plan).toMatchObject({ total: 2, toDelete: 1 });
    expect(deleteFn.mock.calls).toEqual([[['p2']]]);
  });

  it('plans identically to a dry run', async () => {
    const page = {
      points: [
        { id: 'p1', payload: { file_path: 'src/a.ts' } },
        { id: 'p2', payload: { file_path: 'outside/b.ts' } },
        { id: 'p3', payload: { file_path: 'outside/c.ts' } },
      ],
      nextCursor: undefined,
    };
    const dry = await run(pruneDeps(vi.fn().mockResolvedValueOnce(page)), true);
    const live = await run(
      pruneDeps(vi.fn().mockResolvedValueOnce(page)),
      false,
    );
    expect(dry.plan).toEqual({
      total: 3,
      toProcess: 0,
      toDelete: 3,
      byRoot: { src: 1, '(unmatched)': 2 },
    });
    expect(live.plan).toEqual(dry.plan);
  });

  it('deletes nothing when the scroll is exhausted (incomplete plan)', async () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const scrollPageFn = vi
      .fn()
      .mockResolvedValueOnce({
        points: [{ id: 'p1', payload: { file_path: 'outside/b.ts' } }],
        nextCursor: 'cursor-1',
      })
      .mockRejectedValue(fetchFailed());

    const result = await run(pruneDeps(scrollPageFn, deleteFn), false);

    expect(result.errors).toBe(1);
    expect(result.plan).toMatchObject({ total: 1, incomplete: true });
    // One good page, then five attempts at the failing page.
    expect(scrollPageFn).toHaveBeenCalledTimes(6);
    expect(deleteFn).not.toHaveBeenCalled();
  });
});

describe('executeReindex prune scroll retry', () => {
  it('retries a failed page from the same cursor and completes the plan', async () => {
    const scrollPageFn = vi
      .fn()
      .mockResolvedValueOnce({
        points: [{ id: 'p1', payload: { file_path: 'src/a.ts' } }],
        nextCursor: 'cursor-1',
      })
      .mockRejectedValueOnce(fetchFailed())
      .mockRejectedValueOnce(fetchFailed())
      .mockRejectedValueOnce(fetchFailed())
      .mockRejectedValueOnce(fetchFailed())
      .mockResolvedValueOnce({
        points: [{ id: 'p2', payload: { file_path: 'outside/b.ts' } }],
        nextCursor: undefined,
      });

    const result = await run(pruneDeps(scrollPageFn), true);

    expect(result.plan).toMatchObject({ total: 2, toDelete: 2 });
    expect(result.plan?.incomplete).toBeUndefined();
    expect(scrollPageFn).toHaveBeenCalledTimes(6);
    expect(scrollPageFn.mock.calls.map((call) => call[2] as unknown)).toEqual([
      undefined,
      'cursor-1',
      'cursor-1',
      'cursor-1',
      'cursor-1',
      'cursor-1',
    ]);
  });
});

describe('executeReindex prune filter-first', () => {
  it('orphans points outside the watch scope, missing from disk, or without file_path', async () => {
    listFilesFromGlobsMock.mockResolvedValueOnce(['src/a.ts']);
    const scrollPageFn = vi.fn().mockResolvedValueOnce({
      points: [
        { id: 'p1', payload: { file_path: 'src/a.ts' } },
        { id: 'p2', payload: { file_path: 'outside/b.ts' } },
        { id: 'p3', payload: {} },
      ],
      nextCursor: undefined,
    });

    // fs.access rejects (ENOENT) by default, so p1 is orphaned too.
    const result = await run(pruneDeps(scrollPageFn), true);

    expect(result.plan).toMatchObject({ total: 3, toDelete: 3 });
  });
});
