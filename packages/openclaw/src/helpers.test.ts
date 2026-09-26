import type { PluginApi } from '@karmaniverous/jeeves';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getApiUrl, getConfigRoot } from './helpers.js';

afterEach(() => {
  delete process.env.JEEVES_WATCHER_URL;
  delete process.env.JEEVES_CONFIG_ROOT;
});

/** Build an API whose `plugins.entries` config holds the given values. */
function withEntryConfig(config: Record<string, unknown>): PluginApi {
  return {
    config: {
      plugins: { entries: { 'jeeves-watcher-openclaw': { config } } },
    },
    registerTool: vi.fn(),
  };
}

describe('getApiUrl', () => {
  it('returns configured value from plugin config', () => {
    expect(getApiUrl(withEntryConfig({ apiUrl: 'http://custom:9999' }))).toBe(
      'http://custom:9999',
    );
  });

  it('returns default when config is absent', () => {
    expect(getApiUrl({ registerTool: vi.fn() })).toBe('http://127.0.0.1:1936');
  });

  it('falls back to JEEVES_WATCHER_URL env var when config is absent', () => {
    process.env.JEEVES_WATCHER_URL = 'http://env-override:8888';
    expect(getApiUrl({ registerTool: vi.fn() })).toBe(
      'http://env-override:8888',
    );
  });

  it('prefers plugin config over env var', () => {
    process.env.JEEVES_WATCHER_URL = 'http://env-override:8888';
    expect(
      getApiUrl(withEntryConfig({ apiUrl: 'http://config-wins:7777' })),
    ).toBe('http://config-wins:7777');
  });
});

describe('getConfigRoot', () => {
  it('returns the plugin-scoped config value', () => {
    const api: PluginApi = {
      pluginConfig: { configRoot: '/scoped/config' },
      registerTool: vi.fn(),
    };
    expect(getConfigRoot(api)).toBe('/scoped/config');
  });

  it('returns the plugins.entries config value', () => {
    expect(
      getConfigRoot(withEntryConfig({ configRoot: '/custom/config' })),
    ).toBe('/custom/config');
  });

  it('returns undefined (no default) when nothing is configured', () => {
    expect(getConfigRoot({ registerTool: vi.fn() })).toBeUndefined();
  });

  it('ignores blank values', () => {
    process.env.JEEVES_CONFIG_ROOT = '  ';
    const api: PluginApi = {
      pluginConfig: { configRoot: '' },
      registerTool: vi.fn(),
    };
    expect(getConfigRoot(api)).toBeUndefined();
  });

  it('falls back to JEEVES_CONFIG_ROOT env var when config is absent', () => {
    process.env.JEEVES_CONFIG_ROOT = '/env/config';
    expect(getConfigRoot({ registerTool: vi.fn() })).toBe('/env/config');
  });

  it('prefers plugin config over env var', () => {
    process.env.JEEVES_CONFIG_ROOT = '/env/config';
    expect(getConfigRoot(withEntryConfig({ configRoot: '/cfg' }))).toBe('/cfg');
  });
});
