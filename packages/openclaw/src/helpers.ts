/**
 * @module plugin/helpers
 * Shared types and utility functions for the OpenClaw plugin tool registrations.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

/** Minimal OpenClaw plugin API surface used for tool registration. */
export interface PluginApi {
  config?: {
    plugins?: {
      entries?: Record<string, { config?: Record<string, unknown> }>;
    };
    agents?: {
      entries?: Record<string, { workspace?: string }>;
      defaults?: { workspace?: string };
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
export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

const DEFAULT_API_URL = 'http://127.0.0.1:3458';

/** Source identifier for virtual rule registration. */
export const PLUGIN_SOURCE = 'jeeves-watcher-openclaw';

/** Normalize a path to forward slashes and lowercase drive letter on Windows. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Resolve the workspace path from gateway config.
 * Priority: agent-specific > defaults > fallback (~/.openclaw/workspace).
 */
export function getWorkspacePath(api: PluginApi): string {
  const agentWorkspace =
    api.config?.agents?.entries?.['main']?.workspace ??
    api.config?.agents?.defaults?.workspace;
  return agentWorkspace ?? join(homedir(), '.openclaw', 'workspace');
}

/** Resolve the watcher API base URL from plugin config. */
export function getApiUrl(api: PluginApi): string {
  const url =
    api.config?.plugins?.entries?.['jeeves-watcher-openclaw']?.config?.apiUrl;
  return typeof url === 'string' ? url : DEFAULT_API_URL;
}

/**
 * Schema value type — matches watcher inference rule schema conventions.
 * Can be an inline JSON Schema object, a file reference string,
 * a named schema reference, or a composable array of these.
 */
export type SchemaValue =
  | Record<string, unknown>
  | string
  | Array<Record<string, unknown> | string>;

/**
 * Resolve user-supplied schemas from plugin config.
 * Returns a map of rule name → schema array (always normalized to array).
 */
export function getPluginSchemas(
  api: PluginApi,
): Record<string, Array<Record<string, unknown> | string>> {
  const config =
    api.config?.plugins?.entries?.['jeeves-watcher-openclaw']?.config;
  const raw = config?.schemas as
    | Record<string, SchemaValue>
    | undefined;
  if (!raw || typeof raw !== 'object') return {};

  const result: Record<string, Array<Record<string, unknown> | string>> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      result[name] = value as Array<Record<string, unknown> | string>;
    } else if (typeof value === 'object' || typeof value === 'string') {
      result[name] = [value as Record<string, unknown> | string];
    }
  }
  return result;
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
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

/** Format a connection error with actionable guidance. */
export function connectionFail(error: unknown, baseUrl: string): ToolResult {
  const cause = error instanceof Error ? error.cause : undefined;
  const code =
    cause && typeof cause === 'object' && 'code' in cause
      ? String(cause.code)
      : '';
  const isConnectionError =
    code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT';

  if (isConnectionError) {
    return {
      content: [
        {
          type: 'text',
          text: [
            `Watcher service not reachable at ${baseUrl}.`,
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
    throw new Error(`HTTP ${String(res.status)}: ${await res.text()}`);
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
