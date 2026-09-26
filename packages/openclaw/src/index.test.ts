import { readFileSync } from 'node:fs';

import {
  type PluginApi,
  type PromptBuildHandler,
  recordRegisteredHooks,
  type ToolDescriptor,
  validateConversationHooks,
} from '@karmaniverous/jeeves';
import { afterEach, describe, expect, it, vi } from 'vitest';

import register from './index.js';

afterEach(() => {
  delete process.env.JEEVES_CONFIG_ROOT;
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

  it('returns a clear error when a tool runs without configRoot', async () => {
    const fetchMock = stubStatusFetch();
    const { tools, warn } = harness();
    const result = await tools.get('watcher_search')!.execute('1', {
      query: 'x',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('configRoot not configured');
    expect(result.content[0].text).toContain('plugin config');
    expect(result.content[0].text).toContain('JEEVES_CONFIG_ROOT');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('runs tools with configRoot from plugin config', async () => {
    const fetchMock = stubStatusFetch();
    const { tools, warn } = harness({
      pluginConfig: { configRoot: '/srv/jeeves/config' },
    });
    expect(warn).not.toHaveBeenCalled();
    const result = await tools.get('watcher_status')!.execute('1', {});
    expect(result.isError).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('runs tools with configRoot from JEEVES_CONFIG_ROOT', async () => {
    process.env.JEEVES_CONFIG_ROOT = '/env/jeeves/config';
    const fetchMock = stubStatusFetch();
    const { tools, warn } = harness();
    expect(warn).not.toHaveBeenCalled();
    const result = await tools.get('watcher_status')!.execute('1', {});
    expect(result.isError).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolves configRoot lazily after registration', async () => {
    stubStatusFetch();
    const { tools } = harness();
    process.env.JEEVES_CONFIG_ROOT = '/late/config';
    const result = await tools.get('watcher_status')!.execute('1', {});
    expect(result.isError).toBeUndefined();
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
