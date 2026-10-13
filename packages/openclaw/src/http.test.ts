/**
 * @module plugin/http.test
 * Unit tests for the plugin HTTP helper: bearer header presence/absence, unchanged unauthenticated request shape, 401 guidance without the key.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requestJson, unauthorizedMessage } from './http.js';

const KEY = 'plugin-unit-secret';
const URL_ = 'http://localhost:1936/issues';

type FetchArgs = [string, RequestInit | undefined];
const fetchMock = vi.fn<(...args: FetchArgs) => Promise<unknown>>();

function respond(status: number, data: unknown = {}): void {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(data),
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestJson', () => {
  it('sends Authorization: Bearer <key> on GET when a key is set', async () => {
    respond(200, { ok: 1 });
    await expect(requestJson(URL_, undefined, KEY)).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledWith(URL_, {
      headers: { Authorization: `Bearer ${KEY}` },
    });
  });

  it('sends Authorization and Content-Type on POST when a key is set', async () => {
    respond(200);
    await requestJson(URL_, { a: 1 }, KEY);
    expect(fetchMock).toHaveBeenCalledWith(URL_, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${KEY}`,
      },
      body: '{"a":1}',
    });
  });

  it('sends exactly the pre-auth requests when no key is set', async () => {
    respond(200);
    await requestJson(URL_, undefined, undefined);
    expect(fetchMock).toHaveBeenLastCalledWith(URL_, undefined);
    await requestJson(URL_, { a: 1 }, undefined);
    expect(fetchMock).toHaveBeenLastCalledWith(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });
  });

  it('explains how to configure the key on 401 without one', async () => {
    respond(401, { error: 'Unauthorized' });
    await expect(requestJson(URL_, undefined, undefined)).rejects.toThrow(
      unauthorizedMessage(false),
    );
    expect(unauthorizedMessage(false)).toContain(
      'plugins.entries.jeeves-watcher-openclaw.config.apiKey',
    );
    expect(unauthorizedMessage(false)).toContain('JEEVES_WATCHER_API_KEY');
  });

  it('reports a rejected key on 401 without echoing it', async () => {
    respond(401, { error: 'Unauthorized' });
    const error = await requestJson(URL_, undefined, KEY).catch(
      (err: unknown) => err as Error,
    );
    expect((error as Error).message).toBe(unauthorizedMessage(true));
    expect((error as Error).message).not.toContain(KEY);
  });

  it('maps other non-OK statuses to HTTP <status>: <body>', async () => {
    respond(503, { error: 'busy' });
    await expect(requestJson(URL_, undefined, undefined)).rejects.toThrow(
      'HTTP 503: {"error":"busy"}',
    );
  });
});
