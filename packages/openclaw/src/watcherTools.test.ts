import type { PluginApi, ToolResult } from '@karmaniverous/jeeves';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  it('registers exactly 14 domain-specific watcher tools', () => {
    const tools: string[] = [];
    const api: PluginApi = {
      registerTool: (tool: { name: string }) => {
        tools.push(tool.name);
      },
    };
    registerWatcherTools(api, BASE);
    expect(tools).toEqual([
      'watcher_search',
      'watcher_enrich',
      'watcher_validate',
      'watcher_reindex',
      'watcher_scan',
      'watcher_issues',
      'watcher_walk',
      'watcher_vcs_status',
      'watcher_vcs_history',
      'watcher_vcs_show',
      'watcher_vcs_diff',
      'watcher_vcs_revert',
      'watcher_vcs_exclude',
      'watcher_vcs_check',
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

  it('watcher_reindex POSTs scope defaulting to rules', async () => {
    const fetchMock = mockFetch({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const tools = captureTools();
    await tools.get('watcher_reindex')!('id', {});
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe(`${BASE}/reindex`);
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

  it('watcher_walk POSTs globs', async () => {
    const fetchMock = mockFetch({
      paths: ['j:/domains/foo/bar.md'],
      matchedCount: 1,
      scannedRoots: ['j:/domains'],
    });
    vi.stubGlobal('fetch', fetchMock);
    const tools = captureTools();
    await tools.get('watcher_walk')!('id', {
      globs: ['**/.meta/meta.json'],
    });
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe(`${BASE}/walk`);
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body).toEqual({ globs: ['**/.meta/meta.json'] });
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
    const result = await tools.get('watcher_issues')!('id', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not reachable');
  });
});

describe('VCS tool execution', () => {
  it('watcher_vcs_status calls GET /vcs/status', async () => {
    const fetchMock = mockFetch({ enabled: true });
    vi.stubGlobal('fetch', fetchMock);
    const tools = captureTools();
    await tools.get('watcher_vcs_status')!('id', {});
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/vcs/status`, undefined);
  });

  it('watcher_vcs_history builds query string with all params', async () => {
    const fetchMock = mockFetch([]);
    vi.stubGlobal('fetch', fetchMock);
    const tools = captureTools();
    await tools.get('watcher_vcs_history')!('id', {
      glob: '*.md',
      since: '2024-01-01',
      until: '2024-12-31',
      limit: 10,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/vcs/history?glob=*.md&since=2024-01-01&until=2024-12-31&limit=10`,
      undefined,
    );
  });

  it('watcher_vcs_history omits undefined optional params', async () => {
    const fetchMock = mockFetch([]);
    vi.stubGlobal('fetch', fetchMock);
    const tools = captureTools();
    await tools.get('watcher_vcs_history')!('id', { glob: 'src/**' });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/vcs/history?glob=src%2F**`,
      undefined,
    );
  });

  it('watcher_vcs_show builds query string', async () => {
    const fetchMock = mockFetch({ content: 'hello' });
    vi.stubGlobal('fetch', fetchMock);
    const tools = captureTools();
    await tools.get('watcher_vcs_show')!('id', {
      path: 'foo.md',
      commit: 'abc123',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/vcs/show?path=foo.md&commit=abc123`,
      undefined,
    );
  });

  it('watcher_vcs_diff builds query string with optional commitEnd', async () => {
    const fetchMock = mockFetch({ diff: '' });
    vi.stubGlobal('fetch', fetchMock);
    const tools = captureTools();
    await tools.get('watcher_vcs_diff')!('id', {
      glob: '*.ts',
      commit: 'abc',
      commitEnd: 'def',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/vcs/diff?glob=*.ts&commit=abc&commitEnd=def`,
      undefined,
    );
  });

  it('watcher_vcs_diff omits commitEnd when not provided', async () => {
    const fetchMock = mockFetch({ diff: '' });
    vi.stubGlobal('fetch', fetchMock);
    const tools = captureTools();
    await tools.get('watcher_vcs_diff')!('id', {
      glob: '*.ts',
      commit: 'abc',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/vcs/diff?glob=*.ts&commit=abc`,
      undefined,
    );
  });

  it('watcher_vcs_revert POSTs glob, commit, existingOnly', async () => {
    const fetchMock = mockFetch({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const tools = captureTools();
    await tools.get('watcher_vcs_revert')!('id', {
      glob: 'src/**',
      commit: 'abc',
      existingOnly: true,
    });
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe(`${BASE}/vcs/revert`);
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body).toEqual({ glob: 'src/**', commit: 'abc', existingOnly: true });
  });

  it('watcher_vcs_exclude POSTs glob with optional root and remove', async () => {
    const fetchMock = mockFetch({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const tools = captureTools();
    await tools.get('watcher_vcs_exclude')!('id', {
      glob: '*.log',
      remove: true,
    });
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe(`${BASE}/vcs/exclude`);
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body).toEqual({ glob: '*.log', remove: true });
    expect(body).not.toHaveProperty('root');
  });

  it('watcher_vcs_check builds query string', async () => {
    const fetchMock = mockFetch({ excluded: false });
    vi.stubGlobal('fetch', fetchMock);
    const tools = captureTools();
    await tools.get('watcher_vcs_check')!('id', { path: 'src/index.ts' });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/vcs/check-exclusion?path=src%2Findex.ts`,
      undefined,
    );
  });
});
