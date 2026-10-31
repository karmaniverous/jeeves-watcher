import type {
  ToolDescriptor,
  ToolRegistrationOptions,
} from '@karmaniverous/jeeves';
import { describe, expect, it, vi } from 'vitest';

import { createCatalogTools, registerCatalogTool } from './catalogTools.js';
import { createWatcherComponent } from './watcherComponent.js';

const tools = createCatalogTools(
  {
    pluginConfig: { apiUrl: 'http://127.0.0.1:1' },
    registerTool: () => undefined,
  },
  createWatcherComponent('0.0.0-test'),
);

describe('createCatalogTools', () => {
  it('builds the standard tools and the three catalog-built domain tools', () => {
    expect([...tools.keys()].sort()).toEqual([
      'watcher_config',
      'watcher_config_apply',
      'watcher_scan',
      'watcher_search',
      'watcher_service',
      'watcher_status',
      'watcher_vcs_show',
    ]);
  });
});

describe('registerCatalogTool', () => {
  it('registers the named tool, by identity, as optional', () => {
    const registerTool =
      vi.fn<
        (tool: ToolDescriptor, options?: ToolRegistrationOptions) => void
      >();
    registerCatalogTool({ registerTool }, tools, 'watcher_scan');
    expect(registerTool).toHaveBeenCalledOnce();
    expect(registerTool.mock.calls[0]?.[0]).toBe(tools.get('watcher_scan'));
    expect(registerTool.mock.calls[0]?.[1]).toEqual({ optional: true });
  });

  it('throws, registering nothing, for a tool that was not built', () => {
    const registerTool = vi.fn();
    expect(() => {
      registerCatalogTool({ registerTool }, tools, 'watcher_walk');
    }).toThrow('Catalog tool not built: watcher_walk');
    expect(registerTool).not.toHaveBeenCalled();
  });
});
