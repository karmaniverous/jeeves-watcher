/**
 * @module api/executeReindex.prune.test
 * Unit tests for executeReindex prune scope over mocks: dry-run vs live plans, scroll retries, incomplete-plan safety and filter-first orphan detection.
 */

import { describe, expect, it, vi } from 'vitest';

import { executeReindex, type ExecuteReindexDeps } from './executeReindex';
import { makeDeps } from './executeReindexTestDeps';

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

describe('executeReindex', () => {
  describe('dryRun', () => {
    it('prune scope: executes deletions when dryRun is false', async () => {
      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const scrollPageFn = vi.fn().mockResolvedValueOnce({
        points: [
          { id: 'p1', payload: { file_path: 'src/a.ts' } },
          { id: 'p2', payload: { file_path: 'outside/b.ts' } },
        ],
        nextCursor: undefined,
      });
      const { deps } = makeDeps({
        vectorStore: {
          scrollPage: scrollPageFn,
          delete: deleteFn,
        } as unknown as ExecuteReindexDeps['vectorStore'],
      });
      const result = await executeReindex(deps, { scope: 'prune' });
      expect(result.plan).toBeDefined();
      expect(deleteFn).toHaveBeenCalled();
    });

    it('prune scope: retries on scroll failure and resumes', async () => {
      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const scrollPageFn = vi
        .fn()
        .mockResolvedValueOnce({
          points: [{ id: 'p1', payload: { file_path: 'src/a.ts' } }],
          nextCursor: 'cursor-1',
        })
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce({
          points: [{ id: 'p2', payload: { file_path: 'outside/b.ts' } }],
          nextCursor: undefined,
        });
      const { deps } = makeDeps({
        vectorStore: {
          scrollPage: scrollPageFn,
          delete: deleteFn,
        } as unknown as ExecuteReindexDeps['vectorStore'],
      });
      const result = await executeReindex(deps, {
        scope: 'prune',
        dryRun: true,
      });
      expect(result.plan).toBeDefined();
      expect(result.plan!.total).toBe(2);
      expect(result.plan!.incomplete).toBeUndefined();
      // scrollPage called 3 times: page 1 ok, page 2 fail, page 2 retry ok
      expect(scrollPageFn).toHaveBeenCalledTimes(3);
    });

    it('prune scope: dry-run and live prune produce identical plans', async () => {
      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const makeScrollFn = () =>
        vi.fn().mockResolvedValueOnce({
          points: [
            { id: 'p1', payload: { file_path: 'src/a.ts' } },
            { id: 'p2', payload: { file_path: 'outside/b.ts' } },
            { id: 'p3', payload: { file_path: 'outside/c.ts' } },
          ],
          nextCursor: undefined,
        });

      const scrollDry = makeScrollFn();
      const { deps: dryDeps } = makeDeps({
        vectorStore: {
          scrollPage: scrollDry,
          delete: deleteFn,
        } as unknown as ExecuteReindexDeps['vectorStore'],
      });
      const dryResult = await executeReindex(dryDeps, {
        scope: 'prune',
        dryRun: true,
      });

      const scrollLive = makeScrollFn();
      const { deps: liveDeps } = makeDeps({
        vectorStore: {
          scrollPage: scrollLive,
          delete: deleteFn,
        } as unknown as ExecuteReindexDeps['vectorStore'],
      });
      const liveResult = await executeReindex(liveDeps, { scope: 'prune' });

      // Plans should match
      expect(dryResult.plan!.total).toBe(liveResult.plan!.total);
      expect(dryResult.plan!.toDelete).toBe(liveResult.plan!.toDelete);
      expect(dryResult.plan!.toProcess).toBe(liveResult.plan!.toProcess);
    });

    it('prune scope: live prune aborts when plan is incomplete', async () => {
      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const scrollPageFn = vi
        .fn()
        .mockResolvedValueOnce({
          points: [{ id: 'p1', payload: { file_path: 'outside/b.ts' } }],
          nextCursor: 'cursor-1',
        })
        .mockRejectedValue(new TypeError('fetch failed'));
      const { deps } = makeDeps({
        vectorStore: {
          scrollPage: scrollPageFn,
          delete: deleteFn,
        } as unknown as ExecuteReindexDeps['vectorStore'],
      });
      const result = await executeReindex(deps, { scope: 'prune' });

      // Should abort with error and NOT call delete
      expect(result.errors).toBe(1);
      expect(result.plan!.incomplete).toBe(true);
      expect(deleteFn).not.toHaveBeenCalled();
    }, 60000);

    it('prune scope: increased retries recover from transient failures', async () => {
      const scrollPageFn = vi
        .fn()
        .mockResolvedValueOnce({
          points: [{ id: 'p1', payload: { file_path: 'src/a.ts' } }],
          nextCursor: 'cursor-1',
        })
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce({
          points: [{ id: 'p2', payload: { file_path: 'outside/b.ts' } }],
          nextCursor: undefined,
        });
      const { deps } = makeDeps({
        vectorStore: {
          scrollPage: scrollPageFn,
          delete: vi.fn(),
        } as unknown as ExecuteReindexDeps['vectorStore'],
      });
      const result = await executeReindex(deps, {
        scope: 'prune',
        dryRun: true,
      });
      expect(result.plan).toBeDefined();
      expect(result.plan!.total).toBe(2);
      expect(result.plan!.incomplete).toBeUndefined();
    }, 30000);

    it('prune scope: returns incomplete plan when all retries exhausted', async () => {
      const scrollPageFn = vi
        .fn()
        .mockResolvedValueOnce({
          points: [{ id: 'p1', payload: { file_path: 'src/a.ts' } }],
          nextCursor: 'cursor-1',
        })
        .mockRejectedValue(new TypeError('fetch failed'));
      const { deps } = makeDeps({
        vectorStore: {
          scrollPage: scrollPageFn,
          delete: vi.fn(),
        } as unknown as ExecuteReindexDeps['vectorStore'],
      });
      const result = await executeReindex(deps, {
        scope: 'prune',
        dryRun: true,
      });
      expect(result.plan).toBeDefined();
      expect(result.plan!.total).toBe(1);
      expect(result.plan!.incomplete).toBe(true);
    }, 60000);

    it('filter-first: detects orphans outside watch scope', async () => {
      // Watched files: src/a.ts exists on filesystem
      listFilesFromGlobsMock.mockResolvedValueOnce(['src/a.ts']);

      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const scrollPageFn = vi.fn().mockResolvedValueOnce({
        points: [
          { id: 'p1', payload: { file_path: 'src/a.ts' } },
          { id: 'p2', payload: { file_path: 'outside/b.ts' } },
          { id: 'p3', payload: {} },
        ],
        nextCursor: undefined,
      });
      const { deps } = makeDeps({
        vectorStore: {
          scrollPage: scrollPageFn,
          delete: deleteFn,
        } as unknown as ExecuteReindexDeps['vectorStore'],
      });

      // fs.access is mocked to reject (ENOENT) by default, so p1 is also orphaned
      const result = await executeReindex(deps, {
        scope: 'prune',
        dryRun: true,
      });
      expect(result.plan).toBeDefined();
      expect(result.plan!.total).toBe(3);
      // p1 (in scope but not on disk), p2 (outside scope), p3 (no file_path) — all orphans
      expect(result.plan!.toDelete).toBe(3);
    });

    it('filter-first: detects files deleted from disk as orphans', async () => {
      // Watched files list includes src/deleted.ts (matches watch scope)
      // but the file doesn't exist on disk
      listFilesFromGlobsMock.mockResolvedValueOnce(['src/deleted.ts']);

      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const scrollPageFn = vi.fn().mockResolvedValueOnce({
        points: [{ id: 'p1', payload: { file_path: 'src/deleted.ts' } }],
        nextCursor: undefined,
      });
      const { deps } = makeDeps({
        vectorStore: {
          scrollPage: scrollPageFn,
          delete: deleteFn,
        } as unknown as ExecuteReindexDeps['vectorStore'],
      });

      const result = await executeReindex(deps, {
        scope: 'prune',
        dryRun: true,
      });
      expect(result.plan).toBeDefined();
      // src/deleted.ts is in watch scope but doesn't exist on disk → orphan
      expect(result.plan!.toDelete).toBe(1);
    });

    it('filter-first: preserves incomplete safety from Step 5', async () => {
      listFilesFromGlobsMock.mockResolvedValueOnce(['src/a.ts']);

      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const scrollPageFn = vi
        .fn()
        .mockResolvedValueOnce({
          points: [{ id: 'p1', payload: { file_path: 'src/a.ts' } }],
          nextCursor: 'cursor-1',
        })
        .mockRejectedValue(new TypeError('fetch failed'));
      const { deps } = makeDeps({
        vectorStore: {
          scrollPage: scrollPageFn,
          delete: deleteFn,
        } as unknown as ExecuteReindexDeps['vectorStore'],
      });

      const result = await executeReindex(deps, { scope: 'prune' });
      expect(result.errors).toBe(1);
      expect(result.plan!.incomplete).toBe(true);
      expect(deleteFn).not.toHaveBeenCalled();
    }, 60000);
  });
});
