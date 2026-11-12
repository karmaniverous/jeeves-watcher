/**
 * @module api/sourceDocumentsDelete.test
 * deleteSourceDocuments (D98, D118): each document is deleted under its own lock with the route's bounded wait; the sources form clears enrichment and issues even for a reference with no points; the filter form collects references across scroll pages (file points never), deletes only matching points and clears only documents it deleted; a rejected filter is 400 before anything is deleted; a lock timeout keeps earlier deletions.
 */

import { describe, expect, it, vi } from 'vitest';

import { DocumentLockTimeoutError } from '../processor/DocumentLocks';
import type { ScrollPageResult } from '../vectorStore';
import { FilterRejected } from './errors';
import { constrainToSources, sourcesFilter } from './sourceDeletion';
import { deleteSourceDocuments } from './sourceDocumentsDelete';

interface FakePoint {
  id: string;
  payload: Record<string, unknown>;
}

/** The `source` `match.any` values a filter names (deeply), if any. */
function namedSources(filter: unknown): string[] | undefined {
  if (typeof filter !== 'object' || filter === null) return undefined;
  const node = filter as Record<string, unknown>;
  const match = node.match as { any?: string[] } | undefined;
  if (node.key === 'source' && match?.any) return match.any;
  for (const value of Object.values(node)) {
    const children: unknown[] = Array.isArray(value) ? value : [value];
    for (const child of children) {
      const found = namedSources(child);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * In-memory store: a filter naming sources matches those source points; any
 * other filter matches every point (file points included), two per page.
 */
function fakeStore(points: FakePoint[]) {
  const scrollPage = vi.fn(
    (filter?: Record<string, unknown>, _limit?: number, offset?: unknown) => {
      const names = namedSources(filter);
      const matched = names
        ? points.filter((p) => names.includes(String(p.payload.source)))
        : points;
      const start = typeof offset === 'number' ? offset : 0;
      const page: ScrollPageResult = {
        points: matched.slice(start, start + 2),
        ...(start + 2 < matched.length ? { nextCursor: start + 2 } : {}),
      };
      return Promise.resolve(page);
    },
  );
  const del = vi.fn((ids: string[]) => {
    for (const id of ids) {
      const index = points.findIndex((p) => p.id === id);
      if (index >= 0) points.splice(index, 1);
    }
    return Promise.resolve();
  });
  return { scrollPage, delete: del };
}

const src = (id: string, ref: string): FakePoint => ({
  id,
  payload: { source: ref },
});

function deps(points: FakePoint[]) {
  const vectorStore = fakeStore(points);
  const withLock = vi.fn(
    (_ref: string, _op: string, work: () => Promise<unknown>) => work(),
  );
  const enrichmentStore = { delete: vi.fn() };
  const issuesManager = { clear: vi.fn() };
  return {
    vectorStore,
    withLock,
    enrichmentStore,
    issuesManager,
    deps: {
      vectorStore,
      sources: { withLock } as never,
      enrichmentStore,
      issuesManager,
      logger: { debug: vi.fn() },
    },
  };
}

describe('deleteSourceDocuments', () => {
  it('sources form: one lock per distinct reference; clears listed ones without points', async () => {
    const points = [src('1', 'app://a'), src('2', 'app://a')];
    const t = deps(points);
    const result = await deleteSourceDocuments(
      t.deps,
      { sources: ['app://a', 'app://none', 'app://a'] },
      10_000,
    );
    expect(result).toEqual({ deleted: ['app://a'], points: 2 });
    expect(points).toEqual([]);
    expect(
      t.withLock.mock.calls.map((c) => [c[0], c[1], (c as unknown[])[3]]),
    ).toEqual([
      ['app://a', 'deleteDocuments', { lockWaitMs: 10_000 }],
      ['app://none', 'deleteDocuments', { lockWaitMs: 10_000 }],
    ]);
    expect(t.enrichmentStore.delete.mock.calls).toEqual([
      ['app://a'],
      ['app://none'],
    ]);
    expect(t.issuesManager.clear.mock.calls).toEqual([
      ['app://a'],
      ['app://none'],
    ]);
  });

  it('filter form: references across pages, file points never; only matching points', async () => {
    const filter = { must: [{ key: 'domain', match: { value: 'x' } }] };
    const file: FakePoint = { id: 'f', payload: { file_path: '/d/a.md' } };
    const points = [src('1', 'app://a'), file, src('2', 'app://b')];
    const t = deps(points);
    // Two scroll pages; the file point on the first is skipped.
    t.vectorStore.scrollPage.mockImplementationOnce(() =>
      Promise.resolve({ points: points.slice(0, 2), nextCursor: 2 }),
    );
    t.vectorStore.scrollPage.mockImplementationOnce(() =>
      Promise.resolve({ points: points.slice(2) }),
    );
    const result = await deleteSourceDocuments(t.deps, { filter }, 50);

    expect(t.withLock.mock.calls.map((c) => c[0])).toEqual([
      'app://a',
      'app://b',
    ]);
    const base = constrainToSources(filter);
    expect(t.vectorStore.scrollPage.mock.calls[2][0]).toEqual({
      must: [base, sourcesFilter(['app://a'])],
    });
    expect(result.deleted).toEqual(['app://a', 'app://b']);
    expect(points).toEqual([file]);
    expect(t.enrichmentStore.delete).toHaveBeenCalledTimes(2);
  });

  it('filter form: a reference whose matching points are gone is not cleared', async () => {
    const points = [src('1', 'app://a')];
    const t = deps(points);
    t.vectorStore.scrollPage.mockImplementationOnce(() =>
      Promise.resolve({ points: [src('9', 'app://gone')] }),
    );
    const result = await deleteSourceDocuments(
      t.deps,
      { filter: { must: [{ key: 'k', match: { value: 1 } }] } },
      50,
    );
    expect(result).toEqual({ deleted: [], points: 0 });
    expect(t.enrichmentStore.delete).not.toHaveBeenCalled();
    expect(t.issuesManager.clear).not.toHaveBeenCalled();
  });

  it('a filter Qdrant rejects is 400 before anything is deleted', async () => {
    const t = deps([src('1', 'app://a')]);
    t.vectorStore.scrollPage.mockRejectedValueOnce(
      Object.assign(new Error('Bad Request'), {
        status: 400,
        data: { status: { error: 'bad filter' } },
      }),
    );
    const error = await deleteSourceDocuments(
      t.deps,
      { filter: { must: [{ key: 'k', match: { value: 1 } }] } },
      50,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FilterRejected);
    expect(error).toMatchObject({ statusCode: 400 });
    expect(t.withLock).not.toHaveBeenCalled();
    expect(t.vectorStore.delete).not.toHaveBeenCalled();
  });

  it('a lock timeout throws and keeps the documents already deleted', async () => {
    const points = [src('1', 'app://a'), src('2', 'app://b')];
    const t = deps(points);
    t.withLock
      .mockImplementationOnce((_r, _o, work) => work())
      .mockRejectedValueOnce(
        new DocumentLockTimeoutError('app://b', 'deleteDocuments', 50),
      );
    await expect(
      deleteSourceDocuments(t.deps, { sources: ['app://a', 'app://b'] }, 50),
    ).rejects.toBeInstanceOf(DocumentLockTimeoutError);
    expect(points).toEqual([src('2', 'app://b')]);
  });
});
