/**
 * @module createWatcherClient.test
 * Unit tests for the client methods with an injected fetch: method, path (from the core catalog), headers, request bodies and validated responses.
 */

import { getEndpoint } from '@karmaniverous/jeeves-watcher-core';
import { describe, expect, it } from 'vitest';

import { createWatcherClient } from './createWatcherClient';
import { f } from './filters';
import { type CannedResponse, mockFetch } from './test/mockFetch';
import { WatcherError } from './WatcherError';

const BASE = 'http://watcher.test:1936';

const STATUS = {
  name: 'watcher',
  version: '0.20.0',
  uptime: 12,
  status: 'healthy',
  health: {},
};
const HIT = { id: 'p1', score: 0.9, payload: { source: 'app://a/1' } };
const RENDER = { renderAs: 'md', content: '# x', rules: ['r'], metadata: {} };
const REINDEX = { status: 'started', scope: 'issues' };

function client(respond?: CannedResponse) {
  const mock = mockFetch(respond);
  return {
    mock,
    watcher: createWatcherClient({ baseUrl: `${BASE}/`, fetch: mock.fetch }),
  };
}

describe('createWatcherClient', () => {
  it('status: GET /status without a body or auth header', async () => {
    const { watcher, mock } = client({ body: STATUS });
    await expect(watcher.status()).resolves.toEqual(STATUS);
    expect(mock.calls[0]).toMatchObject({
      url: `${BASE}${getEndpoint('status').path}`,
      method: 'GET',
      body: undefined,
    });
    expect(mock.calls[0]?.headers).toEqual({ accept: 'application/json' });
  });

  it('sends Authorization: Bearer when apiKey is set', async () => {
    const mock = mockFetch({ body: STATUS });
    const watcher = createWatcherClient({
      baseUrl: BASE,
      apiKey: 'sekret',
      fetch: mock.fetch,
    });
    await watcher.issues().catch(() => undefined);
    expect(mock.calls[0]?.headers.Authorization).toBe('Bearer sekret');
  });

  it('search: POST /search with the validated body', async () => {
    const { watcher, mock } = client({ body: [HIT] });
    const filter = f.eq('user_id', 'u1');
    await expect(
      watcher.search({ query: 'hello', limit: 8, filter }),
    ).resolves.toEqual([HIT]);
    expect(mock.calls[0]).toMatchObject({
      url: `${BASE}/search`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { query: 'hello', limit: 8, filter },
    });
  });

  it('scan: accepts both the page and the countOnly response', async () => {
    const page = client({ body: { points: [], cursor: null } });
    await expect(
      page.watcher.scan({ filter: f.eq('a', 1), limit: 10 }),
    ).resolves.toEqual({ points: [], cursor: null });
    expect(page.mock.calls[0]?.url).toBe(`${BASE}/scan`);

    const count = client({ body: { count: 3 } });
    await expect(
      count.watcher.scan({ filter: {}, countOnly: true }),
    ).resolves.toEqual({ count: 3 });
  });

  it.each([[{ path: 'c:/docs/a.md' }], [{ source: 'app://chat/thread/1' }]])(
    'render: POST /render with %j',
    async (request) => {
      const { watcher, mock } = client({ body: RENDER });
      await expect(watcher.render(request)).resolves.toEqual(RENDER);
      expect(mock.calls[0]).toMatchObject({
        url: `${BASE}/render`,
        body: request,
      });
    },
  );

  it('metadata: POST /metadata', async () => {
    const response = { ok: true, matched_rules: ['r'] };
    const { watcher, mock } = client({ body: response });
    const request = { source: 'app://chat/thread/1', metadata: { p: 1 } };
    await expect(watcher.metadata(request)).resolves.toEqual(response);
    expect(mock.calls[0]).toMatchObject({
      url: `${BASE}/metadata`,
      body: request,
    });
  });

  it('reindex: POST /reindex, defaulting to an empty body', async () => {
    const { watcher, mock } = client({ body: REINDEX });
    await expect(watcher.reindex()).resolves.toEqual(REINDEX);
    expect(mock.calls[0]).toMatchObject({ url: `${BASE}/reindex`, body: {} });

    await watcher.reindex({ scope: 'path', source: ['app://a/1'] });
    expect(mock.calls[1]?.body).toEqual({
      scope: 'path',
      source: ['app://a/1'],
    });
  });

  it('issues: GET /issues', async () => {
    const issues = {
      count: 1,
      issues: {
        'app://a/1': [
          { type: 'source_unavailable', message: 'down', timestamp: 1 },
        ],
      },
    };
    const { watcher, mock } = client({ body: issues });
    await expect(watcher.issues()).resolves.toEqual(issues);
    expect(mock.calls[0]).toMatchObject({
      url: `${BASE}/issues`,
      method: 'GET',
    });
  });

  it('preserves response fields unknown to the schema', async () => {
    const { watcher } = client({ body: { ...STATUS, extra: 'kept' } });
    await expect(watcher.status()).resolves.toMatchObject({ extra: 'kept' });
  });

  it.each([
    ['render with neither path nor source', (w: Client) => w.render({})],
    [
      'render with both path and source',
      (w: Client) => w.render({ path: 'a', source: 'app://a/1' }),
    ],
    ['search with an empty query', (w: Client) => w.search({ query: '' })],
    ['scan with limit 0', (w: Client) => w.scan({ filter: {}, limit: 0 })],
    [
      'reindex source outside scope path',
      (w: Client) => w.reindex({ scope: 'full', source: 'app://a/1' }),
    ],
  ])('rejects %s client-side without sending', async (_, call) => {
    const { watcher, mock } = client({ body: {} });
    const error = await call(watcher).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WatcherError);
    expect(error).toMatchObject({ code: 'invalid_request' });
    expect((error as WatcherError).details).toBeInstanceOf(Array);
    expect(mock.calls).toHaveLength(0);
  });
});

type Client = ReturnType<typeof createWatcherClient>;
