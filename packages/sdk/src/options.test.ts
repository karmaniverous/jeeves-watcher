/**
 * @module options.test
 * Unit tests for client option validation and normalisation, plus the WatcherError class.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_TIMEOUT_MS,
  type FetchLike,
  resolveClientOptions,
} from './options';
import { isWatcherError, WatcherError } from './WatcherError';

const fetch = () => Promise.resolve(new Response('{}'));

describe('resolveClientOptions', () => {
  it('defaults timeoutMs and strips trailing slashes from baseUrl', async () => {
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(new Response('{}')));
    const resolved = resolveClientOptions({
      baseUrl: 'http://h:1936/prefix//',
      fetch,
    });
    expect(resolved).toMatchObject({
      baseUrl: 'http://h:1936/prefix',
      timeoutMs: DEFAULT_TIMEOUT_MS,
      apiKey: undefined,
    });
    await resolved.fetch('http://h:1936/prefix/status', { method: 'GET' });
    expect(fetch).toHaveBeenCalledWith('http://h:1936/prefix/status', {
      method: 'GET',
    });
  });

  it('falls back to the global fetch', async () => {
    const global = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}'));
    try {
      await resolveClientOptions({ baseUrl: 'https://h' }).fetch('https://h/x');
      expect(global).toHaveBeenCalledWith('https://h/x', {});
    } finally {
      global.mockRestore();
    }
  });

  it('refuses with invalid_options when no fetch is available', () => {
    vi.stubGlobal('fetch', undefined);
    try {
      expect(() => resolveClientOptions({ baseUrl: 'https://h' })).toThrow(
        'No fetch implementation available; pass options.fetch',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('hands the caller fetch the URL of a URL or Request input', async () => {
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(new Response('{}')));
    const resolved = resolveClientOptions({ baseUrl: 'https://h', fetch });
    await resolved.fetch(new URL('https://h/a'));
    await resolved.fetch(new Request('https://h/b'));
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://h/a',
      'https://h/b',
    ]);
  });

  it.each([
    ['a relative baseUrl', { baseUrl: '/watcher' }],
    ['a non-http baseUrl', { baseUrl: 'ftp://h' }],
    ['a baseUrl with a query string', { baseUrl: 'http://h?x=1' }],
    ['a baseUrl with an empty query', { baseUrl: 'http://h/prefix?' }],
    ['a baseUrl with a fragment', { baseUrl: 'http://h/prefix#top' }],
    ['a baseUrl with an empty fragment', { baseUrl: 'http://h#' }],
    ['an empty apiKey', { baseUrl: 'http://h', apiKey: '' }],
    ['a zero timeout', { baseUrl: 'http://h', timeoutMs: 0 }],
    ['a NaN timeout', { baseUrl: 'http://h', timeoutMs: Number.NaN }],
  ])('rejects %s with invalid_options', (_, options) => {
    expect(() => resolveClientOptions(options)).toThrow(
      expect.objectContaining({ code: 'invalid_options' }) as Error,
    );
  });
});

describe('resolveClientOptions baseUrl query/fragment', () => {
  it('names the problem in the error message', () => {
    expect(() =>
      resolveClientOptions({ baseUrl: 'http://h?x=1', fetch }),
    ).toThrow('baseUrl must not contain a query string or fragment');
  });
});

describe('WatcherError', () => {
  it('carries code, status, details and cause', () => {
    const cause = new Error('root');
    const error = new WatcherError({
      code: 'http_500',
      message: 'boom',
      status: 500,
      details: { a: 1 },
      cause,
    });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'WatcherError',
      code: 'http_500',
      message: 'boom',
      status: 500,
      details: { a: 1 },
    });
    expect(error.cause).toBe(cause);
    expect(isWatcherError(error)).toBe(true);
    expect(isWatcherError(new Error('x'))).toBe(false);
  });
});
