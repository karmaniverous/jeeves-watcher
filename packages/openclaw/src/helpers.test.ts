import type { PluginApi } from '@karmaniverous/jeeves';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getApiUrl, getConfigRoot } from './helpers.js';

afterEach(() => {
  delete process.env.JEEVES_WATCHER_URL;
  delete process.env.JEEVES_CONFIG_ROOT;
});

describe('getApiUrl', () => {
  it('returns configured value from plugin config', () => {
    const api: PluginApi = {
      config: {
        plugins: {
          entries: {
            'jeeves-watcher-openclaw': {
              config: { apiUrl: 'http://custom:9999' },
            },
          },
        },
      },
      registerTool: vi.fn(),
    };
    expect(getApiUrl(api)).toBe('http://custom:9999');
  });

  it('returns default when config is absent', () => {
    const api: PluginApi = { registerTool: vi.fn() };
    expect(getApiUrl(api)).toBe('http://127.0.0.1:1936');
  });

  it('falls back to JEEVES_WATCHER_URL env var when config is absent', () => {
    process.env.JEEVES_WATCHER_URL = 'http://env-override:8888';
    const api: PluginApi = { registerTool: vi.fn() };
    expect(getApiUrl(api)).toBe('http://env-override:8888');
  });

  it('prefers plugin config over env var', () => {
    process.env.JEEVES_WATCHER_URL = 'http://env-override:8888';
    const api: PluginApi = {
      config: {
        plugins: {
          entries: {
            'jeeves-watcher-openclaw': {
              config: { apiUrl: 'http://config-wins:7777' },
            },
          },
        },
      },
      registerTool: vi.fn(),
    };
    expect(getApiUrl(api)).toBe('http://config-wins:7777');
  });
});

describe('getConfigRoot', () => {
  it('returns configured value from plugin config', () => {
    const api: PluginApi = {
      config: {
        plugins: {
          entries: {
            'jeeves-watcher-openclaw': {
              config: { configRoot: '/custom/config' },
            },
          },
        },
      },
      registerTool: vi.fn(),
    };
    expect(getConfigRoot(api)).toBe('/custom/config');
  });

  it('returns default when config is absent', () => {
    const api: PluginApi = { registerTool: vi.fn() };
    expect(getConfigRoot(api)).toBe('j:/config');
  });

  it('falls back to JEEVES_CONFIG_ROOT env var when config is absent', () => {
    process.env.JEEVES_CONFIG_ROOT = '/env/config';
    const api: PluginApi = { registerTool: vi.fn() };
    expect(getConfigRoot(api)).toBe('/env/config');
  });
});
