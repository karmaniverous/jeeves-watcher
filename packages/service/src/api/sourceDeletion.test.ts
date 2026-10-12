/**
 * @module api/sourceDeletion.test
 * Unit tests for source deletion: reference filter, caller-filter constraint (never selects file points), collect-then-delete batching, distinct reference counting.
 */

import { describe, expect, it, vi } from 'vitest';

import type { ScrolledPoint } from '../vectorStore';
import {
  constrainToSources,
  deleteSourcePoints,
  sourcesFilter,
} from './sourceDeletion';

const HAS_SOURCE = { must_not: [{ is_empty: { key: 'source' } }] };

describe('sourcesFilter', () => {
  it('matches any of the references on the source field', () => {
    expect(sourcesFilter(['app://a', 'app://b'])).toEqual({
      must: [{ key: 'source', match: { any: ['app://a', 'app://b'] } }],
    });
  });
});

describe('constrainToSources', () => {
  it('requires source on an empty filter', () => {
    expect(constrainToSources({})).toEqual(HAS_SOURCE);
  });

  it('nests the caller filter so its must_not/should cannot loosen the constraint', () => {
    const caller = {
      should: [{ key: 'file_path', match: { value: 'a.md' } }],
      must_not: [{ key: 'user_id', match: { value: 'u2' } }],
    };
    expect(constrainToSources(caller)).toEqual({
      must: [caller],
      ...HAS_SOURCE,
    });
  });
});

function store(pages: ScrolledPoint[][]) {
  const scrollPage = vi.fn((_f: unknown, _l: unknown, cursor?: number) => {
    const index = cursor ?? 0;
    return Promise.resolve({
      points: pages[index] ?? [],
      nextCursor: index + 1 < pages.length ? index + 1 : undefined,
    });
  });
  const del = vi.fn().mockResolvedValue(undefined);
  return { scrollPage, delete: del };
}

const point = (id: string, source?: unknown): ScrolledPoint => ({
  id,
  payload: source === undefined ? {} : { source },
});

describe('deleteSourcePoints', () => {
  it('collects every page, then deletes and counts distinct references', async () => {
    const vs = store([
      [point('1', 'app://a'), point('2', 'app://a')],
      [point('3', 'app://b')],
    ]);
    const result = await deleteSourcePoints(vs, { must: [] });
    expect(result).toEqual({ sources: ['app://a', 'app://b'], points: 3 });
    expect(vs.scrollPage).toHaveBeenCalledTimes(2);
    expect(vs.scrollPage.mock.calls[0]).toEqual([
      { must: [] },
      256,
      undefined,
      ['source'],
    ]);
    expect(vs.delete).toHaveBeenCalledWith(['1', '2', '3']);
    // Deletes happen only after scrolling finished.
    expect(vs.delete.mock.invocationCallOrder[0]).toBeGreaterThan(
      vs.scrollPage.mock.invocationCallOrder[1],
    );
  });

  it('never deletes a point without a source reference', async () => {
    const vs = store([[point('f', undefined), point('e', ''), point('s', 7)]]);
    expect(await deleteSourcePoints(vs, {})).toEqual({
      sources: [],
      points: 0,
    });
    expect(vs.delete).not.toHaveBeenCalled();
  });

  it('deletes in batches of 256', async () => {
    const many = Array.from({ length: 600 }, (_, i) =>
      point(String(i), `app://${String(i % 3)}`),
    );
    const vs = store([many]);
    const result = await deleteSourcePoints(vs, {});
    expect(result.points).toBe(600);
    expect(result.sources).toHaveLength(3);
    expect(vs.delete.mock.calls.map((c) => (c[0] as string[]).length)).toEqual([
      256, 256, 88,
    ]);
  });
});
