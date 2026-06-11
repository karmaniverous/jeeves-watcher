/**
 * @module plugin/watcherTools
 * Domain-specific watcher tool registrations (14 tools) for the OpenClaw plugin.
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

/** Build a query string from defined params. */
function buildQuery(params: Record<string, unknown>, keys: string[]): string {
  const parts: string[] = [];
  for (const key of keys) {
    const val = params[key];
    if (val !== undefined) {
      const s = typeof val === 'string' ? val : JSON.stringify(val);
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(s)}`);
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
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

/** Register the 14 domain-specific watcher_* tools with the OpenClaw plugin API. */
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

    // ── VCS tools ──────────────────────────────────────────────────────

    {
      name: 'watcher_vcs_status',
      description:
        'Get version tracking health: enabled state, tracked roots, remote status, last activity',
      parameters: { type: 'object', properties: {} },
      buildRequest: () => ['/vcs/status'],
    },
    {
      name: 'watcher_vcs_history',
      description:
        'Query change history by path or glob with optional date range',
      parameters: {
        type: 'object',
        required: ['glob'],
        properties: {
          glob: {
            type: 'string',
            description: 'Path or glob pattern to query history for.',
          },
          since: {
            type: 'string',
            description: 'Start date (ISO 8601 or git date string).',
          },
          until: {
            type: 'string',
            description: 'End date (ISO 8601 or git date string).',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of history entries to return.',
          },
        },
      },
      buildRequest: (params) => [
        `/vcs/history${buildQuery(params, ['glob', 'since', 'until', 'limit'])}`,
      ],
    },
    {
      name: 'watcher_vcs_show',
      description: 'Retrieve file content at a specific version',
      parameters: {
        type: 'object',
        required: ['path', 'commit'],
        properties: {
          path: {
            type: 'string',
            description: 'File path to retrieve.',
          },
          commit: {
            type: 'string',
            description: 'Version identifier.',
          },
        },
      },
      buildRequest: (params) => [
        `/vcs/show${buildQuery(params, ['path', 'commit'])}`,
      ],
    },
    {
      name: 'watcher_vcs_diff',
      description:
        'Show what changed between two versions, or between a version and current',
      parameters: {
        type: 'object',
        required: ['glob', 'commit'],
        properties: {
          glob: {
            type: 'string',
            description: 'Path or glob pattern to diff.',
          },
          commit: {
            type: 'string',
            description: 'Start version identifier.',
          },
          commitEnd: {
            type: 'string',
            description:
              'End version identifier (defaults to current if omitted).',
          },
        },
      },
      buildRequest: (params) => [
        `/vcs/diff${buildQuery(params, ['glob', 'commit', 'commitEnd'])}`,
      ],
    },
    {
      name: 'watcher_vcs_revert',
      description: 'Undo changes by restoring files to a specific version',
      parameters: {
        type: 'object',
        required: ['glob', 'commit'],
        properties: {
          glob: {
            type: 'string',
            description: 'Path or glob pattern to revert.',
          },
          commit: {
            type: 'string',
            description: 'Version to restore files to.',
          },
          existingOnly: {
            type: 'boolean',
            description:
              'When true, only revert files that currently exist (skip deleted files).',
          },
        },
      },
      buildRequest: (params) => {
        const body = pickDefined(params, ['glob', 'commit', 'existingOnly']);
        return ['/vcs/revert', body];
      },
    },
    {
      name: 'watcher_vcs_exclude',
      description: 'Exclude or re-include paths from version tracking',
      parameters: {
        type: 'object',
        required: ['glob'],
        properties: {
          glob: {
            type: 'string',
            description: 'Glob pattern to exclude or re-include.',
          },
          root: {
            type: 'string',
            description: 'Tracked root to target (defaults to auto-detect).',
          },
          remove: {
            type: 'boolean',
            description:
              'When true, remove the exclusion rule (re-include the path).',
          },
        },
      },
      buildRequest: (params) => {
        const body = pickDefined(params, ['glob', 'root', 'remove']);
        return ['/vcs/exclude', body];
      },
    },
    {
      name: 'watcher_vcs_check',
      description:
        'Check whether a path is excluded from version tracking and why',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: {
            type: 'string',
            description: 'File path to check exclusion status for.',
          },
        },
      },
      buildRequest: (params) => [
        `/vcs/check-exclusion${buildQuery(params, ['path'])}`,
      ],
    },
  ];

  for (const tool of tools) {
    registerApiTool(api, baseUrl, tool);
  }
}
