/**
 * @module api/handlers/withCache.test
 * Tests for the withCache higher-order handler.
 */

import { describe, expect, it } from 'vitest';

import { clearCache, hashObject, withCache } from './withCache';

function mockReq(method = 'POST', url = '/render', body = { path: 'test' }) {
  return { method, url, body } as never;
}

function mockReply(headers: Record<string, string> = {}, statusCode = 200) {
  const reply = {
    statusCode,
    getHeader(name: string) {
      return headers[name];
    },
    // FastifyReply.send exists; withCache intercepts it.
    send() {
      return reply as unknown;
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

  it('never caches an error reply', async () => {
    clearCache();
    let callCount = 0;
    const handler = withCache(60000, () => {
      callCount++;
      return { error: 'nope' };
    });

    const req = mockReq();
    const reply = mockReply({}, 404);

    await handler(req, reply);
    await handler(req, reply);

    expect(callCount).toBe(2);
  });
});

describe('hashObject', () => {
  it('keeps undefined, null, a string and its JSON spelling apart', () => {
    const hashes = [undefined, null, 'null', '"x"', 'x', { a: 1 }].map(
      hashObject,
    );
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('hashes equal values equally', () => {
    expect(hashObject({ a: [1, 2] })).toBe(hashObject({ a: [1, 2] }));
  });
});
