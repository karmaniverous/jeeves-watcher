/**
 * @module api/registerCatalogHooks.test
 * The hooks `registerCatalog` puts in front of the catalog handlers, on the real server. The feature gate: with VCS off, every `/vcs/*` route answers the exact not-found 404 an unregistered route sends (`notFoundBody`, url with its query string) for `GET`, the derived `HEAD`, and `POST`, before the query or body is validated or even parsed (spec Design 3, D28, D50); with VCS on, the routes run and validate normally, and ungated routes are unaffected. The body normalisation: a bodyless `POST /rebuild-metadata` still succeeds, as in 0.20.0.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { captureLogger } from '../test/wire/captureLogger';
import { startWireApp, WIRE_AUTH, type WireApp } from '../test/wire/wireApp';
import { notFoundBody } from './catalog/notFoundBody';
import { WATCHER_FEATURE_GATES } from './featureGates';

let wire: WireApp;
const captured = captureLogger();

beforeAll(async () => {
  wire = await startWireApp(captured.logger);
}, 30_000);

afterAll(async () => {
  await wire.close();
});

type Method = 'GET' | 'HEAD' | 'POST' | 'DELETE';

const send = (
  app: FastifyInstance,
  method: Method,
  url: string,
  payload?: string | object,
) =>
  app.inject({
    method,
    url,
    headers: {
      ...WIRE_AUTH,
      ...(typeof payload === 'string'
        ? { 'content-type': 'application/json' }
        : {}),
    },
    ...(payload === undefined ? {} : { payload }),
  });

/** One request per gated route (and some malformed ones). */
const GATED: Array<[Method, string, (string | object)?]> = [
  ['GET', '/vcs/status'],
  ['GET', '/vcs/history?glob=a.md&limit=2'],
  ['GET', '/vcs/history'],
  ['GET', '/vcs/show?path=a.md&commit=abc'],
  ['GET', '/vcs/show'],
  ['GET', '/vcs/diff?glob=a.md&commit=abc'],
  ['GET', '/vcs/check-exclusion?path=a.md'],
  ['POST', '/vcs/revert', { glob: 'a.md', commit: 'abc' }],
  ['POST', '/vcs/revert', {}],
  ['POST', '/vcs/exclude', { glob: '*.log' }],
  ['POST', '/vcs/exclude', '{not json'],
];

describe('feature gate, VCS off', () => {
  it('gates every /vcs/* catalog entry', () => {
    expect(Object.keys(WATCHER_FEATURE_GATES).sort()).toEqual([
      'checkVcsExclusion',
      'diffVcs',
      'excludeVcsPath',
      'getVcsStatus',
      'listVcsHistory',
      'revertVcs',
      'showVcsFile',
    ]);
  });

  it.each(GATED)(
    '%s %s answers the not-found 404 with its url',
    async (method, url, payload) => {
      const res = await send(wire.appWithoutVcs, method, url, payload);

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(notFoundBody(method, url));
    },
  );

  it.each([
    '/vcs/status',
    '/vcs/show?path=a.md&commit=abc',
    '/vcs/history',
    '/vcs/diff',
    '/vcs/check-exclusion',
  ])('HEAD %s is 404 with no body', async (url) => {
    const res = await send(wire.appWithoutVcs, 'HEAD', url);

    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('');
  });

  it('answers a method no entry has like any unregistered route', async () => {
    const res = await send(wire.appWithoutVcs, 'DELETE', '/vcs/status?x=1');

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual(notFoundBody('DELETE', '/vcs/status?x=1'));
  });

  it('leaves ungated routes alone', async () => {
    const res = await send(wire.appWithoutVcs, 'GET', '/issues');

    expect(res.statusCode).toBe(200);
  });
});

describe('feature gate, VCS on', () => {
  it('runs a gated route', async () => {
    const res = await send(wire.app, 'GET', '/vcs/status');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ enabled: true });
  });

  it('validates a gated route normally', async () => {
    const res = await send(wire.app, 'GET', '/vcs/history');

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'invalid_request' });
  });

  it('answers HEAD on a gated GET route', async () => {
    const res = await send(wire.app, 'HEAD', '/vcs/status');

    expect(res.statusCode).toBe(200);
  });
});

describe('body normalisation', () => {
  it('accepts a bodyless POST /rebuild-metadata', async () => {
    const res = await send(wire.app, 'POST', '/rebuild-metadata');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  // /config/validate's fields are all optional, so only the missing body
  // itself is rejected: the normalisation is for /rebuild-metadata alone.
  it.each(['/walk', '/config/validate'])(
    'still rejects a bodyless POST %s',
    async (url) => {
      const res = await send(wire.app, 'POST', url);

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'invalid_request' });
    },
  );
});
