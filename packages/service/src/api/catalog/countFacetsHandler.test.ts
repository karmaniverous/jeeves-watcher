/**
 * @module api/catalog/countFacetsHandler.test
 * `POST /search/facets/counts` against a fake facet store (spec Design 12, A8): 503 until chunk_index (and, with rules, matched_rules) is ready, 400 for unknown rules and unusable fields, counts and ranges on the nested count filter, 503 naming the fields not counted past the budget, Qdrant rejections as 400, and the slow-request log.
 */

import Fastify from 'fastify';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InferenceRule } from '../../config/types';
import { registerCatalogEntries } from '../../test/catalogRoutes';
import { makeConfig } from '../../test/facetsDeps';
import type { FacetStore, SystemIndexState } from '../../vectorStore';
import {
  type CatalogCountFacetsDeps,
  createCatalogCountFacetsHandler,
} from './countFacetsHandler';

const rule = (name: string, properties: Record<string, unknown> = {}) =>
  ({
    name,
    description: name,
    match: {},
    schema: [{ properties }],
  }) as InferenceRule;

function fakeStore(
  overrides: Partial<FacetStore> = {},
  states: Record<string, SystemIndexState> = {
    chunk_index: 'ready',
    matched_rules: 'ready',
  },
) {
  return {
    facetCounts: vi.fn(() => Promise.resolve([{ value: 'x', count: 2 }])),
    rangeBound: vi.fn((_read, end: string) =>
      Promise.resolve(end === 'min' ? 1 : 9),
    ),
    payloadIndexTypes: vi.fn(() =>
      Promise.resolve({ tag: 'keyword', size: 'integer', at: 'datetime' }),
    ),
    systemIndexState: vi.fn((field: string) => states[field]),
    ...overrides,
  } satisfies FacetStore;
}

function deps(
  facetStore: FacetStore,
  extra: Partial<CatalogCountFacetsDeps> = {},
): CatalogCountFacetsDeps {
  return {
    getConfig: () =>
      makeConfig([rule('a', { size: { type: 'integer', uiHint: 'number' } })]),
    getVirtualRules: () => ({ plugin: [rule('v')] }),
    configDir: '/tmp',
    facetStore,
    logger: pino({ level: 'silent' }),
    ...extra,
  };
}

async function post(d: CatalogCountFacetsDeps, body: unknown) {
  const app = Fastify();
  await registerCatalogEntries(app, {
    countFacets: createCatalogCountFacetsHandler(d),
  });
  const res = await app.inject({
    method: 'POST',
    url: '/search/facets/counts',
    payload: body as Record<string, unknown>,
  });
  await app.close();
  return { status: res.statusCode, body: res.json<Record<string, unknown>>() };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /search/facets/counts', () => {
  it('counts values and reads ranges on the nested count filter', async () => {
    const store = fakeStore();
    const filter = { must: [{ key: 'silo', match: { value: 't' } }] };
    const { status, body } = await post(deps(store), {
      filter,
      fields: ['tag', 'size', 'at', 'tag'],
      limit: 5,
    });
    expect(status).toBe(200);
    expect(body).toEqual({
      counts: {
        tag: [{ value: 'x', count: 2 }],
        size: { min: 1, max: 9 },
        at: { min: 1, max: 9 },
      },
    });
    const countFilter = {
      must: [filter, { key: 'chunk_index', match: { value: 0 } }],
    };
    expect(store.facetCounts).toHaveBeenCalledTimes(1);
    expect(store.facetCounts).toHaveBeenCalledWith(
      { field: 'tag', filter: countFilter, timeoutS: 10 },
      5,
    );
    expect(store.rangeBound).toHaveBeenCalledWith(
      { field: 'size', filter: countFilter, timeoutS: 10 },
      'min',
    );
  });

  it('defaults the limit to 100 and scopes by rules, virtual ones included', async () => {
    const store = fakeStore();
    const { status } = await post(deps(store), {
      rules: ['a', 'v'],
      fields: ['tag'],
    });
    expect(status).toBe(200);
    expect(store.facetCounts).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: {
          must: [
            {
              should: [
                { key: 'matched_rules', match: { any: ['a', 'v'] } },
                { key: 'source_rule', match: { any: ['a', 'v'] } },
              ],
            },
            { key: 'chunk_index', match: { value: 0 } },
          ],
        },
      }),
      100,
    );
  });

  it('answers 503 not_available until chunk_index is ready', async () => {
    const store = fakeStore({}, { chunk_index: 'building' });
    const { status, body } = await post(deps(store), { fields: ['tag'] });
    expect(status).toBe(503);
    expect(body).toMatchObject({
      code: 'not_available',
      error: 'System index chunk_index is not ready',
      details: { index: 'chunk_index', state: 'building' },
    });
    expect(store.payloadIndexTypes).not.toHaveBeenCalled();
  });

  it('answers 503 naming matched_rules while it builds, for a rules request only', async () => {
    const store = fakeStore(
      {},
      { chunk_index: 'ready', matched_rules: 'building' },
    );
    const scoped = await post(deps(store), { rules: ['a'], fields: ['tag'] });
    expect(scoped.status).toBe(503);
    expect(scoped.body).toMatchObject({
      error: 'System index matched_rules is not ready',
    });
    expect((await post(deps(store), { fields: ['tag'] })).status).toBe(200);
  });

  it('reports an index that never started as not started', async () => {
    const store = fakeStore({}, {});
    const { body } = await post(deps(store), { fields: ['tag'] });
    expect(body).toMatchObject({
      details: { index: 'chunk_index', state: null },
    });
  });

  it('answers 400 for an unknown rule before checking indexes', async () => {
    const store = fakeStore({}, {});
    const { status, body } = await post(deps(store), {
      rules: ['a', 'ghost'],
      fields: ['tag'],
    });
    expect(status).toBe(400);
    expect(body).toMatchObject({
      code: 'invalid_request',
      error: 'Unknown rule: ghost',
    });
  });

  it('answers 400 for a field without a usable index', async () => {
    const { status, body } = await post(deps(fakeStore()), {
      fields: ['tag', 'nope'],
    });
    expect(status).toBe(400);
    expect(body).toMatchObject({
      code: 'invalid_request',
      error: 'No usable payload index for field: nope',
    });
  });

  it('answers 400 Invalid filter when Qdrant rejects the filter', async () => {
    const rejection = Object.assign(new Error('Bad Request'), {
      status: 400,
      data: { status: { error: 'bad key' } },
    });
    const store = fakeStore({
      facetCounts: vi.fn(() => Promise.reject(rejection)),
    });
    const { status, body } = await post(deps(store), { fields: ['tag'] });
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid filter', message: 'bad key' });
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
    expect(body.message).toContain('a, b');
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

  it('falls back to index types when a rule schema fails to resolve', async () => {
    const warn = vi.fn();
    const logger = { ...pino({ level: 'silent' }), warn } as never;
    const { status, body } = await post(
      deps(fakeStore(), {
        getConfig: () =>
          makeConfig([
            { name: 'a', description: 'a', match: {}, schema: ['missing'] },
          ] as never),
        logger,
      }),
      { fields: ['size'] },
    );
    expect(status).toBe(200);
    expect(body).toEqual({ counts: { size: [{ value: 'x', count: 2 }] } });
    expect(warn).toHaveBeenCalledTimes(1);
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
