/**
 * @module plugin/auth.test
 * Plugin-level bearer-key tests through the real entry point: every HTTP tool sends the key when configured and none when unset; the key never reaches logs or tool results.
 */

import type { PluginApi, ToolDescriptor } from '@karmaniverous/jeeves';
import { unauthorizedMessage } from '@karmaniverous/jeeves-watcher-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PLUGIN_KEY_SOURCES } from './http.js';
import register from './index.js';

const KEY = 'plugin-auth-secret';

/** Tools that make no HTTP call (watcher_service) or hit the open GET /status. */
const NOT_AUTHENTICATED = new Set(['watcher_service', 'watcher_status']);

/** Params that make every HTTP tool issue its request. */
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

/** Authorization header of every fetch call, in order. */
function authHeaders(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.map(([, init]) => {
    const headers = (init as RequestInit | undefined)?.headers;
    return (headers as Record<string, string> | undefined)?.Authorization;
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
    for (const tool of list) await tool.execute('1', PARAMS);
    expect(fetchMock).toHaveBeenCalledTimes(list.length);
    expect(authHeaders(fetchMock)).toEqual(list.map(() => `Bearer ${KEY}`));
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
    for (const tool of httpTools(tools)) await tool.execute('1', PARAMS);
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

  it('returns 401 guidance and never logs or returns the key', async () => {
    stubFetch(401);
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map(
      (level) => vi.spyOn(console, level).mockImplementation(() => {}),
    );
    const { tools, logger } = setUp({ pluginConfig: { apiKey: KEY } });
    const result = await tools.get('watcher_config')!.execute('1', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(
      unauthorizedMessage(true, PLUGIN_KEY_SOURCES),
    );

    const logged = JSON.stringify([
      ...spies.map((spy) => spy.mock.calls),
      ...Object.values(logger).map((fn) => fn.mock.calls),
      result,
    ]);
    expect(logged).not.toContain(KEY);
  });
});
