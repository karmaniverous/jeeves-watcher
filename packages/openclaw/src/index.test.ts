import { describe, expect, it } from 'vitest';

import type { PluginApi } from './helpers.js';
import register from './index.js';

describe('register', () => {
  it('registers exactly 10 tools (8 watcher + 2 memory)', () => {
    const tools: string[] = [];
    const api: PluginApi = {
      config: {
        plugins: {
          entries: {
            'jeeves-watcher': { config: { apiUrl: 'http://localhost:1936' } },
          },
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
});
