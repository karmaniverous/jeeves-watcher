/**
 * @module api/apiHooks.test
 * Fastify inject tests for the server-wide hooks: 401 unauthorized, 404 not_found for unknown routes, framework 4xx as invalid_request and uncaught errors as 500 internal_error without leaking the message.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import { registerApiHooks, statusOfError } from './apiHooks';
import { INTERNAL_ERROR_MESSAGE } from './sendError';

const logger = pino({ level: 'silent' });
const KEY = 'test-key';

let app: FastifyInstance | undefined;

function build(apiKey?: string): FastifyInstance {
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
  return instance;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('statusOfError', () => {
  it.each([
    [Object.assign(new Error('x'), { statusCode: 400 }), 400],
    [Object.assign(new Error('x'), { statusCode: 503 }), 503],
    [Object.assign(new Error('x'), { statusCode: 302 }), 500],
    [Object.assign(new Error('x'), { statusCode: '400' }), 500],
    [new Error('x'), 500],
    ['text', 500],
    [null, 500],
  ])('%o -> %i', (error, status) => {
    expect(statusOfError(error)).toBe(status);
  });
});

describe('registerApiHooks', () => {
  it('answers unknown routes with 404 not_found', async () => {
    const res = await build().inject({ method: 'GET', url: '/nope?x=1' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      code: 'not_found',
      error: 'Not Found',
      message: 'Route GET:/nope?x=1 not found',
    });
  });

  it('answers a missing bearer token with 401 unauthorized', async () => {
    const res = await build(KEY).inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: 'unauthorized', error: 'Unauthorized' });
  });

  it('passes authorized requests through to the not-found handler', async () => {
    const res = await build(KEY).inject({
      method: 'GET',
      url: '/nope',
      headers: { authorization: `Bearer ${KEY}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'not_found' });
  });

  it('maps malformed JSON to 400 invalid_request', async () => {
    const res = await build().inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: 'invalid_request',
      error: 'Bad Request',
    });
  });

  it('maps an unsupported media type to 415 invalid_request', async () => {
    const res = await build().inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/x-unknown' },
      payload: 'x',
    });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toMatchObject({ code: 'invalid_request' });
  });

  it('keeps the status and message of a thrown 4xx', async () => {
    const res = await build().inject({ method: 'GET', url: '/teapot' });
    expect(res.statusCode).toBe(418);
    expect(res.json()).toEqual({
      code: 'invalid_request',
      error: "I'm a Teapot",
      message: 'short and stout',
    });
  });

  it('maps an uncaught error to 500 internal_error without leaking it', async () => {
    const res = await build().inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      code: 'internal_error',
      error: 'Internal Server Error',
      message: INTERNAL_ERROR_MESSAGE,
    });
    expect(res.body).not.toContain('secret');
  });
});
