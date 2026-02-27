import { describe, expect, it, vi } from 'vitest';

import type { PointsDeleteDeps } from './pointsDelete';
import { createPointsDeleteHandler } from './pointsDelete';

describe('createPointsDeleteHandler', () => {
  it('deletes matching points', async () => {
    const deleteMock = vi.fn();
    const mockPoints = [
      { id: 'p1', payload: {} },
      { id: 'p2', payload: {} },
    ];

    function* scrollGen() {
      for (const p of mockPoints) {
        yield p;
      }
    }

    const deps: PointsDeleteDeps = {
      vectorStore: {
        scroll: vi.fn().mockReturnValue(scrollGen()),
        delete: deleteMock,
      } as never,
      logger: { info: vi.fn(), error: vi.fn() } as never,
    };

    const handler = createPointsDeleteHandler(deps);
    const filter = { must: [{ key: 'domain', match: { value: 'memory' } }] };
    const request = { body: { filter } } as never;
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as never;

    await handler(request, reply);

    expect(deleteMock).toHaveBeenCalledWith(['p1', 'p2']);
  });

  it('handles no matching points', async () => {
    function* emptyGen() {
      // yields nothing
    }

    const deleteMock = vi.fn();
    const deps: PointsDeleteDeps = {
      vectorStore: {
        scroll: vi.fn().mockReturnValue(emptyGen()),
        delete: deleteMock,
      } as never,
      logger: { info: vi.fn(), error: vi.fn() } as never,
    };

    const handler = createPointsDeleteHandler(deps);
    const request = { body: { filter: { must: [] } } } as never;
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as never;

    await handler(request, reply);

    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('rejects missing filter', async () => {
    const deps: PointsDeleteDeps = {
      vectorStore: {} as never,
      logger: { info: vi.fn(), error: vi.fn() } as never,
    };

    const handler = createPointsDeleteHandler(deps);
    const request = { body: {} } as never;
    const statusMock = vi.fn().mockReturnThis();
    const reply = { status: statusMock, send: vi.fn() } as never;

    await handler(request, reply);

    expect(statusMock).toHaveBeenCalledWith(500);
  });
});
