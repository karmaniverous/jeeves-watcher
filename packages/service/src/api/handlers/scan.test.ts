import { describe, expect, it, vi } from 'vitest';

import type { ScanRouteDeps } from './scan';
import { createScanHandler } from './scan';

describe('createScanHandler', () => {
  const scrollPageMock = vi.fn();
  const countMock = vi.fn();

  const mockDeps = {
    vectorStore: { scrollPage: scrollPageMock, count: countMock },
    logger: { warn: vi.fn(), error: vi.fn() },
  } as unknown as ScanRouteDeps;

  it('returns points and cursor on normal scan', async () => {
    const mockPoints = [
      { id: 'p1', payload: { foo: 'bar' } },
      { id: 'p2', payload: { baz: 'qux' } },
    ];
    scrollPageMock.mockResolvedValue({
      points: mockPoints,
      nextCursor: 'next-123',
    });

    const handler = createScanHandler(mockDeps);
    const filter = { must: [{ key: 'domain', match: { value: 'memory' } }] };
    const request = { body: { filter, limit: 10 } } as never;
    const sendMock = vi.fn();
    const reply = { status: vi.fn().mockReturnThis(), send: sendMock } as never;

    await handler(request, reply);

    expect(scrollPageMock).toHaveBeenCalledWith(
      filter,
      10,
      undefined,
      undefined,
    );
    expect(sendMock).toHaveBeenCalledWith({
      points: mockPoints,
      cursor: 'next-123',
    });
  });

  it('handles empty cursor', async () => {
    scrollPageMock.mockResolvedValue({
      points: [],
      nextCursor: undefined,
    });

    const handler = createScanHandler(mockDeps);
    const request = { body: { filter: {} } } as never;
    const sendMock = vi.fn();
    const reply = { status: vi.fn().mockReturnThis(), send: sendMock } as never;

    await handler(request, reply);

    expect(sendMock).toHaveBeenCalledWith({ points: [], cursor: null });
  });

  it('returns count when countOnly is true', async () => {
    countMock.mockResolvedValue(42);
    scrollPageMock.mockClear();

    const handler = createScanHandler(mockDeps);
    const filter = { must: [] };
    const request = { body: { filter, countOnly: true } } as never;
    const sendMock = vi.fn();
    const reply = { status: vi.fn().mockReturnThis(), send: sendMock } as never;

    await handler(request, reply);

    expect(countMock).toHaveBeenCalledWith(filter);
    expect(scrollPageMock).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledWith({ count: 42 });
  });

  it('rejects missing filter', async () => {
    const handler = createScanHandler(mockDeps);
    const request = { body: {} } as never;
    const sendMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ send: sendMock });
    const reply = { status: statusMock, send: sendMock } as never;

    await handler(request, reply);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(sendMock).toHaveBeenCalledWith({
      error: 'Missing required field: filter (object)',
    });
  });

  it('rejects out of bounds limit', async () => {
    const handler = createScanHandler(mockDeps);
    const request = { body: { filter: {}, limit: 2000 } } as never;
    const sendMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ send: sendMock });
    const reply = { status: statusMock, send: sendMock } as never;

    await handler(request, reply);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(sendMock).toHaveBeenCalledWith({
      error: 'limit must be between 1 and 1000',
    });
  });
});
