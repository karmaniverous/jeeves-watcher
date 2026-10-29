/**
 * @module api/catalog/scanHandler.test
 * `createCatalogScanHandler`: points+cursor or count, and a Qdrant filter
 * rejection becomes `400 invalid_request`.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { createCatalogScanHandler } from './scanHandler';

function input(body: Record<string, unknown>) {
  return { params: {}, query: {}, body } as never;
}

describe('createCatalogScanHandler', () => {
  const logger = pino({ level: 'silent' });

  it('returns points and cursor', async () => {
    const scrollPage = vi.fn().mockResolvedValue({
      points: [{ id: 'p1', payload: {} }],
      nextCursor: 'n1',
    });
    const handler = createCatalogScanHandler({
      vectorStore: { scrollPage, count: vi.fn() } as never,
      logger,
    });

    const result = await handler(input({ filter: {}, limit: 5 }), {} as never);

    expect(result).toEqual({
      status: 200,
      body: { points: [{ id: 'p1', payload: {} }], cursor: 'n1' },
    });
  });

  it('returns count when countOnly is set', async () => {
    const count = vi.fn().mockResolvedValue(42);
    const handler = createCatalogScanHandler({
      vectorStore: { scrollPage: vi.fn(), count } as never,
      logger,
    });

    const result = await handler(
      input({ filter: {}, countOnly: true }),
      {} as never,
    );

    expect(result).toEqual({ status: 200, body: { count: 42 } });
  });

  it('maps a Qdrant filter rejection to 400 invalid_request', async () => {
    const rejection = Object.assign(new Error('Bad Request'), {
      status: 400,
      data: { status: { error: 'Wrong filter' } },
    });
    const scrollPage = vi.fn().mockRejectedValue(rejection);
    const handler = createCatalogScanHandler({
      vectorStore: { scrollPage, count: vi.fn() } as never,
      logger,
    });

    const result = await handler(input({ filter: {} }), {} as never);

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: 'invalid_request' });
  });
});
