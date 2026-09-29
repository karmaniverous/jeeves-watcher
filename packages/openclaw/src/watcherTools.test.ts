import { afterEach, describe, expect, it, vi } from 'vitest';

import { BASE, captureTools, mockFetch, run } from './toolTestHarness.js';

/** Tools that must stay model-visible under OpenClaw Tool Search. */
const DIRECT_ONLY = ['watcher_search', 'watcher_scan'];

/** Stopgap for openclaw/openclaw#161022: steer models away from tool_call. */
const DIRECT_NOTE =
  'This is a direct tool: call it directly, never through tool_call.';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registerWatcherTools', () => {
  it('registers exactly 14 domain-specific watcher tools', () => {
    expect([...captureTools().keys()]).toEqual([
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
    const options = [...captureTools().values()].map((t) => t.options);
    expect(options.every((o) => o?.optional === true)).toBe(true);
  });

  it.each(DIRECT_ONLY)(
    "registers %s with catalogMode 'direct-only'",
    (name) => {
      expect(captureTools().get(name)?.tool.catalogMode).toBe('direct-only');
    },
  );

  it.each(DIRECT_ONLY)('tells models to call %s directly', (name) => {
    expect(captureTools().get(name)?.tool.description).toContain(DIRECT_NOTE);
  });

  it('registers every other tool without catalogMode or direct note', () => {
    const others = [...captureTools().values()].filter(
      ({ tool }) => !DIRECT_ONLY.includes(tool.name),
    );
    expect(others).toHaveLength(12);
    for (const { tool } of others) {
      expect(tool).not.toHaveProperty('catalogMode');
      expect(tool.description).not.toContain(DIRECT_NOTE);
    }
  });
});

describe('tool execution', () => {
  it('watcher_issues calls GET /issues', async () => {
    const fetchMock = mockFetch([]);
    vi.stubGlobal('fetch', fetchMock);
    await run(captureTools(), 'watcher_issues', {});
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/issues`, undefined);
  });

  it('watcher_search POSTs query/limit/offset/filter', async () => {
    const fetchMock = mockFetch([]);
    vi.stubGlobal('fetch', fetchMock);
    const params = {
      query: 'hello',
      limit: 5,
      offset: 10,
      filter: { must: [] },
    };
    await run(captureTools(), 'watcher_search', params);
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe(`${BASE}/search`);
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body).toEqual(params);
  });

  it('watcher_search omits undefined optional params', async () => {
    const fetchMock = mockFetch([]);
    vi.stubGlobal('fetch', fetchMock);
    await run(captureTools(), 'watcher_search', { query: 'test' });
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body).toEqual({ query: 'test' });
    expect(body).not.toHaveProperty('limit');
  });

  it('watcher_scan POSTs filter/limit/cursor/fields/countOnly', async () => {
    const fetchMock = mockFetch({ points: [] });
    vi.stubGlobal('fetch', fetchMock);
    const params = {
      filter: { must: [] },
      limit: 50,
      cursor: 'abc',
      fields: ['file_path'],
      countOnly: false,
    };
    await run(captureTools(), 'watcher_scan', params);
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe(`${BASE}/scan`);
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body).toEqual(params);
  });

  it('watcher_enrich POSTs path and metadata', async () => {
    const fetchMock = mockFetch({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await run(captureTools(), 'watcher_enrich', {
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
    await run(captureTools(), 'watcher_validate', {
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
    await run(captureTools(), 'watcher_reindex', {});
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe(`${BASE}/reindex`);
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body).toEqual({ scope: 'rules' });
  });

  it('watcher_reindex forwards explicit scope', async () => {
    const fetchMock = mockFetch({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await run(captureTools(), 'watcher_reindex', { scope: 'full' });
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
    await run(captureTools(), 'watcher_walk', {
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
    const result = await run(captureTools(), 'watcher_issues', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not reachable');
  });
});
