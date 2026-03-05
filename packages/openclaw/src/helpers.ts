/**
 * @module plugin/helpers
 * Shared types and utility functions for the OpenClaw plugin tool registrations.
 */

/** Minimal OpenClaw plugin API surface used for tool registration. */
export interface PluginApi {
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

  /**
   * Optional internal hook registration (available on newer OpenClaw builds).
   * We keep this optional to preserve compatibility.
   */
  registerHook?: (
    event: string | string[],
    handler: (event: unknown) => Promise<void> | void,
  ) => void;
}

/** Result shape returned by each tool execution. */
export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

const DEFAULT_API_URL = 'http://127.0.0.1:1936';
const DEFAULT_CACHE_TTL_MS = 30000;

/** Extract plugin config from the API object */
function getPluginConfig(api: PluginApi): Record<string, unknown> | undefined {
  return api.config?.plugins?.entries?.['jeeves-watcher-openclaw']?.config;
}

/** Resolve the watcher API base URL from plugin config. */
export function getApiUrl(api: PluginApi): string {
  const url = getPluginConfig(api)?.apiUrl;
  return typeof url === 'string' ? url : DEFAULT_API_URL;
}

/** Resolve the cache TTL for plugin hooks from config. */
export function getCacheTtlMs(api: PluginApi): number {
  const ttl = getPluginConfig(api)?.cacheTtlMs;
  return typeof ttl === 'number' ? ttl : DEFAULT_CACHE_TTL_MS;
}

/** Format a successful tool result. */
export function ok(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

/** Format an error tool result. */
export function fail(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: 'Error: ' + message }],
    isError: true,
  };
}

/** Format a connection error with actionable guidance. */
export function connectionFail(error: unknown, baseUrl: string): ToolResult {
  const cause = error instanceof Error ? error.cause : undefined;
  const code =
    cause && typeof cause === 'object' && 'code' in cause
      ? String((cause as { code?: unknown }).code)
      : '';
  const isConnectionError =
    code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT';

  if (isConnectionError) {
    return {
      content: [
        {
          type: 'text',
          text: [
            'Watcher service not reachable at ' + baseUrl + '.',
            'Either start the watcher service, or if it runs on a different port,',
            'set plugins.entries.jeeves-watcher-openclaw.config.apiUrl in openclaw.json.',
          ].join('\n'),
        },
      ],
      isError: true,
    };
  }

  return fail(error);
}

/** Fetch JSON from a URL, throwing on non-OK responses. */
export async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error('HTTP ' + String(res.status) + ': ' + (await res.text()));
  }
  return res.json();
}

/** POST JSON to a URL and return parsed response. */
export async function postJson(url: string, body: unknown): Promise<unknown> {
  return fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
