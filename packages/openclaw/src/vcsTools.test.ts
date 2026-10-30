import { afterEach, describe, expect, it, vi } from 'vitest';

import { BASE, captureTools, mockFetch, run } from './toolTestHarness.js';
import { vcsToolConfigs } from './vcsTools.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('vcsToolConfigs', () => {
  it('lists the 7 catalog-eligible watcher_vcs_* tools, watcher_vcs_show by name', () => {
    const name = (c: (typeof vcsToolConfigs)[number]) =>
      typeof c === 'string' ? c : c.name;
    expect(vcsToolConfigs.map(name)).toEqual([
      'watcher_vcs_status',
      'watcher_vcs_history',
      'watcher_vcs_show',
      'watcher_vcs_diff',
      'watcher_vcs_revert',
      'watcher_vcs_exclude',
      'watcher_vcs_check',
    ]);
    expect(vcsToolConfigs[2]).toBe('watcher_vcs_show');
    const tools = captureTools();
    for (const c of vcsToolConfigs)
      expect(tools.get(name(c))?.tool.catalogMode).toBeUndefined();
  });
});

describe('VCS tool execution', () => {
  it('watcher_vcs_status calls GET /vcs/status', async () => {
    const fetchMock = mockFetch({ enabled: true });
    vi.stubGlobal('fetch', fetchMock);
    await run(captureTools(), 'watcher_vcs_status', {});
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/vcs/status`, undefined);
  });

  it('watcher_vcs_history builds query string with all params', async () => {
    const fetchMock = mockFetch([]);
    vi.stubGlobal('fetch', fetchMock);
    await run(captureTools(), 'watcher_vcs_history', {
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
    await run(captureTools(), 'watcher_vcs_history', { glob: 'src/**' });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/vcs/history?glob=src%2F**`,
      undefined,
    );
  });

  it('watcher_vcs_show GETs /vcs/show and returns the file text (non-JSON)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/markdown' }),
      text: () => Promise.resolve('# Not JSON\n'),
      json: () => Promise.reject(new SyntaxError('Unexpected token #')),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await run(captureTools(), 'watcher_vcs_show', {
      path: 'docs/foo.md',
      commit: 'abc123',
    });
    const [url, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
    expect(String(url)).toBe(
      `${BASE}/vcs/show?path=docs%2Ffoo.md&commit=abc123`,
    );
    expect(init.method ?? 'GET').toBe('GET');
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('# Not JSON');
  });

  it('watcher_vcs_show rejects a missing commit before any request', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    const result = await run(captureTools(), 'watcher_vcs_show', {
      path: 'foo.md',
    });
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('watcher_vcs_diff builds query string with optional commitEnd', async () => {
    const fetchMock = mockFetch({ diff: '' });
    vi.stubGlobal('fetch', fetchMock);
    await run(captureTools(), 'watcher_vcs_diff', {
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
    await run(captureTools(), 'watcher_vcs_diff', {
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
    await run(captureTools(), 'watcher_vcs_revert', {
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
    await run(captureTools(), 'watcher_vcs_exclude', {
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
    await run(captureTools(), 'watcher_vcs_check', { path: 'src/index.ts' });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/vcs/check-exclusion?path=src%2Findex.ts`,
      undefined,
    );
  });
});
