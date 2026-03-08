import { describe, expect, it, vi } from 'vitest';

import type { ScanRouteDeps } from './scan';
import { createScanHandler } from './scan';

describe('createScanHandler', () => {
  it('returns points and cursor on normal scan', async () => {
    const mockPoints = [
      { id: 'p1', payload: { foo: 'bar' } },
      { id: 'p2', payload: { baz: 'qux' } },
    ];

    const deps: ScanRouteDeps = {
      vectorStore: {
        scrollPage: vi.fn().mockResolvedValue({ points: mockPoints, nextCursor: 'next-123' }),
        count: vi.fn(),
      } as never,
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    };

    const handler = createScanHandler(deps);
    const filter = { must: [{ key: 'domain', match: { value: 'memory' } }] };
    const request = { body: { filter, limit: 10 } } as never;
    const sendMock = vi.fn();
    const reply = { status: vi.fn().mockReturnThis(), send: sendMock } as never;

    await handler(request, reply);

    expect(deps.vectorStore.scrollPage).toHaveBeenCalledWith(filter, 10, undefined, undefined);
    expect(sendMock).toHaveBeenCalledWith({ points: mockPoints, cursor: 'next-123' });
  });

  it('handles empty cursor', async () => {
    const deps: ScanRouteDeps = {
      vectorStore: {
        scrollPage: vi.fn().mockResolvedValue({ points: [], nextCursor: undefined }),
        count: vi.fn(),
      } as never,
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    };

    const handler = createScanHandler(deps);
    const request = { body: { filter: {} } } as never;
    const sendMock = vi.fn();
    const reply = { status: vi.fn().mockReturnThis(), send: sendMock } as never;

    await handler(request, reply);

    expect(sendMock).toHaveBeenCalledWith({ points: [], cursor: null });
  });

  it('returns count when countOnly is true', async () => {
    const deps: ScanRouteDeps = {
      vectorStore: {
        scrollPage: vi.fn(),
        count: vi.fn().mockResolvedValue(42),
      } as never,
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    };

    const handler = createScanHandler(deps);
    const filter = { must: [] };
    const request = { body: { filter, countOnly: true } } as never;
    const sendMock = vi.fn();
    const reply = { status: vi.fn().mockReturnThis(), send: sendMock } as never;

    await handler(request, reply);

    expect(deps.vectorStore.count).toHaveBeenCalledWith(filter);
    expect(deps.vectorStore.scrollPage).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledWith({ count: 42 });
  });

  it('rejects missing filter', async () => {
    const deps: ScanRouteDeps = {
      vectorStore: {} as never,
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    };

    const handler = createScanHandler(deps);
    const request = { body: {} } as never;
    const sendMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ send: sendMock });
    const reply = { status: statusMock, send: sendMock } as never;

    await handler(request, reply);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(sendMock).toHaveBeenCalledWith({ error: 'Missing required field: filter (object)' });
  });

  it('rejects out of bounds limit', async () => {
    const deps: ScanRouteDeps = {
      vectorStore: {} as never,
      logger: { warn: vi.fn(), error: vi.fn() } as never,
    };

    const handler = createScanHandler(deps);
    const request = { body: { filter: {}, limit: 2000 } } as never;
    const sendMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ send: sendMock });
    const reply = { status: statusMock, send: sendMock } as never;

    await handler(request, reply);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(sendMock).toHaveBeenCalledWith({ error: 'limit must be between 1 and 1000' });
  });
});
