/**
 * @module plugin/http.test
 * Unit tests for the plugin HTTP helper: bearer header presence/absence, unchanged unauthenticated request shape, 401 guidance naming the plugin key sources without the key, other errors carrying the server code.
 */

import { unauthorizedMessage } from '@karmaniverous/jeeves-watcher-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PLUGIN_KEY_SOURCES, requestJson } from './http.js';

const KEY = 'plugin-unit-secret';
const URL_ = 'http://localhost:1936/issues';

type FetchArgs = [string, RequestInit | undefined];
const fetchMock = vi.fn<(...args: FetchArgs) => Promise<unknown>>();

function respond(status: number, data: unknown = {}): void {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    text: () =>
      Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
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
      headers: { Authorization: 'Bearer ' + KEY },
    });
  });

  it('sends Authorization and Content-Type on POST when a key is set', async () => {
    respond(200);
    await requestJson(URL_, { a: 1 }, KEY);
    expect(fetchMock).toHaveBeenCalledWith(URL_, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + KEY,
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
    respond(401, { code: 'unauthorized', error: 'Unauthorized' });
    await expect(requestJson(URL_, undefined, undefined)).rejects.toThrow(
      unauthorizedMessage(false, PLUGIN_KEY_SOURCES),
    );
    expect(PLUGIN_KEY_SOURCES).toContain(
      'plugins.entries.jeeves-watcher-openclaw.config.apiKey',
    );
    expect(PLUGIN_KEY_SOURCES).toContain('JEEVES_WATCHER_API_KEY');
  });

  it('reports a rejected key on 401 without echoing it', async () => {
    respond(401, { code: 'unauthorized', error: 'Unauthorized' });
    const error = await requestJson(URL_, undefined, KEY).catch(
      (err: unknown) => err as Error,
    );
    expect((error as Error).message).toBe(
      unauthorizedMessage(true, PLUGIN_KEY_SOURCES),
    );
    expect((error as Error).message).not.toContain(KEY);
  });

  it.each([
    [
      503,
      { code: 'embedding_unavailable', error: 'Busy', message: 'retry' },
      'HTTP 503 embedding_unavailable: Busy: retry',
    ],
    [
      404,
      { code: 'not_found', error: 'Not Found' },
      'HTTP 404 not_found: Not Found',
    ],
    [502, 'Bad Gateway', 'HTTP 502 http_502: HTTP 502'],
  ])(
    'maps a %i to HTTP <status> <code>: <message>',
    async (status, body, text) => {
      respond(status, body);
      await expect(requestJson(URL_, undefined, undefined)).rejects.toThrow(
        text,
      );
    },
  );
});
