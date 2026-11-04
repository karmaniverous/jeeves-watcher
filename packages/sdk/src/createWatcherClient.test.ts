/**
 * @module createWatcherClient.test
 * Unit tests for the catalog-built client with an injected fetch: the method set (one per catalog entry, documents grouped), method/path/query/body/bearer per call, text replies, the timeout handed to the catalog client, and the error mapping to WatcherError.
 */

import { WATCHER_CATALOG } from '@karmaniverous/jeeves-watcher-core';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { createWatcherClient, type WatcherClient } from './createWatcherClient';
import { DEFAULT_TIMEOUT_MS, type FetchLike } from './options';
import { type CannedResponse, mockFetch } from './test/mockFetch';
import { MAX_RETRY_AFTER_MS } from './toWatcherError';
import { isWatcherError, type WatcherError } from './WatcherError';

const BASE = 'http://watcher.test:1936';
const STATUS = {
  name: 'watcher',
  version: '0.21.0',
  uptime: 1,
  status: 'healthy',
  health: {},
};

function client(
  respond: CannedResponse | Parameters<typeof mockFetch>[0],
  apiKey?: string,
) {
  const mock = mockFetch(respond);
  return {
    mock,
    watcher: createWatcherClient({
      baseUrl: `${BASE}/`,
      ...(apiKey === undefined ? {} : { apiKey }),
      fetch: mock.fetch,
    }),
  };
}

/** The WatcherError a call rejects with. */
async function failure(call: Promise<unknown>): Promise<WatcherError> {
  try {
    await call;
  } catch (error) {
    if (isWatcherError(error)) return error;
    throw error;
  }
  throw new Error('expected the call to reject');
}

/** The catalog entries the client exposes as top-level methods. */
type TopLevel = Exclude<
  (typeof WATCHER_CATALOG.entries)[number]['name'],
  'notifyDocuments' | 'deleteDocuments'
>;

describe('createWatcherClient method set (D36, D60)', () => {
  it('has one method per catalog entry, named by the entry, with notifyDocuments and deleteDocuments as documents.notify and documents.delete', () => {
    const { watcher } = client({});
    const expected = WATCHER_CATALOG.entries
      .map((e) => e.name)
      .filter((n) => n !== 'notifyDocuments' && n !== 'deleteDocuments');
    expect(Object.keys(watcher).sort()).toEqual(
      [...expected, 'documents'].sort(),
    );
    expect(Object.keys(watcher.documents).sort()).toEqual(['delete', 'notify']);
    expectTypeOf<keyof WatcherClient>().toEqualTypeOf<TopLevel | 'documents'>();
  });
});

