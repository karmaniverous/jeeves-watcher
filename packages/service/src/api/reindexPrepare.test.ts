/**
 * @module api/reindexPrepare.test
 * prepareReindex resolves files, source documents and the combined plan; executeReindex reuses prepared targets (no second source scroll or file listing) and, unprepared, resolves them inside the run so a failure fails the run instead of rejecting.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { doc, sourceReindexFixture } from '../test/sourceReindexFixture';
import { executeReindex } from './executeReindex';
import { listFilesFromGlobs } from './fileScan';
import { prepareReindex, toPathArray } from './reindexPrepare';

vi.mock('./fileScan', () => ({
  listFilesFromGlobs: vi.fn(),
  listFilesFromWatchRoots: vi.fn(),
}));

const A = 'app://a';
let stop: (() => Promise<void>) | undefined;

beforeEach(() => {
  vi.mocked(listFilesFromGlobs).mockReset().mockResolvedValue([]);
});

afterEach(async () => {
  await stop?.();
  stop = undefined;
});

/** Fixture with A indexed. */
async function indexed() {
  const fx = sourceReindexFixture({ [A]: doc('u1', 'hello') });
  stop = () => fx.sourceQueue.stop();
  await fx.index(A);
  fx.store.scrollPage.mockClear();
  return fx;
}

describe('toPathArray', () => {
  it.each([
    [undefined, undefined],
    ['a.md', ['a.md']],
    [
      ['a.md', 'b.md'],
      ['a.md', 'b.md'],
    ],
  ])('%j -> %j', (input, expected) => {
    expect(toPathArray(input)).toEqual(expected);
  });
});

describe('prepareReindex', () => {
  it('combines the file plan and the source documents', async () => {
    vi.mocked(listFilesFromGlobs).mockResolvedValue(['src/a.md']);
    const { deps } = await indexed();
    const prepared = await prepareReindex(deps, 'full');
    expect(prepared.fileList).toEqual(['src/a.md']);
    expect(prepared.sources?.targets).toEqual([{ ref: A, rule: 'chat' }]);
    expect(prepared.plan).toEqual({
      total: 2,
      toProcess: 2,
      toDelete: 0,
      byRoot: { src: 1, app: 1 },
    });
  });
});

describe('executeReindex with prepared targets', () => {
  it('reuses them: one listing and one source scroll per request', async () => {
    const { deps, store, retrieve } = await indexed();
    const prepared = await prepareReindex(deps, 'full');
    const result = await executeReindex(deps, { scope: 'full', prepared });
    expect(result.sources).toMatchObject({ unchanged: 0, failed: 0 });
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve.mock.calls[0][0]).toBe(A);
    expect(store.scrollPage).toHaveBeenCalledTimes(1);
    expect(listFilesFromGlobs).toHaveBeenCalledTimes(1);
  });

  it('resolves unprepared targets inside the run (failure fails the run)', async () => {
    const { deps } = await indexed();
    vi.mocked(listFilesFromGlobs).mockRejectedValue(new Error('EACCES'));
    const result = await executeReindex(deps, { scope: 'full' });
    expect(result).toMatchObject({ filesProcessed: 0, errors: 1 });
  });
});
