/**
 * @module embedding/rateLimitError.test
 * parseRetryAfterMs: first value of a repeated Retry-After header, Google RetryInfo.retryDelay in the body as fallback, header preferred, undefined when absent or unparseable.
 */

import { describe, expect, it } from 'vitest';

import { parseRetryAfterMs } from './rateLimitError';

describe('parseRetryAfterMs', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');

  it.each([
    ['delta-seconds', '5', 5_000],
    ['fractional seconds', '1.5', 1_500],
    ['zero', '0', 0],
    ['HTTP-date', 'Mon, 12 Oct 2026 12:00:30 GMT', 30_000],
    ['HTTP-date in the past', 'Mon, 12 Oct 2026 11:59:00 GMT', 0],
  ])('parses %s', (_label, header, expected) => {
    expect(parseRetryAfterMs(header, undefined, now)).toBe(expected);
  });

  it('uses the first value of a repeated header', () => {
    expect(parseRetryAfterMs(['2', '9'], undefined, now)).toBe(2_000);
  });

  it('falls back to Google RetryInfo.retryDelay in the body', () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.RetryInfo',
            retryDelay: '17s',
          },
        ],
      },
    });
    expect(parseRetryAfterMs(undefined, body, now)).toBe(17_000);
  });

  it('prefers the header over the body', () => {
    expect(parseRetryAfterMs('3', '{"retryDelay": "17s"}', now)).toBe(3_000);
  });

  it('returns undefined when no delay is given or it is unparseable', () => {
    expect(parseRetryAfterMs(undefined, undefined, now)).toBeUndefined();
    expect(parseRetryAfterMs('soon', '{}', now)).toBeUndefined();
  });
});
