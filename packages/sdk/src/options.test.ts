/**
 * @module options.test
 * Unit tests for client option validation and normalisation, plus the WatcherError class.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_TIMEOUT_MS, resolveClientOptions } from './options';
import { isWatcherError, WatcherError } from './WatcherError';

const fetch = () => Promise.resolve(new Response('{}'));

describe('resolveClientOptions', () => {
  it('defaults timeoutMs and strips trailing slashes from baseUrl', () => {
    const resolved = resolveClientOptions({
      baseUrl: 'http://h:1936/prefix//',
      fetch,
    });
    expect(resolved).toMatchObject({
      baseUrl: 'http://h:1936/prefix',
      timeoutMs: DEFAULT_TIMEOUT_MS,
      apiKey: undefined,
    });
    expect(resolved.fetch).toBe(fetch);
  });

  it('falls back to the global fetch', () => {
    expect(resolveClientOptions({ baseUrl: 'https://h' }).fetch).toBe(
      globalThis.fetch,
    );
  });

  it.each([
    ['a relative baseUrl', { baseUrl: '/watcher' }],
    ['a non-http baseUrl', { baseUrl: 'ftp://h' }],
    ['an empty apiKey', { baseUrl: 'http://h', apiKey: '' }],
    ['a zero timeout', { baseUrl: 'http://h', timeoutMs: 0 }],
    ['a NaN timeout', { baseUrl: 'http://h', timeoutMs: Number.NaN }],
  ])('rejects %s with invalid_options', (_, options) => {
    expect(() => resolveClientOptions(options)).toThrow(
      expect.objectContaining({ code: 'invalid_options' }) as Error,
    );
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
