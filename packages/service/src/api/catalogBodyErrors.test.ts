/**
 * @module api/catalogBodyErrors.test
 * Malformed JSON and an unsupported content type on a catalog route answer as on any other catalog route (`POST /walk`), with Fastify's own code (`FST_ERR_CTP_*`). Every error body is Fastify's standard body, serialised `statusCode`, `code`, `error`, `message` in that order, as the API reference and the skill quote it.
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
      expect(reference.body).toMatchObject({
        code: 'FST_ERR_CTP_INVALID_JSON_BODY',
      });
      expect(result).toEqual(reference);
    },
  );

  it.each(['/search', '/config/apply'])(
    '%s answers an unsupported content type like a legacy route',
    async (url) => {
      const reference = await rawPost('/walk', 'application/x-nope', 'x');
      const result = await rawPost(url, 'application/x-nope', 'x');

      expect(reference.status).toBe(415);
      expect(reference.body).toMatchObject({
        code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE',
      });
      expect(result).toEqual(reference);
    },
  );

  it('answers an empty JSON body with 400 FST_ERR_CTP_EMPTY_JSON_BODY', async () => {
    const result = await rawPost('/search', 'application/json', '');

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      statusCode: 400,
      code: 'FST_ERR_CTP_EMPTY_JSON_BODY',
      error: 'Bad Request',
    });
  });
});

describe('catalog error body key order', () => {
  it.each([
    [
      '/config/apply',
      { patch: { watch: 5 } },
      400,
      '{"statusCode":400,"code":"JEEVES_CONFIG_INVALID","error":"Bad Request","message":',
    ],
    [
      '/render',
      { path: 'docs/a.txt' },
      403,
      '{"statusCode":403,"code":"WATCHER_PATH_NOT_WATCHED","error":"Forbidden","message":"The path is outside the watched scope or is gitignored."}',
    ],
  ] as const)(
    '%s sends statusCode, code, error, message in order',
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
