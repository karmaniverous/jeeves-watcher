/**
 * @module api/apiKeyAuth.test
 * Unit tests for the Bearer API-key hook: header parsing, timing-safe comparison (incl. length mismatch) against one key or every named key, the GET /status exemption and token-free logging.
 */

import * as crypto from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import type pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isAuthorized, isPublicRoute, registerApiKeyAuth } from './apiKeyAuth';

/** The 401 body: Fastify's standard error body, no other header (D204 (6)). */
const UNAUTHORIZED_BODY = {
  statusCode: 401,
  code: 'WATCHER_UNAUTHORIZED',
  error: 'Unauthorized',
  message: 'A valid API key is required: send Authorization: Bearer <key>.',
};

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof crypto>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const KEY = 'test-key-0123456789';
const ALICE = 'alice-key-0123456789';
const BOB = 'bob-key-0123456789';
const digestOf = (key: string) =>
  crypto.createHash('sha256').update(key).digest();
const keyDigest = [digestOf(KEY)];

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

  it.each([
    ['the first key', ALICE, true],
    ['the last key', BOB, true],
    ['no key', KEY, false],
  ])(
    'compares against every named key when the token matches %s',
    (_label, token, expected) => {
      const spy = vi.mocked(crypto.timingSafeEqual);
      spy.mockClear();
      expect(
        isAuthorized(`Bearer ${token}`, [digestOf(ALICE), digestOf(BOB)]),
      ).toBe(expected);
      expect(spy).toHaveBeenCalledTimes(2);
    },
  );

  it('refuses every token when no key is configured', () => {
    expect(isAuthorized(`Bearer ${KEY}`, [])).toBe(false);
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

  function build(apiKeys: readonly string[] | undefined, logger?: pino.Logger) {
    app = Fastify({ logger: false });
    registerApiKeyAuth(app, apiKeys, logger);
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
    const server = build([KEY]);
    for (const authorization of [undefined, 'Bearer wrong']) {
      const res = await server.inject({
        method: 'POST',
        url: '/search',
        headers: authorization ? { authorization } : {},
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(UNAUTHORIZED_BODY);
      expect(res.headers['www-authenticate']).toBeUndefined();
    }
  });

  it('accepts the configured key', async () => {
    const server = build([KEY]);
    const res = await server.inject({
      method: 'GET',
      url: '/config',
      headers: { authorization: `Bearer ${KEY}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ config: true });
  });

  it('accepts each of several keys and rejects any other', async () => {
    const server = build([ALICE, BOB]);
    const status = async (key: string) =>
      (
        await server.inject({
          method: 'GET',
          url: '/config',
          headers: { authorization: `Bearer ${key}` },
        })
      ).statusCode;

    expect(await status(ALICE)).toBe(200);
    expect(await status(BOB)).toBe(200);
    expect(await status(KEY)).toBe(401);
    expect(await status('alice')).toBe(401);
  });

  it('leaves GET /status open', async () => {
    const server = build([KEY]);
    const res = await server.inject({ method: 'GET', url: '/status' });
    expect(res.statusCode).toBe(200);
  });

  it('requires auth for unknown routes too', async () => {
    const server = build([KEY]);
    const res = await server.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(401);
  });

  it('fails closed for an empty configured key', async () => {
    const server = build(['']);
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
    const server = build([KEY], logger);
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
