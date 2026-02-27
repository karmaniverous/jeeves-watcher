import { describe, expect, it, vi } from 'vitest';

import type { PluginApi } from './helpers.js';
import { registerWatcherTools } from './watcherTools.js';

describe('registerWatcherTools', () => {
  it('registers exactly 8 watcher tools', () => {
    const tools: string[] = [];
    const api: PluginApi = {
      registerTool: (tool: { name: string }) => {
        tools.push(tool.name);
      },
    };

    registerWatcherTools(api, 'http://localhost:3458');

    expect(tools).toEqual([
      'watcher_status',
      'watcher_search',
      'watcher_enrich',
      'watcher_query',
      'watcher_validate',
      'watcher_config_apply',
      'watcher_reindex',
      'watcher_issues',
    ]);
  });

  it('registers all tools as optional', () => {
    const options: Array<{ optional?: boolean }> = [];
    const api: PluginApi = {
      registerTool: (
        _tool: { name: string },
        opts?: { optional?: boolean },
      ) => {
        options.push(opts ?? {});
      },
    };

    registerWatcherTools(api, 'http://localhost:3458');

    expect(options.every((o) => o.optional === true)).toBe(true);
  });

  it('watcher_status calls /status endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    let statusExecute:
      | ((id: string, params: Record<string, unknown>) => Promise<unknown>)
      | undefined;
    const api: PluginApi = {
      registerTool: (tool: {
        name: string;
        execute: (
          id: string,
          params: Record<string, unknown>,
        ) => Promise<unknown>;
      }) => {
        if (tool.name === 'watcher_status') {
          statusExecute = tool.execute;
        }
      },
    };

    registerWatcherTools(api, 'http://localhost:3458');
    expect(statusExecute).toBeDefined();

    await statusExecute!('id', {});
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3458/status',
      undefined,
    );

    vi.unstubAllGlobals();
  });
});
