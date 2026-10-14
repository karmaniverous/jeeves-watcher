/**
 * @module transport.test
 * Unit tests for the transport with an injected fetch: non-2xx error mapping, invalid responses, network errors and the AbortController timeout.
 */

import { describe, expect, it } from 'vitest';

import type { FetchLike } from './options';
import { mockFetch } from './test/mockFetch';
import { createTransport } from './transport';
import { WatcherError } from './WatcherError';

const OPTIONS = { baseUrl: 'http://w.test', timeoutMs: 1000 };
const STATUS_SCHEMA = {
  safeParse: (data: unknown) =>
    typeof data === 'object' && data !== null && 'ok' in data
      ? { success: true as const, data: data }
      : {
          success: false as const,
          error: { issues: [{ message: 'missing ok' }] },
        },
};

function call(fetch: FetchLike, timeoutMs = OPTIONS.timeoutMs) {
  const transport = createTransport({ ...OPTIONS, timeoutMs, fetch });
  return transport({ endpoint: 'status', responseSchema: STATUS_SCHEMA }).then(
    () => undefined,
    (e: unknown) => e as WatcherError,
  );
}

describe('transport error mapping', () => {
  it.each([
    [
      'body.code wins over body.error',
      400,
      { code: 'bad_thing', error: 'Bad', message: 'Longer', details: [1] },
      { code: 'bad_thing', message: 'Longer', details: [1] },
    ],
    [
      'body.error as code and message (service error body)',
      401,
      { error: 'Unauthorized' },
      {
        code: 'Unauthorized',
        message: 'Unauthorized',
        details: { error: 'Unauthorized' },
      },
    ],
    [
      'search 503 { error, message }',
      503,
      { error: 'EmbeddingUnavailableError', message: 'quota' },
      { code: 'EmbeddingUnavailableError', message: 'quota' },
    ],
    [
      'non-JSON body falls back to http_<status>',
      502,
      'Bad Gateway',
      { code: 'http_502', details: 'Bad Gateway' },
    ],
    [
      'canonical 0.20.0+ body: code and error (+ message)',
      404,
      { code: 'source_not_found', error: 'Not found', message: 'gone' },
      { code: 'source_not_found', message: 'Not found: gone' },
    ],
  ])('%s', async (_, status, body, expected) => {
    const error = await call(mockFetch({ status, body }).fetch);
    expect(error).toBeInstanceOf(WatcherError);
    expect(error).toMatchObject({ status, ...expected });
  });

  it('an empty error body yields http_<status> and an HTTP message', async () => {
    const fetch: FetchLike = () =>
      Promise.resolve(new Response('', { status: 500 }));
    const error = await call(fetch);
    expect(error).toMatchObject({ status: 500, code: 'http_500' });
    expect(error?.message).toMatch(/^HTTP 500/);
    expect(error?.details).toBeUndefined();
  });

  it('a 2xx non-JSON body is invalid_response', async () => {
    const error = await call(mockFetch({ body: 'not json' }).fetch);
    expect(error).toMatchObject({ code: 'invalid_response', status: 200 });
  });

  it('a 2xx body failing the response schema is invalid_response', async () => {
    const error = await call(mockFetch({ body: { nope: 1 } }).fetch);
    expect(error).toMatchObject({
      code: 'invalid_response',
      details: [{ message: 'missing ok' }],
    });
  });

  it('a rejected fetch is network_error with the cause attached', async () => {
    const cause = new TypeError('fetch failed');
    const error = await call(() => Promise.reject(cause));
    expect(error).toMatchObject({ code: 'network_error' });
    expect(error?.cause).toBe(cause);
    expect(error?.status).toBeUndefined();
  });

  it('aborts after timeoutMs and maps to timeout', async () => {
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const started = Date.now();
    const error = await call(hanging, 30);
    expect(error).toMatchObject({ code: 'timeout' });
    expect(error?.message).toContain('30 ms');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('passes the abort signal and succeeds within the timeout', async () => {
    const mock = mockFetch({ body: { ok: true } });
    await expect(call(mock.fetch)).resolves.toBeUndefined();
    expect(mock.calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(mock.calls[0]?.signal?.aborted).toBe(false);
  });
});