describe('createWatcherClient requests', () => {
  it('sends status without a key even when one is configured', async () => {
    const { watcher, mock } = client({ body: STATUS }, 'k');
    await expect(watcher.status()).resolves.toEqual(STATUS);
    expect(mock.calls[0]).toMatchObject({
      url: `${BASE}/status`,
      method: 'GET',
    });
    expect(mock.calls[0]?.headers.authorization).toBeUndefined();
  });

  it('posts a validated body with the bearer key', async () => {
    const { watcher, mock } = client({ body: [] }, 'k');
    await watcher.search({ query: 'q', limit: 2 });
    expect(mock.calls[0]).toMatchObject({
      url: `${BASE}/search`,
      method: 'POST',
      body: { query: 'q', limit: 2 },
      headers: { authorization: 'Bearer k' },
    });
  });

  it('sends no authorization header without a key', async () => {
    const { watcher, mock } = client({ body: { count: 0, issues: {} } });
    await watcher.listIssues();
    expect(mock.calls[0]?.url).toBe(`${BASE}/issues`);
    expect(mock.calls[0]?.headers.authorization).toBeUndefined();
  });

  it('calls reindex with no input', async () => {
    const { watcher, mock } = client({
      body: { status: 'started', scope: 'issues' },
    });
    await watcher.reindex();
    expect(mock.calls[0]).toMatchObject({
      url: `${BASE}/reindex`,
      method: 'POST',
    });
  });

  it('puts query fields in the query string and returns text replies as strings', async () => {
    const { watcher, mock } = client({ body: 'old content' });
    await expect(
      watcher.showVcsFile({ path: 'a b.md', commit: 'abc' }),
    ).resolves.toBe('old content');
    expect(mock.calls[0]?.url).toBe(
      `${BASE}/vcs/show?path=a%20b.md&commit=abc`,
    );
  });

  it('fills path parameters', async () => {
    const { watcher, mock } = client({
      body: { source: 'meta/x', removed: true },
    });
    await watcher.unregisterRulesBySource({ source: 'meta/x' });
    expect(mock.calls[0]).toMatchObject({
      url: `${BASE}/rules/unregister/meta%2Fx`,
      method: 'DELETE',
    });
  });

  it('drops unknown response keys (the entry schema strips them)', async () => {
    const { watcher } = client({ body: { count: 0, issues: {}, extra: 1 } });
    await expect(watcher.listIssues()).resolves.toEqual({
      count: 0,
      issues: {},
    });
  });

  it('hands the catalog client a 10 s default timeout', async () => {
    const { watcher, mock } = client({ body: STATUS });
    const before = Date.now();
    await watcher.status();
    expect(mock.calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(DEFAULT_TIMEOUT_MS).toBe(10_000);
    expect(Date.now() - before).toBeLessThan(DEFAULT_TIMEOUT_MS);
  });
});

describe('createWatcherClient errors (one WatcherError mapping, D53)', () => {
  it('keeps the server code, status, message and details of an error body', async () => {
    const { watcher } = client({
      status: 400,
      body: {
        error: 'Validation failed',
        code: 'invalid_request',
        details: [{ property: 'p' }],
      },
    });
    const err = await failure(
      watcher.setMetadata({ path: '/a', metadata: {} }),
    );
    expect(err).toMatchObject({
      code: 'invalid_request',
      status: 400,
      message: 'Validation failed',
      details: [{ property: 'p' }],
    });
    expect(err.retryAfterMs).toBeUndefined();
  });

  it('joins a distinct message to the error text', async () => {
    const { watcher } = client({
      status: 409,
      body: { error: 'Conflict', message: 'busy', code: 'conflict' },
    });
    const err = await failure(watcher.reindex({ scope: 'full' }));
    expect(err.message).toBe('Conflict: busy');
  });

  it('maps a code-less error body to http_<status>', async () => {
    const { watcher } = client({ status: 502, body: 'Bad Gateway' });
    const err = await failure(watcher.listIssues());
    expect(err).toMatchObject({
      code: 'http_502',
      status: 502,
      message: 'Bad Gateway',
    });
  });

  it('falls back to HTTP <status> when the body has no error text', async () => {
    const { watcher } = client({ status: 500, body: '' });
    const err = await failure(watcher.listIssues());
    expect(err).toMatchObject({ code: 'http_500', message: 'HTTP 500' });
  });

  it.each([
    ['30', 30_000],
    ['0', 0],
    ['7200', MAX_RETRY_AFTER_MS],
  ])(
    'reports Retry-After %s as retryAfterMs %d (clamped to 1 h)',
    async (header, ms) => {
      const { watcher } = client({
        status: 503,
        body: { error: 'busy', code: 'not_available' },
        headers: { 'retry-after': header },
      });
      const err = await failure(watcher.excludeVcsPath({ glob: '/data/x/**' }));
      expect(err).toMatchObject({ code: 'not_available', retryAfterMs: ms });
    },
  );

  it('refuses input that fails the entry schema before sending (invalid_request)', async () => {
    const { watcher, mock } = client({ body: [] });
    const err = await failure(watcher.search({ query: '' }));
    expect(err.code).toBe('invalid_request');
    expect(err.status).toBeUndefined();
    expect(Array.isArray(err.details)).toBe(true);
    expect(mock.calls).toHaveLength(0);
  });

  it('refuses a condition-free delete filter before sending', async () => {
    const { watcher, mock } = client({ body: { deleted: 0 } });
    const err = await failure(watcher.documents.delete({ filter: {} }));
    expect(err.code).toBe('invalid_request');
    expect(mock.calls).toHaveLength(0);
  });

  it('maps a 2xx body that fails the response schema to invalid_response', async () => {
    const { watcher } = client({ body: { count: 'x' } });
    const err = await failure(watcher.listIssues());
    expect(err).toMatchObject({ code: 'invalid_response', status: 200 });
    expect(err.message).toBe(
      'listIssues response did not match the expected shape',
    );
  });

  it('maps a 2xx body that is not JSON to invalid_response', async () => {
    const { watcher } = client({ body: 'not json' });
    const err = await failure(watcher.listIssues());
    expect(err.code).toBe('invalid_response');
    expect(err.message).toBe('listIssues returned a response that is not JSON');
  });

  it('maps a timeout to timeout, naming the operation and the limit', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason as Error);
        });
      });
    const watcher = createWatcherClient({
      baseUrl: BASE,
      timeoutMs: 20,
      fetch: hang,
    });
    const err = await failure(watcher.search({ query: 'q' }));
    expect(err).toMatchObject({
      code: 'timeout',
      message: 'search timed out after 20 ms',
    });
    expect(err.status).toBeUndefined();
  });

  it('maps a rejected fetch to network_error', async () => {
    const watcher = createWatcherClient({
      baseUrl: BASE,
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });
    const err = await failure(watcher.status());
    expect(err).toMatchObject({
      code: 'network_error',
      message: 'status request failed: fetch failed',
    });
  });
});
