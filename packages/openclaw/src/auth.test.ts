/**
 * @module plugin/auth.test
 * Plugin-level bearer-key tests through the real entry point: every HTTP tool (the catalog-built ones and the plugin's own) sends the key when configured and none when unset; the key never reaches logs or tool results.
 */

import type { PluginApi, ToolDescriptor } from '@karmaniverous/jeeves';
import { unauthorizedMessage } from '@karmaniverous/jeeves-watcher-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PLUGIN_KEY_SOURCES } from './http.js';
import register from './index.js';

const KEY = 'plugin-auth-secret';

/** Tools that make no HTTP call (watcher_service) or hit the open GET /status. */
const NOT_AUTHENTICATED = new Set(['watcher_service', 'watcher_status']);

/** Params that make every plugin-built HTTP tool issue its request. */
const PARAMS: Record<string, unknown> = {
  config: { x: 1 },
  query: 'q',
  path: 'a.md',
  metadata: { k: 'v' },
  filter: {},
  globs: ['**/*.md'],
  commit: 'abc',
  glob: '*.md',
  paths: ['a.md'],
};

/**
 * Valid params for the catalog-built tools, whose parameter schemas are
 * closed: an unknown parameter fails before any request.
 */
const CATALOG_PARAMS: Partial<Record<string, Record<string, unknown>>> = {
  watcher_config: {},
  watcher_config_apply: { config: { x: 1 } },
  watcher_search: { query: 'q' },
  watcher_scan: { filter: {} },
  watcher_vcs_show: { path: 'a.md', commit: 'abc' },
};

const paramsFor = (name: string) => CATALOG_PARAMS[name] ?? PARAMS;

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

  it.each([
    // Plugin-built tools add key guidance to a 401.
    ['watcher_enrich', unauthorizedMessage(true, PLUGIN_KEY_SOURCES)],
    // Catalog-built tools report core's `HTTP <status>: <body>`; the guidance
    // is in the skill's troubleshooting section (spec #281 D31).
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
