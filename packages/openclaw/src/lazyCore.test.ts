import type { PluginApi, ToolDescriptor } from '@karmaniverous/jeeves';
import { getConfigRoot as getCoreConfigRoot } from '@karmaniverous/jeeves';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CatalogToolDescriptor } from './apiTool.js';
import { CONFIG_ROOT_NOT_CONFIGURED } from './constants.js';
import {
  createLazyCore,
  guardTool,
  warnIfConfigRootUnset,
  withGuardedTools,
} from './lazyCore.js';

afterEach(() => {
  delete process.env.JEEVES_CONFIG_ROOT;
  vi.restoreAllMocks();
});

const okResult = { content: [{ type: 'text', text: 'ran' }] };

function makeTool(): ToolDescriptor {
  return {
    name: 't',
    description: 'd',
    parameters: {},
    execute: vi.fn().mockResolvedValue(okResult),
  };
}

describe('createLazyCore', () => {
  it('returns undefined and does not init while configRoot is unset', () => {
    const ensure = createLazyCore({ registerTool: vi.fn() });
    expect(ensure()).toBeUndefined();
  });

  it('initializes core once configRoot resolves, and re-inits on change', () => {
    const api: PluginApi = { registerTool: vi.fn() };
    const ensure = createLazyCore(api);

    process.env.JEEVES_CONFIG_ROOT = '/first/config';
    expect(ensure()).toBe('/first/config');
    expect(getCoreConfigRoot()).toBe('/first/config');
    expect(ensure()).toBe('/first/config');

    process.env.JEEVES_CONFIG_ROOT = '/second/config';
    expect(ensure()).toBe('/second/config');
    expect(getCoreConfigRoot()).toBe('/second/config');
  });
});

describe('guardTool', () => {
  it('returns the configRoot error without executing when unset', async () => {
    const tool = makeTool();
    const result = await guardTool(tool, () => undefined).execute('1', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(CONFIG_ROOT_NOT_CONFIGURED);
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('returns core init failures as tool errors', async () => {
    const tool = makeTool();
    const result = await guardTool(tool, () => {
      throw new Error('bad root');
    }).execute('1', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('bad root');
  });

  it('executes the tool once configRoot resolves', async () => {
    const tool = makeTool();
    const result = await guardTool(tool, () => '/cfg').execute('1', { a: 1 });
    expect(result).toEqual(okResult);
    expect(tool.execute).toHaveBeenCalledWith('1', { a: 1 });
  });

  it('runs calls the predicate says do not read configRoot', async () => {
    const tool = makeTool();
    const guarded = guardTool(
      tool,
      () => undefined,
      (params) => params?.action === 'install',
    );
    expect(await guarded.execute('1', { action: 'status' })).toEqual(okResult);
    const blocked = await guarded.execute('2', { action: 'install' });
    expect(blocked.isError).toBe(true);
    expect(tool.execute).toHaveBeenCalledTimes(1);
  });

  it('preserves catalogMode and other descriptor properties', () => {
    const tool: CatalogToolDescriptor = {
      ...makeTool(),
      catalogMode: 'direct-only',
    };
    const guarded = guardTool(tool, () => '/cfg');
    expect(guarded.catalogMode).toBe('direct-only');
    expect(guarded).toMatchObject({ name: 't', description: 'd' });
    expect(guarded.execute).not.toBe(tool.execute);
  });
});

describe('withGuardedTools', () => {
  function register(readers: Record<string, () => boolean>) {
    const registered: ToolDescriptor[] = [];
    const api: PluginApi = {
      registerTool: (tool) => {
        registered.push(tool);
      },
    };
    const tool = makeTool();
    withGuardedTools(api, () => undefined, readers).registerTool(tool, {
      optional: true,
    });
    expect(registered).toHaveLength(1);
    return { tool, registered: registered[0] };
  }

  it('guards tools listed in the readers map', async () => {
    const { tool, registered } = register({ t: () => true });
    const result = await registered.execute('1', {});
    expect(result.isError).toBe(true);
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('defaults to CONFIG_ROOT_READERS', async () => {
    const registered: ToolDescriptor[] = [];
    const api: PluginApi = {
      registerTool: (t) => {
        registered.push(t);
      },
    };
    const tool = { ...makeTool(), name: 'watcher_service' };
    withGuardedTools(api, () => undefined).registerTool(tool);
    const result = await registered[0].execute('1', { action: 'install' });
    expect(result.isError).toBe(true);
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('registers other tools unwrapped so they run without configRoot', async () => {
    const { tool, registered } = register({ other: () => true });
    expect(registered).toBe(tool);
    expect(await registered.execute('1', {})).toEqual(okResult);
  });
});

describe('warnIfConfigRootUnset', () => {
  it('warns through the host logger when unset', () => {
    const warn = vi.fn();
    expect(
      warnIfConfigRootUnset({ registerTool: vi.fn(), logger: { warn } }),
    ).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('falls back to console.warn without a host logger', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(warnIfConfigRootUnset({ registerTool: vi.fn() })).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not warn when configRoot is set', () => {
    process.env.JEEVES_CONFIG_ROOT = '/cfg';
    const warn = vi.fn();
    expect(
      warnIfConfigRootUnset({ registerTool: vi.fn(), logger: { warn } }),
    ).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});
