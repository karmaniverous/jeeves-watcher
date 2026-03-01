import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PluginApi, ToolResult } from './helpers.js';
import { registerWatcherTools } from './watcherTools.js';

const BASE = 'http://localhost:1936';

function mockFetch(data: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

type ExecuteFn = (
  id: string,
  params: Record<string, unknown>,
) => Promise<ToolResult>;

/** Capture all tool executors by name. */
function captureTools(baseUrl = BASE) {
  const executors = new Map<string, ExecuteFn>();
  const api: PluginApi = {
    registerTool: (tool: { name: string; execute: ExecuteFn }) => {
      executors.set(tool.name, tool.execute);
    },
  };
  registerWatcherTools(api, baseUrl);
  return executors;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registerWatcherTools', () => {
  it('registers exactly 8 watcher tools', () => {
    const tools: string[] = [];
    const api: PluginApi = {
      registerTool: (tool: { name: string }) => {
        tools.push(tool.name);
      },
    };
    registerWatcherTools(api, BASE);
    expect(tools).toEqual([
      'watcher_status',
      'watcher_search',
      'watcher_enrich',
      'watcher_query',
      'watcher_validate',
      'watcher_config_apply',
      'watcher_reindex',
      'watcher_issues',
    ]);
  });

  it('registers all tools as optional', () => {
    const options: Array<{ optional?: boolean }> = [];
    const api: PluginApi = {
      registerTool: (
        _tool: { name: string },
        opts?: { optional?: boolean },
      ) => {
        options.push(opts ?? {});
      },
    };
    registerWatcherTools(api, BASE);
    expect(options.every((o) => o.optional === true)).toBe(true);
  });
});

describe('tool execution', () => {
  it('watcher_status calls GET /status', async () => {
    const fetchMock = mockFetch({ status: 'ok' });
    vi.stubGlobal('fetch', fetchMock);
    const tools = captureTools();
    await tools.get('watcher_status')!('id', {});
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/status`, undefined);
  });

  it('watcher_issues calls GET /issues', async () => {
    const fetchMock = mockFetch([]);
    vi.stubGlobal('fetch', fetchMock);
    const tools = captureTools();
    await tools.get('watcher_issues')!('id', {});
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/issues`, undefined);
  });

  it('watcher_search POSTs query/limit/offset/filter', async () => {
    const fetchMock = mockFetch([]);
    vi.stubGlobal('fetch', fetchMock);
    const tools = captureTools();
    const params = {
      query: 'hello',
      limit: 5,
      offset: 10,
      filter: { must: [] },
    };
    await tools.get('watcher_search')!('id', params);
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe(`${BASE}/search`);
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body).toEqual(params);
  });

  it('watcher_search omits undefined optional params', async () => {
    const fetchMock = mockFetch([]);
    vi.stubGlobal('fetch', fetchMock);
    const tools = captureTools();
    await tools.get('watcher_search')!('id', { query: 'test' });
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body).toEqual({ query: 'test' });
    expect(body).not.toHaveProperty('limit');
  });

  it('watcher_enrich POSTs path and metadata', async () => {
    const fetchMock = mockFetch({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const tools = captureTools();
    await tools.get('watcher_enrich')!('id', {
      path: 'foo.md',
      metadata: { tag: 'x' },
    });
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe(`${BASE}/metadata`);
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body).toEqual({ path: 'foo.md', metadata: { tag: 'x' } });
  });

  it('watcher_query POSTs path and optional resolve', async () => {
    const fetchMock = mockFetch({ result: [] });
    vi.stubGlobal('fetch', fetchMock);
    const tools = captureTools();
    await tools.get('watcher_query')!('id', {
      path: '$.foo',
      resolve: ['files'],
    });
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe(`${BASE}/config/query`);
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body).toEqual({ path: '$.foo', resolve: ['files'] });
  });

  it('watcher_validate POSTs config and testPaths', async () => {
    const fetchMock = mockFetch({ valid: true });
    vi.stubGlobal('fetch', fetchMock);
    const tools = captureTools();
    await tools.get('watcher_validate')!('id', {
      config: { rules: [] },
      testPaths: ['a.md'],
    });
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe(`${BASE}/config/validate`);
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body).toEqual({ config: { rules: [] }, testPaths: ['a.md'] });
  });

  it('watcher_config_apply POSTs config', async () => {
    const fetchMock = mockFetch({ applied: true });
    vi.stubGlobal('fetch', fetchMock);
    const tools = captureTools();
    await tools.get('watcher_config_apply')!('id', { config: { x: 1 } });
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe(`${BASE}/config/apply`);
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body).toEqual({ config: { x: 1 } });
  });

  it('watcher_reindex POSTs scope defaulting to rules', async () => {
    const fetchMock = mockFetch({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const tools = captureTools();
    await tools.get('watcher_reindex')!('id', {});
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe(`${BASE}/config-reindex`);
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body).toEqual({ scope: 'rules' });
  });

  it('watcher_reindex forwards explicit scope', async () => {
    const fetchMock = mockFetch({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const tools = captureTools();
    await tools.get('watcher_reindex')!('id', { scope: 'full' });
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body).toEqual({ scope: 'full' });
  });

  it('returns connectionFail on ECONNREFUSED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(
        Object.assign(new Error('fail'), {
          cause: { code: 'ECONNREFUSED' },
        }),
      ),
    );
    const tools = captureTools();
    const result = await tools.get('watcher_status')!('id', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not reachable');
  });
});
