/**
 * @module httpContract.test
 * The shared HTTP client contract: bearer headers, JSON parsing, the canonical / legacy mapping of a non-2xx response (every API error code, details fallbacks), the one-line error text and the 401 guidance.
 */

import { describe, expect, it } from 'vitest';

import { API_ERROR_CODES } from './api/errors';
import {
  bearerHeaders,
  formatHttpError,
  httpError,
  tryParseJson,
  unauthorizedMessage,
} from './httpContract';

const map = (status: number, body: unknown) =>
  httpError(status, '', typeof body === 'string' ? body : JSON.stringify(body));

describe('bearerHeaders', () => {
  it('builds the Authorization header only for a key', () => {
    expect(bearerHeaders('k1')).toEqual({ Authorization: 'Bearer k1' });
    expect(bearerHeaders(undefined)).toEqual({});
  });
});

describe('tryParseJson', () => {
  it.each([
    ['{"a":1}', { a: 1 }],
    ['', undefined],
    ['not json', undefined],
  ])('%j → %j', (text, expected) => {
    expect(tryParseJson(text)).toEqual(expected);
  });
});

describe('httpError: canonical error bodies', () => {
  it.each(API_ERROR_CODES)('takes code %s from the body', (code) => {
    expect(map(400, { code, error: 'Human text' })).toMatchObject({
      status: 400,
      code,
      message: 'Human text',
    });
  });

  it('appends body.message to body.error, never repeating it', () => {
    expect(
      map(503, {
        code: 'embedding_unavailable',
        error: 'EmbeddingUnavailableError',
        message: 'quota exhausted',
      }).message,
    ).toBe('EmbeddingUnavailableError: quota exhausted');
    expect(
      map(500, { code: 'internal_error', error: 'x', message: 'x' }).message,
    ).toBe('x');
  });

  it('keeps body.details', () => {
    expect(
      map(400, {
        code: 'invalid_request',
        error: 'bad',
        details: [{ path: ['a'] }],
      }).details,
    ).toEqual([{ path: ['a'] }]);
  });

  it('falls back to the whole parsed body as details', () => {
    const body = { code: 'not_found', error: 'Not Found' };
    expect(map(404, body).details).toEqual(body);
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
    [
      'non-JSON body',
      'Bad Gateway',
      { code: 'http_404', message: 'HTTP 404', details: 'Bad Gateway' },
    ],
  ])('%s', (_, body, expected) => {
    expect(map(404, body)).toMatchObject({ status: 404, ...expected });
  });

  it('uses the status text and leaves details unset for an empty body', () => {
    expect(httpError(502, 'Bad Gateway', '')).toEqual({
      status: 502,
      code: 'http_502',
      message: 'HTTP 502 Bad Gateway',
      details: undefined,
    });
  });
});

describe('formatHttpError', () => {
  it('reports status, code and message on one line', () => {
    expect(
      formatHttpError({ status: 404, code: 'not_found', message: 'Gone' }),
    ).toBe('HTTP 404 not_found: Gone');
  });
});

describe('unauthorizedMessage', () => {
  it('names the key sources and distinguishes a rejected key', () => {
    const missing = unauthorizedMessage(false, '--api-key');
    const rejected = unauthorizedMessage(true, '--api-key');
    expect(missing).toMatch(/^HTTP 401 unauthorized: .*requires an API key/);
    expect(missing).toContain('--api-key');
    expect(rejected).toMatch(/rejected the API key\. Check --api-key/);
  });
});
