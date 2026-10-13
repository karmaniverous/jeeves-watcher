/**
 * @module sources/requestSource.test
 * requestSource response size cap: a declared or streamed body over MAX_SOURCE_RESPONSE_BYTES is `source_unavailable` ("response too large") and the stream is cancelled; bodies within the cap parse normally. An empty 200 body is invalid JSON; network errors surface only their system code; a timeout while the body streams is a timeout. Stubs global fetch.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_SOURCE_RESPONSE_BYTES, requestSource } from './requestSource';

const request = {
  name: 'app',
  url: 'http://127.0.0.1:1/t/1',
  headers: {},
  timeoutMs: 5000,
};

/** A JSON response whose body streams the given chunks. */
function streamed(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks.shift();
      if (next) controller.enqueue(next);
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
  return { response, wasCancelled: () => cancelled };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestSource response size cap', () => {
  it('rejects a declared Content-Length over the cap without reading it', async () => {
    const { response, wasCancelled } = streamed([new Uint8Array(4)], {
      'content-length': String(MAX_SOURCE_RESPONSE_BYTES + 1),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const result = await requestSource(request);

    expect(result).toEqual({
      kind: 'error',
      code: 'source_unavailable',
      message: expect.stringContaining('response too large') as unknown,
    });
    expect(wasCancelled()).toBe(true);
  });

  it('stops reading a streamed body once it passes the cap', async () => {
    const chunk = new Uint8Array(4 * 1024 * 1024).fill(0x20);
    const { response, wasCancelled } = streamed([chunk, chunk, chunk, chunk]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const result = await requestSource(request);

    expect(result).toMatchObject({
      kind: 'error',
      code: 'source_unavailable',
      message: expect.stringContaining('response too large') as unknown,
    });
    expect(wasCancelled()).toBe(true);
  });

  it('parses a body within the cap', async () => {
    const json = new TextEncoder().encode('{"userId":"u1"}');
    const { response } = streamed([json]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    expect(await requestSource(request)).toEqual({
      kind: 'document',
      body: { userId: 'u1' },
    });
  });
});

describe('requestSource failures', () => {
  it('treats an empty 200 body as invalid JSON', async () => {
    const response = new Response(null, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    expect(await requestSource(request)).toEqual({
      kind: 'error',
      code: 'source_unavailable',
      message: 'Source "app" callback returned invalid JSON',
    });
  });

  it.each([
    [{ code: 'ECONNREFUSED' }, 'network error (ECONNREFUSED)'],
    // Free text is never surfaced: it could echo the URL.
    [{ code: 'connect to http://secret.example failed' }, 'network error'],
    [undefined, 'network error'],
  ])('reports a network failure with cause %j as %s', async (cause, text) => {
    const failure = new TypeError('fetch failed', { cause });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
    expect(await requestSource(request)).toEqual({
      kind: 'error',
      code: 'source_unavailable',
      message: `Source "app" callback failed: ${text}`,
    });
  });

  it('times out while the body is still streaming', async () => {
    // Headers arrive at once; the body never finishes until the abort.
    const fetchStub = vi.fn((_url: string, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"userId":'));
          init.signal?.addEventListener('abort', () => {
            controller.error(new Error('aborted'));
          });
        },
      });
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchStub);
    expect(await requestSource({ ...request, timeoutMs: 50 })).toEqual({
      kind: 'error',
      code: 'source_unavailable',
      message: 'Source "app" callback timed out after 50 ms',
    });
  });
});
