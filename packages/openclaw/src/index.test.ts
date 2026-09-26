import { readFileSync } from 'node:fs';

import {
  type PluginApi,
  type PromptBuildHandler,
  recordRegisteredHooks,
  type ToolDescriptor,
  validateConversationHooks,
} from '@karmaniverous/jeeves';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CONFIG_ROOT_TOOLS } from './constants.js';
import register from './index.js';

afterEach(() => {
  delete process.env.JEEVES_CONFIG_ROOT;
  delete process.env.JEEVES_WATCHER_URL;
  vi.unstubAllGlobals();
});

interface Harness {
  api: PluginApi;
  tools: Map<string, ToolDescriptor>;
  hooks: Array<[string, unknown]>;
  warn: ReturnType<typeof vi.fn>;
}

function harness(overrides: Partial<PluginApi> = {}): Harness {
  const tools = new Map<string, ToolDescriptor>();
  const hooks: Array<[string, unknown]> = [];
  const warn = vi.fn();
  const api: PluginApi = {
    registerTool: (tool) => {
      tools.set(tool.name, tool);
    },
    on: (name: string, handler: unknown) => {
      hooks.push([name, handler]);
    },
    logger: { warn },
    ...overrides,
  };
  register(api);
  return { api, tools, hooks, warn };
}

function stubStatusFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ status: 'ok' }),
    text: () => Promise.resolve(''),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('register', () => {
  it('registers 18 watcher tools (4 factory + 14 domain)', () => {
    const { tools } = harness();
    expect(tools.size).toBe(18);
    for (const name of [
      'watcher_status',
      'watcher_config',
      'watcher_config_apply',
      'watcher_service',
      'watcher_search',
      'watcher_scan',
      'watcher_vcs_status',
    ]) {
      expect(tools.has(name)).toBe(true);
    }
  });

  it('matches the tool contract in openclaw.plugin.json', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../openclaw.plugin.json', import.meta.url), 'utf8'),
    ) as { contracts: { tools: string[] } };
    expect([...harness().tools.keys()].sort()).toEqual(
      [...manifest.contracts.tools].sort(),
    );
  });

  it('succeeds with no config and warns exactly once', () => {
    const { tools, warn } = harness();
    expect(tools.size).toBe(18);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('configRoot not configured');
  });

  it('gates only watcher_service on configRoot', () => {
    expect([...CONFIG_ROOT_TOOLS]).toEqual(['watcher_service']);
  });

  it('runs an HTTP-only tool without configRoot', async () => {
    const fetchMock = stubStatusFetch();
    const { tools } = harness();
    const result = await tools.get('watcher_search')!.execute('1', {
      query: 'x',
    });
    expect(result.isError).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never returns the configRoot error from HTTP-only tools', async () => {
    stubStatusFetch();
    const { tools } = harness();
    const httpOnly = [...tools.values()].filter(
      (tool) => !CONFIG_ROOT_TOOLS.has(tool.name),
    );
    expect(httpOnly).toHaveLength(17);
    for (const tool of httpOnly) {
      const result = await tool.execute('1', {});
      expect(result.content[0]?.text ?? '').not.toContain(
        'configRoot not configured',
      );
    }
  });

  const statusUrl = async (overrides: Partial<PluginApi> = {}) => {
    const fetchMock = stubStatusFetch();
    const { tools } = harness(overrides);
    await tools.get('watcher_status')!.execute('1', {});
    expect(fetchMock).toHaveBeenCalled();
    return String(fetchMock.mock.calls[0][0]);
  };

  it('calls the configured apiUrl from watcher_status', async () => {
    expect(
      await statusUrl({ pluginConfig: { apiUrl: 'http://custom-host:4321' } }),
    ).toMatch(/^http:\/\/custom-host:4321\//);
  });

  it('calls the default port from watcher_status when apiUrl is unset', async () => {
    expect(await statusUrl()).toMatch(/^http:\/\/127\.0\.0\.1:1936\//);
  });

  it('resolves apiUrl lazily on each watcher_status call', async () => {
    const fetchMock = stubStatusFetch();
    const { tools } = harness();
    process.env.JEEVES_WATCHER_URL = 'http://late-host:5555';
    await tools.get('watcher_status')!.execute('1', {});
    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /^http:\/\/late-host:5555\//,
    );
  });

  it('returns a clear error when a configRoot tool runs without it', async () => {
    const { tools, warn } = harness();
    const result = await tools.get('watcher_service')!.execute('1', {
      action: 'status',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('configRoot not configured');
    expect(result.content[0].text).toContain('plugin config');
    expect(result.content[0].text).toContain('JEEVES_CONFIG_ROOT');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  // An invalid action exercises the gate without touching the host's
  // service manager: reaching the tool proves configRoot resolved.
  const probeService = (tools: Map<string, ToolDescriptor>) =>
    tools.get('watcher_service')!.execute('1', { action: 'bogus' });

  it('runs a configRoot tool with configRoot from plugin config', async () => {
    const { tools, warn } = harness({
      pluginConfig: { configRoot: '/srv/jeeves/config' },
    });
    expect(warn).not.toHaveBeenCalled();
    const result = await probeService(tools);
    expect(result.content[0].text).toContain('Invalid action');
  });

  it('runs a configRoot tool with configRoot from JEEVES_CONFIG_ROOT', async () => {
    process.env.JEEVES_CONFIG_ROOT = '/env/jeeves/config';
    const { tools, warn } = harness();
    expect(warn).not.toHaveBeenCalled();
    const result = await probeService(tools);
    expect(result.content[0].text).toContain('Invalid action');
  });

  it('resolves configRoot lazily after registration', async () => {
    const { tools } = harness();
    process.env.JEEVES_CONFIG_ROOT = '/late/config';
    const result = await probeService(tools);
    expect(result.content[0].text).toContain('Invalid action');
  });

  it('injects the watcher rules via before_prompt_build', async () => {
    const { hooks } = harness();
    expect(hooks).toHaveLength(1);
    const [name, handler] = hooks[0] as [string, PromptBuildHandler];
    expect(name).toBe('before_prompt_build');
    expect(await handler({ prompt: '', messages: [] }, {})).toEqual({
      appendSystemContext: expect.stringContaining('watcher_search') as unknown,
    });
  });

  it('declares its conversation hooks in package.json', async () => {
    const hooks = await recordRegisteredHooks(register, {
      pluginConfig: { configRoot: '/srv/jeeves/config' },
    });
    const pkg: unknown = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(validateConversationHooks(pkg, hooks)).toEqual([
      'before_prompt_build',
    ]);
  });
});
