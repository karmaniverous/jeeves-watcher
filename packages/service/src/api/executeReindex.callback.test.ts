/**
 * @module api/executeReindex.callback.test
 * Completion callback through executeReindex: the body carries scope, filesProcessed and errors (the failed file paths); a callback that always fails is tried exactly three times, the run still resolves with its own result and is never re-reported with a failure payload (file scope and live prune). Fake timers, stubbed fetch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeDeps } from '../test/reindexDeps';
import { executeReindex, type ExecuteReindexDeps } from './executeReindex';

vi.mock('./fileScan', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listFilesFromGlobs: vi.fn().mockResolvedValue([]),
}));

const CALLBACK_URL = 'http://127.0.0.1:9/cb';
const fetchMock =
  vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>();

/** Deps whose config posts completions to {@link CALLBACK_URL}. */
function callbackDeps(overrides: Partial<ExecuteReindexDeps> = {}) {
  return makeDeps({
    config: {
      watch: { paths: ['src/**'], ignored: [] },
      reindex: { callbackUrl: CALLBACK_URL },
    } as unknown as ExecuteReindexDeps['config'],
    issuesManager: { getAll: () => ({ 'a.txt': [], 'b.txt': [] }) },
    ...overrides,
  });
}

/** Parsed body of the n-th callback request. */
const body = (n: number) =>
  JSON.parse(fetchMock.mock.calls[n][1]?.body as string) as Record<
    string,
    unknown
  >;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('executeReindex completion callback', () => {
  it('posts scope, filesProcessed and errors', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { deps } = callbackDeps();
    await executeReindex(deps, { scope: 'issues' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body(0)).toMatchObject({
      scope: 'issues',
      filesProcessed: 2,
      errors: [],
    });
  });

  it('lists the failed files in the body errors', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { deps, mocks } = callbackDeps();
    mocks.processFile.mockImplementation((file: string) =>
      file === 'b.txt' ? Promise.reject(new Error('bad')) : Promise.resolve(),
    );
    const result = await executeReindex(deps, { scope: 'issues' });
    expect(result).toMatchObject({ filesProcessed: 1, errors: 1 });
    expect(body(0)).toMatchObject({ filesProcessed: 1, errors: ['b.txt'] });
  });

  it('a failing callback is tried three times and the run still resolves', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const { deps } = callbackDeps();
    const run = executeReindex(deps, { scope: 'issues' });
    await vi.runAllTimersAsync();
    const result = await run;
    expect(result).toMatchObject({ filesProcessed: 2, errors: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const n of [0, 1, 2]) {
      expect(body(n)).toMatchObject({ scope: 'issues', errors: [] });
    }
  });

  it('live prune: a failing callback is tried three times and the run resolves', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const vectorStore = {
      scrollPage: vi
        .fn()
        .mockResolvedValue({ points: [], nextCursor: undefined }),
      delete: vi.fn(),
    } as unknown as ExecuteReindexDeps['vectorStore'];
    const { deps } = callbackDeps({ vectorStore });
    const run = executeReindex(deps, { scope: 'prune' });
    await vi.runAllTimersAsync();
    const result = await run;
    expect(result).toMatchObject({ filesProcessed: 0, errors: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(body(2)).toMatchObject({ scope: 'prune', pointsDeleted: 0 });
  });
});
