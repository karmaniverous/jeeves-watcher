/**
 * @module api/vcsShowWithoutVcs.test
 * With VCS off, `/vcs/show` answers the not-found 404 for `GET` and for the `HEAD` route Fastify derives from it, whatever the query (spec #281 D28): never a validation 400.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { captureLogger } from '../test/wire/captureLogger';
import { startWireApp, WIRE_AUTH, type WireApp } from '../test/wire/wireApp';

let wire: WireApp;
const captured = captureLogger();

beforeAll(async () => {
  wire = await startWireApp(captured.logger);
}, 30_000);

afterAll(async () => {
  await wire.close();
});

describe('/vcs/show without VCS', () => {
  it.each([
    ['GET', '/vcs/show'],
    ['GET', '/vcs/show?path=a.md&commit=abc'],
    ['HEAD', '/vcs/show'],
    ['HEAD', '/vcs/show?path=a.md&commit=abc'],
  ] as const)('%s %s is 404 not_found', async (method, url) => {
    const res = await wire.appWithoutVcs.inject({
      method,
      url,
      headers: WIRE_AUTH,
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET gives the not-found body', async () => {
    const res = await wire.appWithoutVcs.inject({
      method: 'GET',
      url: '/vcs/show',
      headers: WIRE_AUTH,
    });
    expect(res.json()).toMatchObject({ code: 'not_found' });
  });
});
