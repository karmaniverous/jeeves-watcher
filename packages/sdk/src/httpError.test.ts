/**
 * @module httpError.test
 * Unit tests for mapping non-2xx responses to WatcherError: canonical 0.20.0+ error bodies (every API error code) and the legacy fallback for older or non-conforming bodies.
 */

import { API_ERROR_CODES } from '@karmaniverous/jeeves-watcher-core';
import { describe, expect, it } from 'vitest';

import { httpError } from './httpError';
import { WatcherError } from './WatcherError';

const map = (status: number, body: unknown) =>
  httpError(status, '', typeof body === 'string' ? body : JSON.stringify(body));

describe('httpError: canonical error bodies', () => {
  it.each(API_ERROR_CODES)('takes code %s from the body', (code) => {
    const error = map(400, { code, error: 'Human text' });
    expect(error).toBeInstanceOf(WatcherError);
    expect(error.code).toBe(code);
    expect(error.message).toBe('Human text');
    expect(error.status).toBe(400);
  });

  it('maps a 401 to unauthorized, not the human text', () => {
    const error = map(401, { code: 'unauthorized', error: 'Unauthorized' });
    expect(error).toMatchObject({
      status: 401,
      code: 'unauthorized',
      message: 'Unauthorized',
    });
  });

  it('appends body.message to body.error', () => {
    const error = map(503, {
      code: 'embedding_unavailable',
      error: 'EmbeddingUnavailableError',
      message: 'quota exhausted',
    });
    expect(error.code).toBe('embedding_unavailable');
    expect(error.message).toBe('EmbeddingUnavailableError: quota exhausted');
  });

  it('does not repeat an identical message', () => {
    const error = map(500, {
      code: 'internal_error',
      error: 'x',
      message: 'x',
    });
    expect(error.message).toBe('x');
  });

  it('keeps details', () => {
    const error = map(400, {
      code: 'invalid_request',
      error: 'bad',
      details: [{ path: ['a'] }],
    });
    expect(error.details).toEqual([{ path: ['a'] }]);
  });
});

describe('httpError: legacy fallback', () => {
  it.each([
    [
      'unknown code string',
      { code: 'future_code', error: 'Text', message: 'More' },
      { code: 'future_code', message: 'More' },
    ],
    [
      'canonical code without error text',
      { code: 'not_found' },
      { code: 'not_found', message: 'HTTP 404' },
    ],
    [
      'no code (pre-0.20.0 service)',
      { error: 'Unauthorized' },
      { code: 'Unauthorized', message: 'Unauthorized' },
    ],
    ['non-JSON body', 'Bad Gateway', { code: 'http_404', message: 'HTTP 404' }],
  ])('%s', (_, body, expected) => {
    expect(map(404, body)).toMatchObject({ status: 404, ...expected });
  });
});
