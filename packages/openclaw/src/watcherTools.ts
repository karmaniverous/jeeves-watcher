/**
 * @module plugin/watcherTools
 * Domain-specific watcher tool registrations (7 tools) for the OpenClaw plugin.
 */

import {
  connectionFail,
  fetchJson,
  ok,
  type PluginApi,
  postJson,
  type ToolResult,
} from '@karmaniverous/jeeves';

import { PLUGIN_ID } from './constants.js';

/** Config for a watcher API tool. */
interface ApiToolConfig {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Build the request: return [endpoint, body?]. No body = GET. */
  buildRequest: (params: Record<string, unknown>) => [string, unknown?];
}

/** Register a single API tool with standard try/catch + ok/connectionFail. */
function registerApiTool(
  api: PluginApi,
  baseUrl: string,
  config: ApiToolConfig,
): void {
  api.registerTool(
    {
      name: config.name,
      description: config.description,
      parameters: config.parameters,
      execute: async (
        _id: string,
        params: Record<string, unknown>,
      ): Promise<ToolResult> => {
        try {
          const [endpoint, body] = config.buildRequest(params);
          const url = `${baseUrl}${endpoint}`;
          const data =
            body !== undefined
              ? await postJson(url, body)
              : await fetchJson(url);
          return ok(data);
        } catch (error) {
          return connectionFail(error, baseUrl, PLUGIN_ID);
        }
      },
    },
    { optional: true },
  );
}

/** Pick defined keys from params into a body object. */
function pickDefined(
  params: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of keys) {
    if (params[key] !== undefined) body[key] = params[key];
  }
  return body;
}

/** Register the 7 domain-specific watcher_* tools with the OpenClaw plugin API. */
export function registerWatcherTools(api: PluginApi, baseUrl: string): void {
  const tools: ApiToolConfig[] = [
    {
      name: 'watcher_search',
      description:
        'Semantic search over indexed documents. Supports Qdrant filters.',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Search query text.' },
          limit: { type: 'number', description: 'Max results (default 10).' },
          offset: {
            type: 'number',
            description: 'Number of results to skip for pagination.',
          },
          filter: { type: 'object', description: 'Qdrant filter object.' },
        },
      },
      buildRequest: (params) => {
        const body = pickDefined(params, [
          'query',
          'limit',
          'offset',
          'filter',
        ]);
        return ['/search', body];
      },
    },
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
        '/metadata',
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
        return ['/config/validate', body];
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
        '/reindex',
        {
          scope: params.scope ?? 'rules',
          ...(params.path ? { path: params.path } : {}),
          ...(params.dryRun ? { dryRun: true } : {}),
        },
      ],
    },
    {
      name: 'watcher_scan',
      description:
        'Filter-only point query without vector search. Returns metadata for points matching a Qdrant filter. Use for structural queries: file enumeration, staleness checks, delta computation. Use watcher_search for semantic/similarity queries.',
      parameters: {
        type: 'object',
        required: ['filter'],
        properties: {
          filter: {
            type: 'object',
            description: 'Qdrant filter object (required).',
          },
          limit: {
            type: 'number',
            description: 'Page size (default 100, max 1000).',
          },
          cursor: {
            type: 'string',
            description: 'Opaque cursor from previous response for pagination.',
          },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'Payload fields to return (projection).',
          },
          countOnly: {
            type: 'boolean',
            description: 'If true, return { count } instead of points.',
          },
        },
      },
      buildRequest: (params) => {
        const body = pickDefined(params, [
          'filter',
          'limit',
          'cursor',
          'fields',
          'countOnly',
        ]);
        return ['/scan', body];
      },
    },
    {
      name: 'watcher_issues',
      description:
        'Get runtime embedding failures. Shows files that failed processing and why.',
      parameters: { type: 'object', properties: {} },
      buildRequest: () => ['/issues'],
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
      buildRequest: (params) => ['/walk', { globs: params.globs }],
    },
  ];

  for (const tool of tools) {
    registerApiTool(api, baseUrl, tool);
  }
}
