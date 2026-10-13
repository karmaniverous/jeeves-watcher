/**
 * @module sources/SourceClient.test
 * Tests SourceClient against the stub source server: every outcome, segment encoding, rejections without requests, headers, secrets, timeout, concurrency.
 */

import { sourcesConfigSchema } from '@karmaniverous/jeeves-watcher-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  startStubSourceServer,
  type StubResponse,
  type StubSourceServer,
} from '../test/harness/stubSource';
import { SourceClient } from './SourceClient';
import { SourceReferenceError, type SourceRetrievalResult } from './types';

const SECRET = 's3cret-token-value';

let stub: StubSourceServer;

function client(overrides: Record<string, unknown> = {}): SourceClient {
  return new SourceClient(
    sourcesConfigSchema.parse({
      app: {
        url: `${stub.url}/t/{id}`,
        headers: { authorization: `Bearer ${SECRET}`, 'x-tenant': 'app' },
        timeoutMs: 1000,
        ...overrides,
      },
      other: { url: `${stub.url}/o/{id}?v=1` },
    }),
  );
}

async function rejectionOf(
  promise: Promise<unknown>,
): Promise<SourceReferenceError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof SourceReferenceError) return err;
    throw err;
  }
  throw new Error('expected a SourceReferenceError');
}

function expectError(result: SourceRetrievalResult, code: string): string {
  expect(result.kind).toBe('error');
  if (result.kind !== 'error') return '';
  expect(result.code).toBe(code);
  expect(result.message).not.toContain(SECRET);
  expect(result.message).not.toContain(stub.url);
  return result.message;
}

beforeEach(async () => {
  stub = await startStubSourceServer();
});

afterEach(async () => {
  await stub.close();
});

describe('SourceClient outcomes', () => {
  it('returns the JSON object body as a document, sending configured headers', async () => {
    stub.route('/t/chat/thread/1', { body: { userId: 'u1', streaks: [] } });

    const result = await client().retrieve('app://chat/thread/1');

    expect(result).toEqual({
      kind: 'document',
      body: { userId: 'u1', streaks: [] },
    });
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0].method).toBe('GET');
    expect(stub.requests[0].headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(stub.requests[0].headers['x-tenant']).toBe('app');
  });

  it.each(['application/json; charset=utf-8', 'Application/JSON'])(
    'accepts content type %j',
    async (contentType) => {
      stub.route('/t/a', { body: { ok: true }, contentType });
      expect(await client().retrieve('app://a')).toEqual({
        kind: 'document',
        body: { ok: true },
      });
    },
  );

  it('maps 404 to gone', async () => {
    stub.route('/t/gone', { status: 404, body: { error: 'nope' } });
    expect(await client().retrieve('app://gone')).toEqual({ kind: 'gone' });
  });

  it.each<[string, StubResponse]>([
    ['text/markdown', { body: '# hi', contentType: 'text/markdown' }],
    ['text/plain', { body: 'hi', contentType: 'text/plain' }],
    ['no content type', { body: '{}', contentType: '' }],
    ['a JSON array', { body: [1, 2] }],
    ['JSON null', { body: 'null' }],
    ['a JSON string', { body: '"text"' }],
  ])(
    'maps 200 with %s to unsupported_content_type',
    async (_label, response) => {
      stub.route('/t/x', response);
      const message = expectError(
        await client().retrieve('app://x'),
        'unsupported_content_type',
      );
      expect(message).toContain('Source "app" callback');
    },
  );

  it.each<[string, StubResponse]>([
    ['500', { status: 500, body: { error: 'boom' } }],
    ['503', { status: 503, headers: { 'retry-after': '5' } }],
    ['401', { status: 401 }],
    ['403', { status: 403 }],
    ['429', { status: 429 }],
    ['204', { status: 204 }],
    ['invalid JSON', { body: '{not json' }],
  ])('maps %s to source_unavailable', async (_label, response) => {
    stub.route('/t/x', response);
    const message = expectError(
      await client().retrieve('app://x'),
      'source_unavailable',
    );
    expect(message).toContain('Source "app" callback');
  });

  it('does not follow redirects', async () => {
    stub.route('/t/x', { status: 302, headers: { location: '/elsewhere' } });
    stub.route('/elsewhere', { body: { leaked: true } });

    const message = expectError(
      await client().retrieve('app://x'),
      'source_unavailable',
    );

    expect(message).toContain('302');
    expect(stub.requests.map((r) => r.path)).toEqual(['/t/x']);
  });

  it('maps a timeout to source_unavailable', async () => {
    stub.route('/t/slow', { delayMs: 2000, body: {} });
    const message = expectError(
      await client({ timeoutMs: 100 }).retrieve('app://slow'),
      'source_unavailable',
    );
    expect(message).toContain('timed out after 100 ms');
  });

  it('maps a network error to source_unavailable', async () => {
    const sources = client();
    await stub.close();
    const message = expectError(
      await sources.retrieve('app://x'),
      'source_unavailable',
    );
    expect(message).toMatch(/network error/);
    stub = await startStubSourceServer();
  });
});

