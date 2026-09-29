/**
 * @module plugin/apiTool
 * Generic HTTP-backed watcher tool registration: config shape, request helpers, and ok/connectionFail wrapping.
 */

import {
  connectionFail,
  fetchJson,
  ok,
  type PluginApi,
  postJson,
  type ToolDescriptor,
  type ToolResult,
} from '@karmaniverous/jeeves';

import { PLUGIN_ID } from './constants.js';

/**
 * OpenClaw Tool Search catalog mode.
 *
 * @remarks
 * Mirrors `AnyAgentTool['catalogMode']` in the OpenClaw plugin SDK
 * (OpenClaw 2026.9+). `'direct-only'` keeps the tool model-visible instead of
 * moving it into the hidden `tool_search` catalog. Declared locally because
 * `ToolDescriptor` in `@karmaniverous/jeeves` does not carry it yet and
 * `openclaw` is not a dependency of this package.
 */
export type ToolCatalogMode = 'direct-only';

/** A tool descriptor carrying the optional OpenClaw catalog mode. */
export type CatalogToolDescriptor = ToolDescriptor & {
  /** OpenClaw Tool Search catalog mode (omitted = catalog-eligible). */
  catalogMode?: ToolCatalogMode;
};

/** Config for a watcher API tool. */
export interface ApiToolConfig {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** OpenClaw Tool Search catalog mode; omit to leave the tool catalog-eligible. */
  catalogMode?: ToolCatalogMode;
  /** Build the request: return [endpoint, body?]. No body = GET. */
  buildRequest: (params: Record<string, unknown>) => [string, unknown?];
}

/** Register a single API tool with standard try/catch + ok/connectionFail. */
export function registerApiTool(
  api: PluginApi,
  baseUrl: string,
  config: ApiToolConfig,
): void {
  const tool: CatalogToolDescriptor = {
    name: config.name,
    description: config.description,
    parameters: config.parameters,
    ...(config.catalogMode ? { catalogMode: config.catalogMode } : {}),
    execute: async (
      _id: string,
      params: Record<string, unknown>,
    ): Promise<ToolResult> => {
      try {
        const [endpoint, body] = config.buildRequest(params);
        const url = `${baseUrl}${endpoint}`;
        const data =
          body !== undefined ? await postJson(url, body) : await fetchJson(url);
        return ok(data);
      } catch (error) {
        return connectionFail(error, baseUrl, PLUGIN_ID);
      }
    },
  };

  api.registerTool(tool, { optional: true });
}

/** Build a query string from defined params. */
export function buildQuery(
  params: Record<string, unknown>,
  keys: string[],
): string {
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
export function pickDefined(
  params: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of keys) {
    if (params[key] !== undefined) body[key] = params[key];
  }
  return body;
}
