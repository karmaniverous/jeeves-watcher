/**
 * @module toWatcherError.test
 * Unit tests for the one CatalogClientError-to-WatcherError mapping: the retry-delay clamp, message composition, and failures that are not catalog-client errors.
 */

import { CatalogClientError } from '@karmaniverous/jeeves/catalog';
import { describe, expect, it } from 'vitest';

import {
  clampRetryAfter,
  MAX_RETRY_AFTER_MS,
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

  it('uses the body message alone when the body has no error text', () => {
    const err = toWatcherError(
      new CatalogClientError('x', {
        status: 418,
        body: { error: '', message: 'teapot' },
      }),
      'status',
      10_000,
    );
    expect(err).toMatchObject({ code: 'http_418', message: 'teapot' });
  });

  it('keeps the error text alone when the body message repeats it', () => {
    const err = toWatcherError(
      new CatalogClientError('x', {
        status: 409,
        body: { error: 'Conflict', message: 'Conflict', code: 'conflict' },
      }),
      'reindex',
      10_000,
    );
    expect(err.message).toBe('Conflict');
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
