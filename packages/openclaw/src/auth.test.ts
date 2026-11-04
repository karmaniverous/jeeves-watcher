/**
 * @module plugin/auth.test
 * Plugin-level bearer-key tests through the real entry point: every HTTP tool (all catalog-built) sends the key when configured and none when unset; the key never reaches logs or tool results.
 */

import type { PluginApi, ToolDescriptor } from '@karmaniverous/jeeves';
import { afterEach, describe, expect, it, vi } from 'vitest';

import register from './index.js';

const KEY = 'plugin-auth-secret';

/** Tools that make no HTTP call (watcher_service) or hit the open GET /status. */
const NOT_AUTHENTICATED = new Set(['watcher_service', 'watcher_status']);

/**
 * Valid params per tool. Every parameter schema is closed: an unknown
 * parameter fails before any request. Tools absent here take none.
 */
const PARAMS: Partial<Record<string, Record<string, unknown>>> = {
  watcher_config_apply: { config: { x: 1 } },
  watcher_search: { query: 'q' },
  watcher_set_metadata: { path: 'a.md', metadata: { k: 'v' } },
  watcher_scan: { filter: {} },
  watcher_walk: { globs: ['**/*.md'] },
  watcher_list_vcs_history: { glob: '*.md' },
  watcher_show_vcs_file: { path: 'a.md', commit: 'abc' },
  watcher_diff_vcs: { glob: '*.md', commit: 'abc' },
  watcher_revert_vcs: { glob: '*.md', commit: 'abc' },
  watcher_exclude_vcs_path: { glob: '*.md' },
  watcher_check_vcs_exclusion: { path: 'a.md' },
};

const paramsFor = (name: string) => PARAMS[name] ?? {};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function setUp(overrides: Partial<PluginApi> = {}) {
  const tools = new Map<string, ToolDescriptor>();
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
  register({
    registerTool: (tool) => {
      tools.set(tool.name, tool);
    },
    logger,
    ...overrides,
  });
  return { tools, logger };
}

function stubFetch(status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status === 200,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve('{"error":"Unauthorized"}'),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Authorization header (any case) of every fetch call, in order. */
function authHeaders(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.map(([, init]) => {
    const headers = (init as RequestInit | undefined)?.headers;
    return Object.entries(
      (headers as Record<string, string> | undefined) ?? {},
    ).find(([name]) => name.toLowerCase() === 'authorization')?.[1];
  });
}

const httpTools = (tools: Map<string, ToolDescriptor>) =>
  [...tools.values()].filter((tool) => !NOT_AUTHENTICATED.has(tool.name));

describe('plugin bearer key', () => {
  it('sends the plugin-config key from every authenticated HTTP tool', async () => {
    const fetchMock = stubFetch();
    const { tools } = setUp({ pluginConfig: { apiKey: KEY } });
    const list = httpTools(tools);
    expect(list.map((tool) => tool.name)).toContain('watcher_config');
    expect(list.map((tool) => tool.name)).toContain('watcher_config_apply');
    for (const tool of list) await tool.execute('1', paramsFor(tool.name));
    expect(fetchMock).toHaveBeenCalledTimes(list.length);
    expect(authHeaders(fetchMock)).toEqual(list.map(() => `Bearer ${KEY}`));
  });

  it('sends no key from watcher_status, even when one is configured', async () => {
    const fetchMock = stubFetch();
    const { tools } = setUp({ pluginConfig: { apiKey: KEY } });
    await tools.get('watcher_status')!.execute('1', {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authHeaders(fetchMock)).toEqual([undefined]);
  });
  it('falls back to JEEVES_WATCHER_API_KEY, resolved per call', async () => {
    const fetchMock = stubFetch();
    const { tools } = setUp();
    vi.stubEnv('JEEVES_WATCHER_API_KEY', KEY);
    await tools.get('watcher_search')!.execute('1', { query: 'q' });
    expect(authHeaders(fetchMock)).toEqual([`Bearer ${KEY}`]);
  });

  it('sends no Authorization header when no key is set', async () => {
    const fetchMock = stubFetch();
    const { tools } = setUp();
    const list = httpTools(tools);
    for (const tool of list) await tool.execute('1', paramsFor(tool.name));
    expect(fetchMock).toHaveBeenCalledTimes(list.length);
    expect(authHeaders(fetchMock).every((h) => h === undefined)).toBe(true);
  });

  it('keeps watcher_config_apply semantics: missing config fails', async () => {
    stubFetch();
    const { tools } = setUp();
    const result = await tools.get('watcher_config_apply')!.execute('1', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(
      'Missing required parameter: config',
    );
  });

  // Every tool reports core's `HTTP <status>: <body>`; the key guidance is in
  // the skill's troubleshooting section (spec #281 D31).
  it.each([
    ['watcher_set_metadata', 'HTTP 401: {"error":"Unauthorized"}'],
    ['watcher_config', 'HTTP 401: {"error":"Unauthorized"}'],
  ])(
    '%s: a 401 is an error that never logs or returns the key',
    async (name, text) => {
      stubFetch(401);
      const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map(
        (level) => vi.spyOn(console, level).mockImplementation(() => {}),
      );
      const { tools, logger } = setUp({ pluginConfig: { apiKey: KEY } });
      const result = await tools.get(name)!.execute('1', paramsFor(name));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(text);

      const logged = JSON.stringify([
        ...spies.map((spy) => spy.mock.calls),
        ...Object.values(logger).map((fn) => fn.mock.calls),
        result,
      ]);
      expect(logged).not.toContain(KEY);
    },
  );
});
