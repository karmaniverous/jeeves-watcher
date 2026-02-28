import { describe, expect, it } from 'vitest';

import type { PluginApi } from './helpers.js';
import { PLUGIN_SOURCE } from './helpers.js';
import register from './index.js';

describe('register', () => {
  it('registers only 8 watcher tools when plugin does not hold memory slot', () => {
    const tools: string[] = [];
    const api: PluginApi = {
      config: {
        plugins: {
          entries: {
            'jeeves-watcher-openclaw': {
              config: { apiUrl: 'http://localhost:3458' },
            },
          },
        },
      },
      registerTool: (tool: { name: string }) => {
        tools.push(tool.name);
      },
    };
    register(api);
    expect(tools).toHaveLength(8);
    expect(tools).toContain('watcher_status');
    expect(tools).not.toContain('memory_search');
    expect(tools).not.toContain('memory_get');
  });

  it('registers all 10 tools when plugin holds the memory slot', () => {
    const tools: string[] = [];
    const api: PluginApi = {
      config: {
        plugins: {
          entries: {
            'jeeves-watcher-openclaw': {
              config: { apiUrl: 'http://localhost:3458' },
            },
          },
          slots: { memory: PLUGIN_SOURCE },
        },
      },
      registerTool: (tool: { name: string }) => {
        tools.push(tool.name);
      },
    };
    register(api);
    expect(tools).toHaveLength(10);
    expect(tools).toContain('watcher_status');
    expect(tools).toContain('memory_search');
    expect(tools).toContain('memory_get');
  });

  it('does not register memory tools when slot belongs to another plugin', () => {
    const tools: string[] = [];
    const api: PluginApi = {
      config: {
        plugins: {
          entries: {
            'jeeves-watcher-openclaw': {
              config: { apiUrl: 'http://localhost:3458' },
            },
          },
          slots: { memory: 'memory-core' },
        },
      },
      registerTool: (tool: { name: string }) => {
        tools.push(tool.name);
      },
    };
    register(api);
    expect(tools).toHaveLength(8);
    expect(tools).not.toContain('memory_search');
  });
});
