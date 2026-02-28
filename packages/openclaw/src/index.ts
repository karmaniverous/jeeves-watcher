/**
 * @module plugin
 * OpenClaw plugin entry point. Registers all jeeves-watcher tools.
 */

import type { PluginApi } from './helpers.js';
import { getApiUrl, holdsMemorySlot } from './helpers.js';
import { createMemoryTools } from './memoryTools.js';
import { registerWatcherTools } from './watcherTools.js';

/** Register jeeves-watcher tools with the OpenClaw plugin API. */
export default function register(api: PluginApi): void {
  const baseUrl = getApiUrl(api);

  // Always register 8 watcher_* tools
  registerWatcherTools(api, baseUrl);

  // Only register memory tools if this plugin holds the memory slot.
  // Otherwise memory-core stays active and the agent can claim the slot
  // later via gateway config.patch after bootstrapping the watcher service.
  if (!holdsMemorySlot(api)) return;

  const { memorySearch, memoryGet } = createMemoryTools(api, baseUrl);

  api.registerTool({
    name: 'memory_search',
    description:
      'Semantically search MEMORY.md and memory/*.md files. Returns top snippets with path and line numbers.',
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search query text.' },
        maxResults: {
          type: 'number',
          description: 'Maximum results to return.',
        },
        minScore: {
          type: 'number',
          description: 'Minimum similarity score threshold.',
        },
      },
    },
    execute: memorySearch,
  });

  api.registerTool({
    name: 'memory_get',
    description:
      'Read content from MEMORY.md or memory/*.md files with optional line range.',
    parameters: {
      type: 'object',
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          description: 'Path to the memory file to read.',
        },
        from: {
          type: 'number',
          description: 'Line number to start reading from (1-indexed).',
        },
        lines: {
          type: 'number',
          description: 'Number of lines to read.',
        },
      },
    },
    execute: memoryGet,
  });
}
