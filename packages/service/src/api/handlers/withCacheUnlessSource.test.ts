/**
 * @module api/handlers/withCacheUnlessSource.test
 * withCacheUnlessSource through a real Fastify route: repeated file-path bodies are served from the response cache, source bodies always run the handler (no cache read or write).
 */

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withCacheUnlessSource } from './withCacheUnlessSource';

let app: FastifyInstance;
let calls: number;

beforeEach(() => {
  calls = 0;
  app = Fastify();
  const handler = vi.fn((req: FastifyRequest<{ Body: unknown }>) => {
    calls++;
    return Promise.resolve({ calls, body: req.body });
  });
  app.post('/render-cache-test', withCacheUnlessSource(60_000, handler));
});

afterEach(async () => {
  await app.close();
});

const post = async (payload: object) => {
  const res = await app.inject({
    method: 'POST',
    url: '/render-cache-test',
    payload,
  });
  return res.json<{ calls: number }>();
};

describe('withCacheUnlessSource', () => {
  it('caches responses for file-path bodies', async () => {
    const path = { path: `/cache-test/${String(Date.now())}.md` };
    const first = await post(path);
    const second = await post(path);
    expect(first.calls).toBe(1);
    expect(second.calls).toBe(1);
    expect(calls).toBe(1);
  });

  it('never caches source bodies', async () => {
    const source = { source: `app://cache-test/${String(Date.now())}` };
    await post(source);
    const second = await post(source);
    expect(second.calls).toBe(2);
    expect(calls).toBe(2);
  });
});
