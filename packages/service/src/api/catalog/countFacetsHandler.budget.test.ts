/**
 * @module api/catalog/countFacetsHandler.budget.test
 * `POST /search/facets/counts` cost bound (D96): 503 naming the fields not counted within the budget, at most 4 fields at a time, and the slow-request log.
 */

import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deps, fakeStore, post } from '../../test/countFacetsDeps';
import { createCatalogCountFacetsHandler } from './countFacetsHandler';

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /search/facets/counts budget', () => {
  it('counts the index-type read against the budget (503 naming every field)', async () => {
    const store = fakeStore({
      payloadIndexTypes: vi.fn(
        () =>
          new Promise<Record<string, string>>((resolve) => {
            setTimeout(() => {
              resolve({ tag: 'keyword' });
            }, 400);
          }),
      ),
    });
    const { status, body } = await post(deps(store, { budgetMs: 50 }), {
      fields: ['tag', 'size', 'tag'],
    });
    expect(status).toBe(503);
    expect(body).toMatchObject({
      code: 'not_available',
      details: { pending: ['tag', 'size'] },
    });
    expect(store.facetCounts).not.toHaveBeenCalled();
  });

  it('answers 503 naming the fields not counted within the budget', async () => {
    const slow = () =>
      new Promise<never[]>((resolve) => {
        setTimeout(() => {
          resolve([]);
        }, 200);
      });
    const store = fakeStore({
      facetCounts: vi.fn((read: { field: string }) =>
        read.field === 'tag' ? Promise.resolve([]) : slow(),
      ),
      payloadIndexTypes: vi.fn(() =>
        Promise.resolve({ tag: 'keyword', a: 'keyword', b: 'keyword' }),
      ),
    });
    const { status, body } = await post(deps(store, { budgetMs: 50 }), {
      fields: ['tag', 'a', 'b'],
    });
    expect(status).toBe(503);
    expect(body).toMatchObject({
      code: 'not_available',
      error: 'Facet counts exceeded the time budget',
      details: { pending: ['a', 'b'] },
    });
    expect(body.message).toContain('0.05 s budget: a, b');
  });

  it('counts at most 4 fields at a time (D96)', async () => {
    let running = 0;
    let peak = 0;
    const fields = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'];
    const store = fakeStore({
      facetCounts: vi.fn(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 20));
        running--;
        return [];
      }),
      payloadIndexTypes: vi.fn(() =>
        Promise.resolve(Object.fromEntries(fields.map((f) => [f, 'keyword']))),
      ),
    });
    const { status } = await post(deps(store), { fields });
    expect(status).toBe(200);
    expect(store.facetCounts).toHaveBeenCalledTimes(6);
    expect(peak).toBe(4);
  });
});

describe('countFacets slow-request log', () => {
  it('logs a request over 500 ms at info with its shape, no values', async () => {
    vi.useFakeTimers();
    const info = vi.fn();
    const logger = { ...pino({ level: 'silent' }), info } as never;
    const store = fakeStore({
      facetCounts: vi.fn(
        () =>
          new Promise<never[]>((resolve) => {
            setTimeout(() => {
              resolve([]);
            }, 600);
          }),
      ),
    });
    const handler = createCatalogCountFacetsHandler(deps(store, { logger }));
    const pending = handler(
      { body: { fields: ['tag'], rules: ['a'] } } as never,
      {} as never,
    );
    await vi.advanceTimersByTimeAsync(600);
    expect((await pending).status).toBe(200);
    expect(info).toHaveBeenCalledWith(
      { fields: 1, filter: false, rules: true, durationMs: 600 },
      'countFacets: slow request',
    );
  });

  it('does not log a fast request', async () => {
    const info = vi.fn();
    const logger = { ...pino({ level: 'silent' }), info } as never;
    const handler = createCatalogCountFacetsHandler(
      deps(fakeStore(), { logger }),
    );
    await handler({ body: { fields: ['tag'] } } as never, {} as never);
    expect(info).not.toHaveBeenCalled();
  });
});
