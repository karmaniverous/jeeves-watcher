/**
 * @module api/apiKeyAuth.test
 * Unit tests for the Bearer API-key hook: header parsing, timing-safe comparison (incl. length mismatch), the GET /status exemption and token-free logging.
 */

import * as crypto from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import type pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isAuthorized,
  isPublicRoute,
  registerApiKeyAuth,
  UNAUTHORIZED_BODY,
} from './apiKeyAuth';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof crypto>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const KEY = 'test-key-0123456789';
const keyDigest = crypto.createHash('sha256').update(KEY).digest();

describe('isAuthorized', () => {
  it.each([
    ['exact bearer token', `Bearer ${KEY}`, true],
    ['case-insensitive scheme', `bearer ${KEY}`, true],
    ['trailing whitespace', `Bearer ${KEY} `, true],
    ['missing header', undefined, false],
    ['empty header', '', false],
    ['scheme only', 'Bearer ', false],
    ['wrong scheme', `Basic ${KEY}`, false],
    ['raw token without scheme', KEY, false],
    ['wrong key, same length', `Bearer ${'x'.repeat(KEY.length)}`, false],
    ['shorter key', 'Bearer short', false],
    ['longer key', `Bearer ${KEY}${KEY}`, false],
    ['key prefix', `Bearer ${KEY.slice(0, -1)}`, false],
    ['two tokens', `Bearer ${KEY} extra`, false],
  ])('%s → %s', (_label, header, expected) => {
    expect(isAuthorized(header, keyDigest)).toBe(expected);
  });

  it('compares equal-length digests with timingSafeEqual on length mismatch', () => {
    const spy = vi.mocked(crypto.timingSafeEqual);
    spy.mockClear();
    expect(() => isAuthorized('Bearer a', keyDigest)).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    const [a, b] = spy.mock.calls[0] as [Buffer, Buffer];
    expect(a.length).toBe(b.length);
  });

  it('still runs one comparison when the header is missing', () => {
    const spy = vi.mocked(crypto.timingSafeEqual);
    spy.mockClear();
    isAuthorized(undefined, keyDigest);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('isPublicRoute', () => {
  it.each([
    ['GET', '/status', true],
    ['HEAD', '/status', true],
    ['GET', '/status?x=1', true],
    ['POST', '/status', false],
    ['GET', '/status/extra', false],
    ['GET', '/config', false],
    ['POST', '/search', false],
  ])('%s %s → %s', (method, url, expected) => {
    expect(isPublicRoute(method, url)).toBe(expected);
  });
});

describe('registerApiKeyAuth', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  function build(apiKey: string | undefined, logger?: pino.Logger) {
    app = Fastify({ logger: false });
    registerApiKeyAuth(app, apiKey, logger);
    app.get('/status', () => ({ ok: true }));
    app.get('/config', () => ({ config: true }));
    app.post('/search', () => ({ results: [] }));
    return app;
  }

  it('is a no-op when no key is configured', async () => {
    const server = build(undefined);
    const res = await server.inject({ method: 'GET', url: '/config' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects requests without a valid token with 401 and a fixed body', async () => {
    const server = build(KEY);
    for (const authorization of [undefined, 'Bearer wrong']) {
      const res = await server.inject({
        method: 'POST',
        url: '/search',
        headers: authorization ? { authorization } : {},
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(UNAUTHORIZED_BODY);
    }
  });

  it('accepts the configured key', async () => {
    const server = build(KEY);
    const res = await server.inject({
      method: 'GET',
      url: '/config',
      headers: { authorization: `Bearer ${KEY}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ config: true });
  });

  it('leaves GET /status open', async () => {
    const server = build(KEY);
    const res = await server.inject({ method: 'GET', url: '/status' });
    expect(res.statusCode).toBe(200);
  });

  it('requires auth for unknown routes too', async () => {
    const server = build(KEY);
    const res = await server.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(401);
  });

  it('fails closed for an empty configured key', async () => {
    const server = build('');
    const res = await server.inject({
      method: 'GET',
      url: '/config',
      headers: { authorization: 'Bearer ' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('never logs the presented token', async () => {
    const calls: unknown[][] = [];
    const record = (...args: unknown[]) => {
      calls.push(args);
    };
    const logger = {
      trace: record,
      debug: record,
      info: record,
      warn: record,
      error: record,
      fatal: record,
    } as unknown as pino.Logger;
    const server = build(KEY, logger);
    const presented = 'presented-secret-token-value';

    const res = await server.inject({
      method: 'GET',
      url: '/config?q=1',
      headers: { authorization: `Bearer ${presented}` },
    });

    expect(res.statusCode).toBe(401);
    expect(calls.length).toBeGreaterThan(0);
    const logged = JSON.stringify(calls);
    expect(logged).not.toContain(presented);
    expect(logged).not.toContain(KEY);
  });
});
