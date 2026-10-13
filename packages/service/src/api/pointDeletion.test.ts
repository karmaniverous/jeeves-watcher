/**
 * @module api/pointDeletion.test
 * deletePointsByFilter: pages through every match with the given projection, applies the selection predicate, deletes only after collecting, in batches of 256, and returns the deleted payloads.
 */

import { describe, expect, it, vi } from 'vitest';

import { deletePointsByFilter } from './pointDeletion';

/** A store whose scroll returns `count` points over pages of 256. */
function makeStore(count: number) {
  const points = Array.from({ length: count }, (_, i) => ({
    id: String(i),
    payload: { keep: i % 2 === 0 },
  }));
  const order: string[] = [];
  const scrollPage = vi.fn(
    (_f: unknown, limit: number, cursor: number | undefined) => {
      order.push('scroll');
      const start = cursor ?? 0;
      const next = start + limit;
      return Promise.resolve({
        points: points.slice(start, next),
        nextCursor: next < count ? next : undefined,
      });
    },
  );
  const del = vi.fn((ids: string[]) => {
    order.push(`delete:${String(ids.length)}`);
    return Promise.resolve();
  });
  return { store: { scrollPage, delete: del }, order, scrollPage, del };
}

describe('deletePointsByFilter', () => {
  it('collects every page first, then deletes in batches of 256', async () => {
    const { store, order, scrollPage } = makeStore(600);
    const deleted = await deletePointsByFilter(store, { must: [] });
    expect(deleted).toHaveLength(600);
    expect(order).toEqual([
      'scroll',
      'scroll',
      'scroll',
      'delete:256',
      'delete:256',
      'delete:88',
    ]);
    expect((scrollPage.mock.calls[0] as unknown[])[3]).toEqual([]);
  });

  it('deletes only selected points and returns their projected payloads', async () => {
    const { store, del } = makeStore(4);
    const deleted = await deletePointsByFilter(
      store,
      {},
      {
        fields: ['keep'],
        select: (payload) => payload['keep'] === true,
      },
    );
    expect(deleted).toEqual([{ keep: true }, { keep: true }]);
    expect(del).toHaveBeenCalledWith(['0', '2']);
  });

  it('sends no delete when nothing matches', async () => {
    const { store, del } = makeStore(0);
    expect(await deletePointsByFilter(store as never, {})).toEqual([]);
    expect(del).not.toHaveBeenCalled();
  });
});
