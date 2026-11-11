/**
 * @module toWatcherError.test
 * Unit tests for the one CatalogClientError-to-WatcherError mapping: the retry-delay clamp, message composition, and failures that are not catalog-client errors.
 */

import { CatalogClientError } from '@karmaniverous/jeeves/catalog';
import { describe, expect, it } from 'vitest';

import {
  clampRetryAfter,
  MAX_RETRY_AFTER_MS,
  MAX_UNCODED_MESSAGE_LENGTH,
  toWatcherError,
} from './toWatcherError';

describe('clampRetryAfter (D78)', () => {
  it.each([
    [undefined, undefined],
    [-5, 0],
    [0, 0],
    [1500, 1500],
    [MAX_RETRY_AFTER_MS + 1, MAX_RETRY_AFTER_MS],
  ])('%s -> %s', (input, expected) => {
    expect(clampRetryAfter(input)).toBe(expected);
  });
});

describe('toWatcherError', () => {
  it('maps a failure that is not a catalog-client error to network_error, keeping it as cause', () => {
    const cause = new RangeError('boom');
    const err = toWatcherError(cause, 'search', 10_000);
    expect(err).toMatchObject({
      code: 'network_error',
      message: 'search request failed: RangeError: boom',
    });
    expect(err.cause).toBe(cause);
  });

  it("carries the server's code and message, with the whole body as details", () => {
    const body = {
      statusCode: 503,
      code: 'WATCHER_SCAN_IN_PROGRESS',
      error: 'Service Unavailable',
      message:
        'The initial filesystem scan is still running; retry when it finishes.',
    };
    const err = toWatcherError(
      new CatalogClientError('x', { status: 503, body }),
      'walk',
      10_000,
    );
    expect(err).toMatchObject({
      code: 'WATCHER_SCAN_IN_PROGRESS',
      message: body.message,
      details: body,
    });
  });

  it('maps a masked 500 (no code) to http_500 with its message', () => {
    const body = {
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'The server could not complete the request.',
    };
    const err = toWatcherError(
      new CatalogClientError('x', { status: 500, body }),
      'search',
      10_000,
    );
    expect(err).toMatchObject({
      code: 'http_500',
      message: 'The server could not complete the request.',
    });
  });

  it('falls back to the error text when the body has no message', () => {
    const err = toWatcherError(
      new CatalogClientError('x', {
        status: 418,
        body: { statusCode: 418, error: "I'm a Teapot", message: '' },
      }),
      'status',
      10_000,
    );
    expect(err).toMatchObject({ code: 'http_418', message: "I'm a Teapot" });
  });

  it('falls back to the status when the body has no text at all', () => {
    const err = toWatcherError(
      new CatalogClientError('x', { status: 504 }),
      'status',
      10_000,
    );
    expect(err).toMatchObject({ code: 'http_504', message: 'HTTP 504' });
  });

  it('truncates a long message from a body without a code, keeping the body in details', () => {
    const page = `<!DOCTYPE html>${'x'.repeat(500)}`;
    const body = { statusCode: 502, error: 'Bad Gateway', message: page };
    const err = toWatcherError(
      new CatalogClientError('x', { status: 502, body }),
      'search',
      10_000,
    );
    expect(err.code).toBe('http_502');
    expect(err.message).toBe(`${page.slice(0, MAX_UNCODED_MESSAGE_LENGTH)}...`);
    expect(err.details).toEqual(body);
  });

  it('keeps a long message from a body with a code', () => {
    const text = 'y'.repeat(500);
    const err = toWatcherError(
      new CatalogClientError('x', {
        status: 400,
        body: {
          statusCode: 400,
          error: 'Bad Request',
          message: text,
          code: 'WATCHER_INVALID_REQUEST',
        },
      }),
      'search',
      10_000,
    );
    expect(err.message).toBe(text);
  });

  it('describes a non-Error network cause', () => {
    const err = toWatcherError(
      new CatalogClientError('x', { status: 0, cause: 'socket hang up' }),
      'listIssues',
      10_000,
    );
    expect(err).toMatchObject({
      code: 'network_error',
      message: 'listIssues request failed: socket hang up',
    });
  });
});
