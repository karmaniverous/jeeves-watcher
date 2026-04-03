import type { PluginApi } from '@karmaniverous/jeeves';
import { describe, expect, it } from 'vitest';

import register from './index.js';

describe('register', () => {
  it('registers 11 watcher tools (4 factory + 7 domain)', () => {
    const tools: string[] = [];
    const api: PluginApi = {
      config: {
        plugins: {
          entries: {
            'jeeves-watcher-openclaw': {
              config: {
                apiUrl: 'http://localhost:1936',
                configRoot: 'j:/config',
              },
            },
          },
        },
      },
      registerTool: (tool: { name: string }) => {
        tools.push(tool.name);
      },
    };
    register(api);
    expect(tools).toHaveLength(11);
    // 4 factory tools
    expect(tools).toContain('watcher_status');
    expect(tools).toContain('watcher_config');
    expect(tools).toContain('watcher_config_apply');
    expect(tools).toContain('watcher_service');
    // 7 domain tools
    expect(tools).toContain('watcher_search');
    expect(tools).toContain('watcher_enrich');
    expect(tools).toContain('watcher_validate');
    expect(tools).toContain('watcher_reindex');
    expect(tools).toContain('watcher_scan');
    expect(tools).toContain('watcher_issues');
    expect(tools).toContain('watcher_walk');
  });
});