describe('SourceClient URL building', () => {
  it('encodes each segment and keeps slashes', async () => {
    const raw = '/t/caf%C3%A9/%F0%9F%98%80/100%25/q%3Fx%3D1/f%23y/%252e%252e';
    stub.route(raw, { body: { ok: 1 } });

    const ref = 'app://caf\u00e9/\u{1F600}/100%/q?x=1/f#y/%2e%2e';
    const result = await client().retrieve(ref);

    expect(result).toEqual({ kind: 'document', body: { ok: 1 } });
    expect(stub.requests[0].path).toBe(raw);
  });

  it('keeps the template suffix and resolves without requesting', () => {
    expect(client().resolve('other://a/b%20c')).toEqual({
      ref: 'other://a/b%20c',
      name: 'other',
      id: 'a/b%20c',
      url: `${stub.url}/o/a/b%2520c?v=1`,
    });
    expect(stub.requests).toHaveLength(0);
  });

  it.each([
    ['nope://x', 'unknown_source'],
    ['app://a b', 'invalid_reference'],
    ['app:x', 'invalid_reference'],
    ['app://../admin', 'invalid_id'],
    ['app://a/../../admin', 'invalid_id'],
    ['app://a//b', 'invalid_id'],
    ['app://a/', 'invalid_id'],
    ['app://./a', 'invalid_id'],
  ])('rejects %j as %s without a request', async (ref, code) => {
    const sources = client();
    expect((await rejectionOf(sources.retrieve(ref))).code).toBe(code);
    expect(() => sources.resolve(ref)).toThrow(SourceReferenceError);
    expect(stub.requests).toHaveLength(0);
  });

  it('resolves only configured names', () => {
    expect(client().resolve('app://x').name).toBe('app');
    expect(() => client().resolve('nope://x')).toThrow(SourceReferenceError);
    expect(() => new SourceClient().resolve('app://x')).toThrow(
      SourceReferenceError,
    );
  });

  it('rejects templates with {id} in the origin or a non-http scheme', () => {
    const make = (url: string) => () =>
      new SourceClient(sourcesConfigSchema.parse({ app: { url } }));
    expect(make('http://{id}.example.com/')).toThrow(/sources\.app\.url/);
    expect(make('file:///data/{id}')).toThrow(/sources\.app\.url/);
  });
});

describe('SourceClient concurrency', () => {
  it('caps parallel callbacks per source', async () => {
    stub.route('/t/x', { delayMs: 150, body: { ok: true } });
    stub.route('/o/y', { body: { ok: true } });
    const sources = client({ concurrency: 2 });

    const pending = Array.from({ length: 5 }, () =>
      sources.retrieve('app://x'),
    );
    await new Promise((resolve) => setTimeout(resolve, 75));

    expect(stub.requests).toHaveLength(2);
    // Another source has its own limit and is not blocked.
    expect((await sources.retrieve('other://y')).kind).toBe('document');

    const results = await Promise.all(pending);
    expect(results.every((r) => r.kind === 'document')).toBe(true);
    expect(stub.requests.filter((r) => r.path === '/t/x')).toHaveLength(5);
  });

  it('defaults to 8 parallel callbacks', async () => {
    stub.route('/t/x', { delayMs: 150, body: {} });
    const sources = client();

    const pending = Array.from({ length: 10 }, () =>
      sources.retrieve('app://x'),
    );
    await new Promise((resolve) => setTimeout(resolve, 75));

    expect(stub.requests).toHaveLength(8);
    await Promise.all(pending);
  });

  it('starts the timeout when a request leaves the queue', async () => {
    stub.route('/t/x', { delayMs: 120, body: {} });
    const sources = client({ concurrency: 1, timeoutMs: 400 });

    const results = await Promise.all(
      Array.from({ length: 4 }, () => sources.retrieve('app://x')),
    );

    expect(results.map((r) => r.kind)).toEqual([
      'document',
      'document',
      'document',
      'document',
    ]);
  });
});
