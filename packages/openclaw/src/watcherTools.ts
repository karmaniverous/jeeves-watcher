/**
 * @module plugin/watcherTools
 * Watcher tool registrations (watcher_* tools) for the OpenClaw plugin.
 */

import { connectionFail, fetchJson, ok, type PluginApi } from './helpers.js';

/** Register all 8 watcher_* tools with the OpenClaw plugin API. */
export function registerWatcherTools(api: PluginApi, baseUrl: string): void {
  api.registerTool(
    {
      name: 'watcher_status',
      description:
        'Get jeeves-watcher service health, uptime, and collection statistics.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        try {
          return ok(await fetchJson(`${baseUrl}/status`));
        } catch (error) {
          return connectionFail(error, baseUrl);
        }
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: 'watcher_search',
      description:
        'Semantic search over indexed documents. Supports Qdrant filters.',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Search query text.' },
          limit: {
            type: 'number',
            description: 'Max results (default 10).',
          },
          offset: {
            type: 'number',
            description: 'Number of results to skip for pagination.',
          },
          filter: {
            type: 'object',
            description: 'Qdrant filter object.',
          },
        },
      },
      execute: async (_id: string, params: Record<string, unknown>) => {
        try {
          const body: Record<string, unknown> = { query: params.query };
          if (params.limit !== undefined) body.limit = params.limit;
          if (params.offset !== undefined) body.offset = params.offset;
          if (params.filter !== undefined) body.filter = params.filter;
          return ok(
            await fetchJson(`${baseUrl}/search`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }),
          );
        } catch (error) {
          return connectionFail(error, baseUrl);
        }
      },
    },
    { optional: true },
  );

  api.registerTool(
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
      execute: async (_id: string, params: Record<string, unknown>) => {
        try {
          return ok(
            await fetchJson(`${baseUrl}/metadata`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                path: params.path,
                metadata: params.metadata,
              }),
            }),
          );
        } catch (error) {
          return connectionFail(error, baseUrl);
        }
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: 'watcher_query',
      description: 'Query the merged virtual document via JSONPath.',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: {
            type: 'string',
            description: 'JSONPath expression.',
          },
          resolve: {
            type: 'array',
            items: { type: 'string', enum: ['files', 'globals'] },
            description:
              'Resolution scopes to include (e.g., ["files"], ["globals"], or both).',
          },
        },
      },
      execute: async (_id: string, params: Record<string, unknown>) => {
        try {
          const body: Record<string, unknown> = { path: params.path };
          if (params.resolve !== undefined) body.resolve = params.resolve;
          return ok(
            await fetchJson(`${baseUrl}/config/query`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }),
          );
        } catch (error) {
          return connectionFail(error, baseUrl);
        }
      },
    },
    { optional: true },
  );

  api.registerTool(
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
      execute: async (_id: string, params: Record<string, unknown>) => {
        try {
          const body: Record<string, unknown> = {};
          if (params.config !== undefined) body.config = params.config;
          if (params.testPaths !== undefined) body.testPaths = params.testPaths;
          return ok(
            await fetchJson(`${baseUrl}/config/validate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }),
          );
        } catch (error) {
          return connectionFail(error, baseUrl);
        }
      },
    },
    { optional: true },
  );

  api.registerTool(
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
      execute: async (_id: string, params: Record<string, unknown>) => {
        try {
          return ok(
            await fetchJson(`${baseUrl}/config/apply`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ config: params.config }),
            }),
          );
        } catch (error) {
          return connectionFail(error, baseUrl);
        }
      },
    },
    { optional: true },
  );

  api.registerTool(
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
      execute: async (_id: string, params: Record<string, unknown>) => {
        try {
          return ok(
            await fetchJson(`${baseUrl}/config-reindex`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                scope: params.scope ?? 'rules',
              }),
            }),
          );
        } catch (error) {
          return connectionFail(error, baseUrl);
        }
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: 'watcher_issues',
      description:
        'Get runtime embedding failures. Shows files that failed processing and why.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        try {
          return ok(await fetchJson(`${baseUrl}/issues`));
        } catch (error) {
          return connectionFail(error, baseUrl);
        }
      },
    },
    { optional: true },
  );
}
