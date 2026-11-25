/**
 * @module mcp/injectTransport.test
 * The inject transport sends a catalog request to the app's own routes (method, path, query, JSON body, its headers and the ones it was given) and maps the reply (status, headers, JSON, text, bytes, stream); an aborted signal stops the wait.
 */

import type { CatalogResponse } from '@karmaniverous/jeeves/catalog';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { injectTransport } from './injectTransport';

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

/** An app echoing what it received. */
function echoApp(): FastifyInstance {
  const echo = Fastify();
  echo.all('/echo', (request, reply) =>
    reply.header('x-seen', ['a', 'b']).send({
      method: request.method,
      query: request.query,
      body: request.body ?? null,
      auth: request.headers.authorization ?? null,
      type: request.headers['content-type'] ?? null,
    }),
  );
  echo.get('/text', (_request, reply) =>
    reply.type('text/plain').code(202).send('plain'),
  );
  echo.get('/empty', (_request, reply) => reply.code(204).send());
  echo.get('/slow', () => new Promise(() => undefined));
  return echo;
}

const request = (
  overrides: Partial<Parameters<ReturnType<typeof injectTransport>>[0]> = {},
) => ({
  method: 'GET' as const,
  path: '/echo',
  query: [] as [string, string][],
  headers: {},
  ...overrides,
});

describe('injectTransport', () => {
  it('sends method, encoded query, JSON body and headers', async () => {
    app = echoApp();

    const res = await injectTransport(app)(
      request({
        method: 'POST',
        query: [
          ['path', '$.a b&c=d'],
          ['tag', 'x'],
          ['tag', 'y'],
        ],
        body: { value: 1 },
        headers: { authorization: 'Bearer k' },
      }),
      new AbortController().signal,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      method: 'POST',
      query: { path: '$.a b&c=d', tag: ['x', 'y'] },
      body: { value: 1 },
      auth: 'Bearer k',
      type: 'application/json',
    });
    expect(res.headers.get('x-seen')).toBe('a, b');
  });

  it('adds the given headers to every request', async () => {
    app = echoApp();

    const res = await injectTransport(app, { authorization: 'Bearer caller' })(
      request(),
      new AbortController().signal,
    );

    expect(await res.json()).toMatchObject({ auth: 'Bearer caller' });
  });

  it('sends no content type without a body', async () => {
    app = echoApp();

    const res = await injectTransport(app)(
      request(),
      new AbortController().signal,
    );

    expect(await res.json()).toMatchObject({ body: null, type: null });
  });

  it.each([
    ['text', (res: CatalogResponse) => res.text()],
    [
      'bytes',
      async (res: CatalogResponse) =>
        new TextDecoder().decode(await res.bytes()),
    ],
    ['stream', (res: CatalogResponse) => new Response(res.body).text()],
  ])('exposes the reply status and body as %s', async (_label, read) => {
    app = echoApp();

    const res = await injectTransport(app)(
      request({ path: '/text' }),
      new AbortController().signal,
    );

    expect(res.status).toBe(202);
    expect(await read(res)).toBe('plain');
  });

  it('answers a 204 with no body', async () => {
    app = echoApp();

    const res = await injectTransport(app)(
      request({ path: '/empty' }),
      new AbortController().signal,
    );

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('rejects with the abort reason once the signal aborts', async () => {
    app = echoApp();
    const controller = new AbortController();

    const pending = injectTransport(app)(
      request({ path: '/slow' }),
      controller.signal,
    );
    controller.abort(new Error('timed out'));

    await expect(pending).rejects.toThrow('timed out');
  });

  it('rejects at once for an already aborted signal', async () => {
    app = echoApp();

    await expect(
      injectTransport(app)(request(), AbortSignal.abort(new Error('gone'))),
    ).rejects.toThrow('gone');
  });
});
