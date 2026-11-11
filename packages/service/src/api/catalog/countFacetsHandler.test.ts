/**
 * @module api/catalog/countFacetsHandler.test
 * `POST /search/facets/counts` against a fake facet store (spec Design 12, A8): 503 until chunk_index (and, with rules, matched_rules) is ready, 400 for unknown rules and unusable fields, counts and ranges on the nested count filter, Qdrant rejections as 400, and rule schemas that fail to resolve.
 */

import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deps, fakeStore, post, rule } from '../../test/countFacetsDeps';
import { makeConfig } from '../../test/facetsDeps';

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

  it('answers 503 WATCHER_NOT_AVAILABLE until chunk_index is ready', async () => {
    const store = fakeStore({}, { chunk_index: 'building' });
    const { status, body } = await post(deps(store), { fields: ['tag'] });
    expect(status).toBe(503);
    expect(body).toEqual({
      statusCode: 503,
      code: 'WATCHER_NOT_AVAILABLE',
      error: 'Service Unavailable',
      message:
        'Facet counts need the chunk_index system index, which is not ready yet; retry shortly.',
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
      message:
        'Facet counts need the matched_rules system index, which is not ready yet; retry shortly.',
    });
    expect((await post(deps(store), { fields: ['tag'] })).status).toBe(200);
  });

  it('logs the state of an index that never started', async () => {
    const debug = vi.fn();
    const logger = { ...pino({ level: 'silent' }), debug } as never;
    const store = fakeStore({}, {});
    const { status } = await post(deps(store, { logger }), { fields: ['tag'] });
    expect(status).toBe(503);
    expect(debug).toHaveBeenCalledWith(
      { index: 'chunk_index', state: null },
      'countFacets: system index not ready',
    );
  });

  it('answers 400 for an unknown rule before checking indexes', async () => {
    const store = fakeStore({}, {});
    const { status, body } = await post(deps(store), {
      rules: ['a', 'ghost'],
      fields: ['tag'],
    });
    expect(status).toBe(400);
    expect(body).toMatchObject({
      code: 'WATCHER_INVALID_REQUEST',
      message: 'Unknown rule(s): ghost',
    });
  });

  it('answers 400 for a field without a usable index', async () => {
    const { status, body } = await post(deps(fakeStore()), {
      fields: ['tag', 'nope'],
    });
    expect(status).toBe(400);
    expect(body).toMatchObject({
      code: 'WATCHER_INVALID_REQUEST',
      message: 'No usable payload index for field(s): nope',
    });
  });

  it('answers 400 FilterRejected when Qdrant rejects the filter', async () => {
    const rejection = Object.assign(new Error('Bad Request'), {
      status: 400,
      data: { status: { error: 'bad key' } },
    });
    const store = fakeStore({
      facetCounts: vi.fn(() => Promise.reject(rejection)),
    });
    const { status, body } = await post(deps(store), { fields: ['tag'] });
    expect(status).toBe(400);
    expect(body).toMatchObject({
      code: 'WATCHER_INVALID_REQUEST',
      message: 'The vector store rejected the filter: bad key',
    });
  });

  it('keeps the uiHints of healthy rules when another rule fails to resolve', async () => {
    const warn = vi.fn();
    const logger = { ...pino({ level: 'silent' }), warn } as never;
    const store = fakeStore();
    const { status, body } = await post(
      deps(store, {
        getVirtualRules: () => ({
          plugin: [{ ...rule('v'), schema: ['missing'] }],
        }),
        logger,
      }),
      { fields: ['size'] },
    );
    expect(status).toBe(200);
    expect(body).toEqual({ counts: { size: { min: 1, max: 9 } } });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ rules: ['v'] }),
      expect.any(String),
    );
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
