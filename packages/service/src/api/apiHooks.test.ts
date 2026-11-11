/**
 * @module api/apiHooks.test
 * Fastify inject tests for the server-wide hooks (the 401 itself is covered by apiKeyAuth.test and routeAuth.test): authorized requests pass through, `404 WATCHER_NOT_FOUND` for unknown routes, Fastify's own 4xx kept with their `FST_ERR_*` code, a thrown watcher class sent as written, and any other error a masked 500 logged through the watcher's logger.
 */

import { SERVER_ERROR_MESSAGE } from '@karmaniverous/jeeves/fastify';
import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerApiHooks, routeNotFound } from './apiHooks';
import { MESSAGE_ARG_MAX, ScanInProgress } from './errors';

const KEY = 'test-key';

let app: FastifyInstance | undefined;

function build(apiKey?: string, logger = pino({ level: 'silent' })) {
  const instance = Fastify({ logger: false });
  app = instance;
  registerApiHooks(instance, apiKey, logger);
  instance.post('/echo', (request) => request.body);
  instance.get('/boom', () => {
    throw new Error('secret connection string');
  });
  instance.get('/teapot', () => {
    throw Object.assign(new Error('short and stout'), { statusCode: 418 });
  });
  instance.get('/scan', () => {
    throw new ScanInProgress();
  });
  return instance;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('routeNotFound', () => {
  it('names the method and URL', () => {
    expect(routeNotFound({ method: 'GET', url: '/x?y=1' })).toMatchObject({
      statusCode: 404,
      code: 'WATCHER_NOT_FOUND',
      message: 'Route GET:/x?y=1 not found',
    });
  });

  it('caps a long URL', () => {
    const url = `/${'a'.repeat(1000)}`;
    const { message } = routeNotFound({ method: 'GET', url });
    expect(message).toBe(
      `Route GET:${url.slice(0, MESSAGE_ARG_MAX - 1)}… not found`,
    );
  });
});

describe('registerApiHooks', () => {
  it('answers unknown routes with 404 WATCHER_NOT_FOUND', async () => {
    const res = await build().inject({ method: 'GET', url: '/nope?x=1' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      statusCode: 404,
      code: 'WATCHER_NOT_FOUND',
      error: 'Not Found',
      message: 'Route GET:/nope?x=1 not found',
    });
  });

  it('passes authorized requests through to the not-found handler', async () => {
    const res = await build(KEY).inject({
      method: 'GET',
      url: '/nope',
      headers: { authorization: `Bearer ${KEY}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'WATCHER_NOT_FOUND' });
  });

  it("keeps Fastify's own code on malformed JSON", async () => {
    const res = await build().inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      statusCode: 400,
      code: 'FST_ERR_CTP_INVALID_JSON_BODY',
      error: 'Bad Request',
    });
  });

  it("keeps Fastify's own code on an unsupported media type", async () => {
    const res = await build().inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/x-unknown' },
      payload: 'x',
    });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toMatchObject({
      code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE',
    });
  });

  it('sends a thrown watcher class as written', async () => {
    const res = await build().inject({ method: 'GET', url: '/scan' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      statusCode: 503,
      code: 'WATCHER_SCAN_IN_PROGRESS',
      error: 'Service Unavailable',
      message:
        'The initial filesystem scan is still running; retry when it finishes.',
    });
  });

  it('masks a plain status-bearing error as a 500', async () => {
    const res = await build().inject({ method: 'GET', url: '/teapot' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: SERVER_ERROR_MESSAGE,
    });
  });

  it('masks an uncaught error and logs it through the watcher logger', async () => {
    const logger = pino({ level: 'silent' });
    const error = vi.spyOn(logger, 'error');
    const res = await build(undefined, logger).inject({
      method: 'GET',
      url: '/boom',
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: SERVER_ERROR_MESSAGE,
    });
    expect(res.body).not.toContain('secret');
    expect(error).toHaveBeenCalled();
  });
});
