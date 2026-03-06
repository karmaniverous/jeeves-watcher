/**
 * @module api/handlers/withCache.test
 * Tests for the withCache higher-order handler.
 */

import { describe, expect, it } from 'vitest';

import { clearCache, withCache } from './withCache';

function mockReq(method = 'POST', url = '/render', body = { path: 'test' }) {
  return { method, url, body } as never;
}

function mockReply(headers: Record<string, string> = {}) {
  const reply = {
    statusCode: 200,
    getHeader(name: string) {
      return headers[name];
    },
  };
  return reply as never;
}

describe('withCache', () => {
  it('caches handler results on second call', async () => {
    clearCache();
    let callCount = 0;
    const handler = withCache(60000, () => {
      callCount++;
      return { data: 'result' };
    });

    const req = mockReq();
    const reply = mockReply();

    await handler(req, reply);
    await handler(req, reply);

    expect(callCount).toBe(1);
  });

  it('skips cache when Cache-Control is no-cache', async () => {
    clearCache();
    let callCount = 0;
    const handler = withCache(60000, () => {
      callCount++;
      return { data: 'fresh' };
    });

    const req = mockReq();
    const reply = mockReply({ 'Cache-Control': 'no-cache' });

    await handler(req, reply);
    await handler(req, reply);

    expect(callCount).toBe(2);
  });

  it('does not skip cache for other Cache-Control values', async () => {
    clearCache();
    let callCount = 0;
    const handler = withCache(60000, () => {
      callCount++;
      return { data: 'cacheable' };
    });

    const req = mockReq();
    const reply = mockReply({ 'Cache-Control': 'max-age=300' });

    await handler(req, reply);
    await handler(req, reply);

    expect(callCount).toBe(1);
  });
});
