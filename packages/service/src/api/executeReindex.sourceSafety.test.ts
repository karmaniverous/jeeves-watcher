/**
 * @module api/executeReindex.sourceSafety.test
 * executeReindex source safety: callback 404 deletes the document's points, an outage records issues and deletes nothing, config-triggered (no includeSources) runs stay file-only, prune never selects source points.
 */

import { describe, expect, it, vi } from 'vitest';

import { pointId, sourcePointId } from '../pointId';
import {
  doc,
  type Responses,
  seedFile,
  sourceReindexFixture,
} from '../test/sourceReindexFixture';
import { executeReindex } from './executeReindex';

vi.mock('./fileScan', () => ({
  listFilesFromGlobs: vi.fn().mockResolvedValue([]),
  listFilesFromWatchRoots: vi.fn().mockResolvedValue([]),
}));

const A = 'app://chat/thread/a';
const B = 'app://chat/thread/b';
const FILE = 'outside/orphan.md';

function fixture() {
  const responses: Responses = {
    [A]: doc('u1', 'alpha'),
    [B]: doc('u2', 'bravo'),
  };
  return { ...sourceReindexFixture(responses), responses };
}

describe('executeReindex: source safety', () => {
  it('a callback 404 deletes the document points', async () => {
    const f = fixture();
    await f.index(A, B);
    Reflect.deleteProperty(f.responses, A);

    const result = await executeReindex(f.deps, 'full');

    expect(f.store.points.has(sourcePointId(A, 0))).toBe(false);
    expect(f.store.points.has(sourcePointId(B, 0))).toBe(true);
    expect(result.sources).toMatchObject({ deleted: 1, indexed: 1 });
  });

  it.each(['full', 'rules'] as const)(
    'a source outage during %s records issues and deletes nothing',
    async (scope) => {
      const f = fixture();
      await f.index(A, B);
      const before = structuredClone(
        f.store.points.get(sourcePointId(A, 0))?.payload,
      );
      f.responses[A] = {
        kind: 'error',
        code: 'source_unavailable',
        message: 'HTTP 500',
      };
      f.responses[B] = {
        kind: 'error',
        code: 'source_unavailable',
        message: 'HTTP 500',
      };

      const result = await executeReindex(f.deps, scope);

      expect(f.store.delete).not.toHaveBeenCalled();
      expect(f.store.setPayload).not.toHaveBeenCalled();
      expect(f.embed).not.toHaveBeenCalled();
      expect(f.store.points.get(sourcePointId(A, 0))?.payload).toEqual(before);
      expect(f.store.points.has(sourcePointId(B, 0))).toBe(true);
      expect(f.issues.get(A)).toEqual([
        expect.objectContaining({ type: 'source_unavailable' }),
      ]);
      expect(f.issues.get(B)).toBeDefined();
      expect(result.sources).toMatchObject({ failed: 2 });
      expect(result.errors).toBe(2);
    },
  );

  it('a discovery failure fails the run without rejecting or deleting', async () => {
    const f = fixture();
    await f.index(A);
    f.store.scrollPage.mockRejectedValueOnce(new Error('qdrant down'));

    const result = await executeReindex(f.deps, 'full');

    expect(result.errors).toBe(1);
    expect(f.retrieve).not.toHaveBeenCalled();
    expect(f.store.delete).not.toHaveBeenCalled();
  });

  it.each(['full', 'rules', 'issues'] as const)(
    'without includeSources (config-triggered) %s stays file-only',
    async (scope) => {
      const f = fixture();
      await f.index(A);
      f.issues.record(A, 'source_unavailable', 'HTTP 503');

      const result = await executeReindex(
        { ...f.deps, includeSources: false },
        scope,
      );

      expect(f.store.scrollPage).not.toHaveBeenCalled();
      expect(f.retrieve).not.toHaveBeenCalled();
      expect(result.sources).toBeUndefined();
      expect(result.plan?.byRoot).not.toHaveProperty('app');
    },
  );

  it('the issues scope never treats a source reference as a file', async () => {
    const f = fixture();
    const processFile = vi
      .spyOn(f.processor, 'processFile')
      .mockResolvedValue(undefined);
    f.issues.record(A, 'source_unavailable', 'HTTP 503');

    await executeReindex({ ...f.deps, includeSources: false }, 'issues');

    expect(processFile).not.toHaveBeenCalled();
    expect(f.issues.get(A)).toBeDefined();
  });

  it('prune never selects source points, after a full reindex too', async () => {
    const f = fixture();
    await f.index(A, B);
    seedFile(f.store, FILE);
    await executeReindex(f.deps, 'full');
    f.store.delete.mockClear();

    const dry = await executeReindex(f.deps, 'prune', undefined, true);
    expect(dry.plan).toMatchObject({ total: 3, toDelete: 1 });

    await executeReindex(f.deps, 'prune');

    const deleted = f.store.delete.mock.calls.flat(2);
    expect(deleted).toEqual([pointId(FILE, 0)]);
    expect(f.store.points.has(sourcePointId(A, 0))).toBe(true);
    expect(f.store.points.has(sourcePointId(B, 0))).toBe(true);
  });
});
