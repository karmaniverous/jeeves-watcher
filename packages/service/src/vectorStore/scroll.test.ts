import { describe, expect, it, vi } from 'vitest';

import { scrollCollection, scrollPage } from './scroll';

type MockClient = Parameters<typeof scrollCollection>[0];

function makeMockClient(
  pages: Array<{
    points: Array<{ id: string | number; payload: Record<string, unknown> }>;
    next_page_offset?: string | number | null;
  }>,
): { client: MockClient; scrollMock: ReturnType<typeof vi.fn> } {
  const scrollMock = vi.fn();
  for (const page of pages) {
    scrollMock.mockResolvedValueOnce(page);
  }
  return {
    client: { scroll: scrollMock } as unknown as MockClient,
    scrollMock,
  };
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) {
    items.push(item);
  }
  return items;
}

describe('scrollPage', () => {
  it('returns points and next cursor', async () => {
    const { client, scrollMock } = makeMockClient([
      {
        points: [
          { id: 'a', payload: { x: 1 } },
          { id: 'b', payload: { x: 2 } },
        ],
        next_page_offset: 'cursor-1',
      },
    ]);

    const result = await scrollPage(client, 'col', undefined, 50);

    expect(result.points).toEqual([
      { id: 'a', payload: { x: 1 } },
      { id: 'b', payload: { x: 2 } },
    ]);
    expect(result.nextCursor).toBe('cursor-1');
    expect(scrollMock).toHaveBeenCalledWith('col', {
      limit: 50,
      with_payload: true,
      with_vector: false,
    });
  });

  it('returns undefined nextCursor when no more pages', async () => {
    const { client } = makeMockClient([
      { points: [{ id: '1', payload: {} }], next_page_offset: null },
    ]);

    const result = await scrollPage(client, 'col');

    expect(result.nextCursor).toBeUndefined();
  });

  it('passes filter and offset', async () => {
    const { client, scrollMock } = makeMockClient([
      { points: [], next_page_offset: null },
    ]);
    const filter = { must: [{ key: 'domain', match: { value: 'docs' } }] };

    await scrollPage(client, 'col', filter, 100, 'offset-abc');

    expect(scrollMock).toHaveBeenCalledWith('col', {
      limit: 100,
      with_payload: true,
      with_vector: false,
      filter,
      offset: 'offset-abc',
    });
  });

  it('passes field projection to with_payload', async () => {
    const { client, scrollMock } = makeMockClient([
      { points: [], next_page_offset: null },
    ]);

    await scrollPage(client, 'col', undefined, 10, undefined, [
      'file_path',
      'domain',
    ]);

    expect(scrollMock).toHaveBeenCalledWith('col', {
      limit: 10,
      with_payload: ['file_path', 'domain'],
      with_vector: false,
    });
  });

  it('converts numeric IDs to strings', async () => {
    const { client } = makeMockClient([
      { points: [{ id: 99, payload: {} }], next_page_offset: null },
    ]);

    const result = await scrollPage(client, 'col');

    expect(result.points[0].id).toBe('99');
  });
});

describe('scrollCollection', () => {
  it('yields all points from a single page', async () => {
    const { client } = makeMockClient([
      {
        points: [
          { id: 'a', payload: { x: 1 } },
          { id: 'b', payload: { x: 2 } },
        ],
        next_page_offset: null,
      },
    ]);

    const results = await collect(scrollCollection(client, 'col'));

    expect(results).toEqual([
      { id: 'a', payload: { x: 1 } },
      { id: 'b', payload: { x: 2 } },
    ]);
  });

  it('paginates across multiple pages', async () => {
    const { client, scrollMock } = makeMockClient([
      {
        points: [{ id: '1', payload: {} }],
        next_page_offset: 'offset-1',
      },
      {
        points: [{ id: '2', payload: {} }],
        next_page_offset: null,
      },
    ]);

    const results = await collect(scrollCollection(client, 'col'));

    expect(results).toHaveLength(2);
    expect(scrollMock).toHaveBeenCalledTimes(2);
  });

  it('passes filter to scroll calls', async () => {
    const { client, scrollMock } = makeMockClient([
      { points: [], next_page_offset: null },
    ]);
    const filter = { must: [{ key: 'source', match: { value: 'docs' } }] };

    await collect(scrollCollection(client, 'col', filter));

    expect(scrollMock).toHaveBeenCalledWith(
      'col',
      expect.objectContaining({ filter }),
    );
  });

  it('uses custom limit', async () => {
    const { client, scrollMock } = makeMockClient([
      { points: [], next_page_offset: null },
    ]);

    await collect(scrollCollection(client, 'col', undefined, 50));

    expect(scrollMock).toHaveBeenCalledWith(
      'col',
      expect.objectContaining({ limit: 50 }),
    );
  });

  it('converts numeric IDs to strings', async () => {
    const { client } = makeMockClient([
      { points: [{ id: 42, payload: {} }], next_page_offset: null },
    ]);

    const results = await collect(scrollCollection(client, 'col'));

    expect(results[0].id).toBe('42');
  });

  it('stops on undefined next_page_offset', async () => {
    const { client } = makeMockClient([{ points: [{ id: '1', payload: {} }] }]);

    const results = await collect(scrollCollection(client, 'col'));

    expect(results).toHaveLength(1);
  });
});
