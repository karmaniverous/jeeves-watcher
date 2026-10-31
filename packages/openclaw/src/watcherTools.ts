/**
 * @module plugin/watcherTools
 * Domain-specific watcher tool registrations (14 tools) for the OpenClaw plugin: the catalog-built ones (`catalogTools`) in their 0.17.0 places, the rest as API tool configs.
 */

import { type PluginApi, type ToolDescriptor } from '@karmaniverous/jeeves';
import { getEndpoint } from '@karmaniverous/jeeves-watcher-core';

import {
  type BaseUrlSource,
  pickDefined,
  registerApiTool,
  type WatcherToolEntry,
} from './apiTool.js';
import { registerCatalogTool } from './catalogTools.js';
import { vcsToolConfigs } from './vcsTools.js';

/**
 * Register the 14 domain-specific watcher_* tools with the OpenClaw plugin API.
 *
 * @remarks
 * `watcher_search`, `watcher_scan` and `watcher_vcs_show` are built from the
 * catalog (`catalogTools`) and passed in; they keep their 0.17.0 places.
 *
 * @param api - Plugin API.
 * @param baseUrl - API base URL, or a getter resolved on every call (so a
 *   changed `apiUrl` takes effect without re-registering, as for the config
 *   tools).
 * @param catalogTools - Catalog-built tools, by name.
 * @throws When a named catalog-built tool is missing.
 */
export function registerWatcherTools(
  api: PluginApi,
  baseUrl: BaseUrlSource,
  catalogTools: ReadonlyMap<string, ToolDescriptor>,
): void {
  const tools: WatcherToolEntry[] = [
    'watcher_search',
    {
      name: 'watcher_enrich',
      description: 'Set or update metadata on a document by file path.',
      parameters: {
        type: 'object',
        required: ['path', 'metadata'],
        properties: {
          path: {
            type: 'string',
            description: 'Relative file path of the document.',
          },
          metadata: {
            type: 'object',
            description: 'Key-value metadata to set on the document.',
          },
        },
      },
      buildRequest: (params) => [
        getEndpoint('metadata').path,
        { path: params.path, metadata: params.metadata },
      ],
    },
    {
      name: 'watcher_validate',
      description:
        'Validate a candidate config (or current config if omitted). Optionally test file paths against the config to preview rule matching and metadata output.',
      parameters: {
        type: 'object',
        properties: {
          config: {
            type: 'object',
            description:
              'Candidate config (partial or full). Omit to validate current config.',
          },
          testPaths: {
            type: 'array',
            items: { type: 'string' },
            description:
              'File paths to test against the config for dry-run preview.',
          },
        },
      },
      buildRequest: (params) => {
        const body = pickDefined(params, ['config', 'testPaths']);
        return [getEndpoint('configValidate').path, body];
      },
    },
    {
      name: 'watcher_reindex',
      description: 'Trigger a reindex of the watched files.',
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['rules', 'full', 'issues', 'path', 'prune'],
            description:
              'Reindex scope: "rules" (default) re-applies inference rules; "full" re-embeds everything; "issues" re-processes files with errors; "path" reindexes a specific file or directory (requires path parameter); "prune" deletes points for files no longer in watch scope.',
          },
          path: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
            description:
              'Target file or directory path (required when scope is "path"). Accepts a single path or array of paths.',
          },
          dryRun: {
            type: 'boolean',
            description:
              'When true, compute and return the blast area plan without executing. Returns counts by root showing impact.',
          },
        },
      },
      buildRequest: (params) => [
        getEndpoint('reindex').path,
        {
          scope: params.scope ?? 'rules',
          ...(params.path ? { path: params.path } : {}),
          ...(params.dryRun ? { dryRun: true } : {}),
        },
      ],
    },
    'watcher_scan',
    {
      name: 'watcher_issues',
      description:
        'Get runtime processing failures. Shows the documents (file path or source reference) that failed processing and why.',
      parameters: { type: 'object', properties: {} },
      buildRequest: () => [getEndpoint('issues').path],
    },
    {
      name: 'watcher_walk',
      description:
        'Walk watched filesystem paths with glob intersection. Returns matching file paths from all configured watch roots, applying watch.ignored and gitignore filtering.',
      parameters: {
        type: 'object',
        required: ['globs'],
        properties: {
          globs: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Glob patterns to intersect with watch paths (e.g., ["**/.meta/meta.json"]).',
          },
        },
      },
      buildRequest: (params) => [
        getEndpoint('walk').path,
        { globs: params.globs },
      ],
    },
    ...vcsToolConfigs,
  ];

  for (const tool of tools) {
    if (typeof tool === 'string') {
      registerCatalogTool(api, catalogTools, tool);
    } else {
      registerApiTool(api, baseUrl, tool);
    }
  }
}
