/**
 * @module plugin/configTools
 * Watcher-owned `watcher_config` and `watcher_config_apply` tools: same names, parameters and requests as the core toolset's, but sent through the plugin HTTP helper so they carry the bearer key.
 *
 * @remarks
 * Core's `createPluginToolset` cannot attach request headers, so its two
 * authenticated HTTP tools are replaced by these (see {@link CORE_TOOLS_REPLACED}).
 * `watcher_status` stays with core: `GET /status` is always open.
 */

import { getEndpoint } from '@karmaniverous/jeeves-watcher-core';

import type { ApiToolConfig } from './apiTool.js';

/** Core toolset tools that this module replaces. */
export const CORE_TOOLS_REPLACED: ReadonlySet<string> = new Set([
  'watcher_config',
  'watcher_config_apply',
]);

/** `watcher_config` and `watcher_config_apply`, as API tool configs. */
export const configToolConfigs: ApiToolConfig[] = [
  {
    name: 'watcher_config',
    description:
      'Query watcher running configuration. Optional JSONPath filter.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'JSONPath expression (optional)',
        },
      },
    },
    buildRequest: (params) => {
      const path = params.path as string | undefined;
      const base = getEndpoint('config').path;
      return [path ? `${base}?path=${encodeURIComponent(path)}` : base];
    },
  },
  {
    name: 'watcher_config_apply',
    description: 'Apply a config patch to the running watcher service.',
    parameters: {
      type: 'object',
      properties: {
        config: {
          type: 'object',
          description: 'Config patch to apply',
        },
      },
      required: ['config'],
    },
    buildRequest: (params) => {
      const config = params.config as Record<string, unknown> | undefined;
      if (!config) throw new Error('Missing required parameter: config');
      return [getEndpoint('configApply').path, { patch: config }];
    },
  },
];
