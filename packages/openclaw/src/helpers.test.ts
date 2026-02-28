import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchJson,
  getPluginSchemas,
  type PluginApi,
  postJson,
} from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchJson', () => {
  it('returns parsed JSON on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hello: 'world' }),
      }),
    );
    const result = await fetchJson('http://example.com/api');
    expect(result).toEqual({ hello: 'world' });
  });

  it('throws on non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      }),
    );
    await expect(fetchJson('http://example.com/api')).rejects.toThrow(
      'HTTP 500: Internal Server Error',
    );
  });
});

describe('getPluginSchemas', () => {
  it('returns empty object when no schemas config', () => {
    const api: PluginApi = { registerTool: () => {} };
    expect(getPluginSchemas(api)).toEqual({});
  });

  it('normalizes single object to array', () => {
    const schema = {
      type: 'object',
      properties: { domains: { set: ['memory'] } },
    };
    const api: PluginApi = {
      config: {
        plugins: {
          entries: {
            'jeeves-watcher-openclaw': {
              config: { schemas: { 'openclaw-memory-longterm': schema } },
            },
          },
        },
      },
      registerTool: () => {},
    };
    const result = getPluginSchemas(api);
    expect(result['openclaw-memory-longterm']).toEqual([schema]);
  });

  it('passes arrays through', () => {
    const schemas = [{ type: 'object' }, { type: 'object' }];
    const api: PluginApi = {
      config: {
        plugins: {
          entries: {
            'jeeves-watcher-openclaw': {
              config: { schemas: { 'openclaw-memory-daily': schemas } },
            },
          },
        },
      },
      registerTool: () => {},
    };
    const result = getPluginSchemas(api);
    expect(result['openclaw-memory-daily']).toHaveLength(2);
  });

  it('normalizes string references to array', () => {
    const api: PluginApi = {
      config: {
        plugins: {
          entries: {
            'jeeves-watcher-openclaw': {
              config: {
                schemas: { 'openclaw-memory-longterm': 'my-named-schema' },
              },
            },
          },
        },
      },
      registerTool: () => {},
    };
    const result = getPluginSchemas(api);
    expect(result['openclaw-memory-longterm']).toEqual(['my-named-schema']);
  });
});

describe('postJson', () => {
  it('sends POST with JSON content-type and stringified body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await postJson('http://example.com/api', { key: 'value' });
    expect(result).toEqual({ ok: true });

    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('http://example.com/api');
    expect(call[1].method).toBe('POST');
    expect((call[1].headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
    expect(JSON.parse(call[1].body as string)).toEqual({ key: 'value' });
  });
});
