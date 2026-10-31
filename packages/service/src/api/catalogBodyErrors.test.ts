/**
 * @module api/catalogBodyErrors.test
 * Malformed JSON and an unsupported content type on a catalog route keep the service's existing error handler (spec #281): the same status and body as on a route outside the catalog (`POST /walk`). A catalog route's own error body is serialised `error` first, then `code`, as the API reference and the skill quote it.
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

/** Status, content type and parsed body of a raw POST. */
async function rawPost(url: string, contentType: string, payload: string) {
  const res = await wire.app.inject({
    method: 'POST',
    url,
    headers: { ...WIRE_AUTH, 'content-type': contentType },
    payload,
  });
  return {
    status: res.statusCode,
    contentType: res.headers['content-type'],
    body: res.json<Record<string, unknown>>(),
  };
}

describe('body errors on catalog routes', () => {
  it.each(['/search', '/scan', '/render', '/config/apply'])(
    '%s answers malformed JSON like a legacy route',
    async (url) => {
      const reference = await rawPost(
        '/walk',
        'application/json',
        '{ not json',
      );
      const result = await rawPost(url, 'application/json', '{ not json');

      expect(reference.status).toBe(400);
      expect(reference.body).toMatchObject({ code: 'invalid_request' });
      expect(result).toEqual(reference);
    },
  );

  it.each(['/search', '/config/apply'])(
    '%s answers an unsupported content type like a legacy route',
    async (url) => {
      const reference = await rawPost('/walk', 'application/x-nope', 'x');
      const result = await rawPost(url, 'application/x-nope', 'x');

      expect(reference.status).toBe(415);
      expect(reference.body).toMatchObject({ code: 'invalid_request' });
      expect(result).toEqual(reference);
    },
  );
});

describe('catalog error body key order', () => {
  it.each([
    [
      '/config/apply',
      { patch: { watch: 5 } },
      400,
      '{"error":"Config validation failed","code":"invalid_request","issues":[',
    ],
    [
      '/render',
      { path: 'docs/a.txt' },
      403,
      '{"error":"Path is outside watched scope","code":"path_not_watched"}',
    ],
  ] as const)(
    '%s sends error before code',
    async (url, body, status, start) => {
      const res = await wire.app.inject({
        method: 'POST',
        url,
        headers: WIRE_AUTH,
        payload: body,
      });
      expect(res.statusCode).toBe(status);
      expect(res.body.startsWith(start)).toBe(true);
    },
  );
});
