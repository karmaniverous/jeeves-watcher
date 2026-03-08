import { describe, expect, it, vi } from 'vitest';

import { countPoints } from './count';

type MockClient = Parameters<typeof countPoints>[0];

describe('countPoints', () => {
  it('returns count with no filter', async () => {
    const countMock = vi.fn().mockResolvedValue({ count: 42 });
    const client = { count: countMock } as unknown as MockClient;

    const result = await countPoints(client, 'my-collection');

    expect(result).toBe(42);
    expect(countMock).toHaveBeenCalledWith('my-collection', { exact: true });
  });

  it('passes filter to Qdrant', async () => {
    const countMock = vi.fn().mockResolvedValue({ count: 7 });
    const client = { count: countMock } as unknown as MockClient;
    const filter = { must: [{ key: 'domain', match: { value: 'docs' } }] };

    const result = await countPoints(client, 'col', filter);

    expect(result).toBe(7);
    expect(countMock).toHaveBeenCalledWith('col', { filter, exact: true });
  });

  it('returns zero for empty collection', async () => {
    const countMock = vi.fn().mockResolvedValue({ count: 0 });
    const client = { count: countMock } as unknown as MockClient;

    const result = await countPoints(client, 'col');

    expect(result).toBe(0);
  });
});
