import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchJson, postJson } from './helpers.js';

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
