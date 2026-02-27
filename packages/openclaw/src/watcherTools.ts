/**
 * @module plugin/watcherTools
 * Watcher tool registrations (watcher_* tools) for the OpenClaw plugin.
 */

import {
  connectionFail,
  fetchJson,
  ok,
  type PluginApi,
  postJson,
  type ToolResult,
} from './helpers.js';

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
          return connectionFail(error, baseUrl);
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

/** Register all 8 watcher_* tools with the OpenClaw plugin API. */
export function registerWatcherTools(api: PluginApi, baseUrl: string): void {
  const tools: ApiToolConfig[] = [
    {
      name: 'watcher_status',
      description:
        'Get jeeves-watcher service health, uptime, and collection statistics.',
      parameters: { type: 'object', properties: {} },
      buildRequest: () => ['/status'],
    },
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
      name: 'watcher_query',
      description: 'Query the merged virtual document via JSONPath.',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'JSONPath expression.' },
          resolve: {
            type: 'array',
            items: { type: 'string', enum: ['files', 'globals'] },
            description:
              'Resolution scopes to include (e.g., ["files"], ["globals"], or both).',
          },
        },
      },
      buildRequest: (params) => {
        const body = pickDefined(params, ['path', 'resolve']);
        return ['/config/query', body];
      },
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
      name: 'watcher_config_apply',
      description:
        'Apply a full or partial config. Validates, writes to disk, and triggers configured reindex behavior.',
      parameters: {
        type: 'object',
        required: ['config'],
        properties: {
          config: {
            type: 'object',
            description: 'Full or partial config to apply.',
          },
        },
      },
      buildRequest: (params) => ['/config/apply', { config: params.config }],
    },
    {
      name: 'watcher_reindex',
      description: 'Trigger a reindex of the watched files.',
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['rules', 'full'],
            description:
              'Reindex scope: "rules" (default) re-applies inference rules; "full" re-embeds everything.',
          },
        },
      },
      buildRequest: (params) => [
        '/config-reindex',
        { scope: params.scope ?? 'rules' },
      ],
    },
    {
      name: 'watcher_issues',
      description:
        'Get runtime embedding failures. Shows files that failed processing and why.',
      parameters: { type: 'object', properties: {} },
      buildRequest: () => ['/issues'],
    },
  ];

  for (const tool of tools) {
    registerApiTool(api, baseUrl, tool);
  }
}
