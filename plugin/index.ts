/**
 * @module plugin
 * OpenClaw plugin entry point. Registers watcher_search, watcher_enrich, and watcher_status tools.
 */

/** Minimal OpenClaw plugin API surface used for tool registration. */
interface PluginApi {
  config?: {
    plugins?: {
      entries?: Record<string, { config?: Record<string, unknown> }>;
    };
  };
  registerTool(
    tool: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
      execute: (
        id: string,
        params: Record<string, unknown>,
      ) => Promise<ToolResult>;
    },
    options?: { optional?: boolean },
  ): void;
}

/** Result shape returned by each tool execution. */
interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

const DEFAULT_API_URL = 'http://127.0.0.1:3458';

function getApiUrl(api: PluginApi): string {
  const url = api.config?.plugins?.entries?.['jeeves-watcher']?.config?.apiUrl;
  return typeof url === 'string' ? url : DEFAULT_API_URL;
}

function ok(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function fail(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`HTTP ${String(res.status)}: ${await res.text()}`);
  }
  return res.json();
}

/** Register all jeeves-watcher tools with the OpenClaw plugin API. */
export default function register(api: PluginApi): void {
  const baseUrl = getApiUrl(api);

  api.registerTool(
    {
      name: 'watcher_status',
      description:
        'Get jeeves-watcher status including collection stats and available payload fields.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        try {
          const data = await fetchJson(`${baseUrl}/status`);
          return ok(data);
        } catch (error) {
          return fail(error);
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
          filter: {
            type: 'object',
            description: 'Qdrant filter object.',
          },
        },
      },
      execute: async (_id: string, params: Record<string, unknown>) => {
        try {
          const data = await fetchJson(`${baseUrl}/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: params.query,
              ...(params.limit !== undefined ? { limit: params.limit } : {}),
              ...(params.filter !== undefined ? { filter: params.filter } : {}),
            }),
          });
          return ok(data);
        } catch (error) {
          return fail(error);
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
          const data = await fetchJson(`${baseUrl}/metadata`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              path: params.path,
              metadata: params.metadata,
            }),
          });
          return ok(data);
        } catch (error) {
          return fail(error);
        }
      },
    },
    { optional: true },
  );
}
