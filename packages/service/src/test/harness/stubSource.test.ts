/**
 * @module test/harness/stubSource.test
 * Tests for the stub HTTP source server: canned JSON by path, status/content-type/headers, delay, 404 default, request recording and close.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { startStubSourceServer, type StubSourceServer } from './stubSource';

describe('startStubSourceServer', () => {
  let stub: StubSourceServer | undefined;

  afterEach(async () => {
    await stub?.close();
    stub = undefined;
  });

  it('serves canned JSON by path and records the request', async () => {
    stub = await startStubSourceServer({
      '/threads/t1': { body: { id: 't1', messages: [] } },
    });

    const res = await fetch(`${stub.url}/threads/t1?x=1`, {
      headers: { authorization: 'Bearer s' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ id: 't1', messages: [] });
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]).toMatchObject({
      method: 'GET',
      url: '/threads/t1?x=1',
      path: '/threads/t1',
    });
    expect(stub.requests[0].headers.authorization).toBe('Bearer s');
  });

  it('returns 404 for unknown paths', async () => {
    stub = await startStubSourceServer();
    const res = await fetch(`${stub.url}/missing`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });

  it('honours status, content type, raw string bodies and headers', async () => {
    stub = await startStubSourceServer();
    stub.route('/md', {
      status: 503,
      contentType: 'text/markdown',
      body: '# hi',
      headers: { 'retry-after': '2' },
    });

    const res = await fetch(`${stub.url}/md`);

    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toBe('text/markdown');
    expect(res.headers.get('retry-after')).toBe('2');
    expect(await res.text()).toBe('# hi');
  });

  it('matches raw (encoded) paths and supports function routes', async () => {
    stub = await startStubSourceServer();
    stub.route('/a%2Fb', (req) => ({ body: { echoed: req.method } }));

    const res = await fetch(`${stub.url}/a%2Fb`, { method: 'POST', body: 'x' });

    expect(await res.json()).toEqual({ echoed: 'POST' });
    expect(stub.requests[0].body).toBe('x');
  });

  it('delays responses', async () => {
    stub = await startStubSourceServer({ '/slow': { delayMs: 150, body: {} } });
    const started = Date.now();
    await fetch(`${stub.url}/slow`);
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
  });

  it('closes promptly with a delayed response in flight', async () => {
    stub = await startStubSourceServer({ '/hang': { delayMs: 60_000 } });
    const pending = fetch(`${stub.url}/hang`).catch(() => 'aborted');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await stub.close();
    stub = undefined;
    expect(await pending).toBe('aborted');
  });

  it('reset clears routes and recorded requests', async () => {
    stub = await startStubSourceServer({ '/x': { body: {} } });
    await fetch(`${stub.url}/x`);
    stub.reset();
    expect(stub.requests).toHaveLength(0);
    expect((await fetch(`${stub.url}/x`)).status).toBe(404);
  });
});
