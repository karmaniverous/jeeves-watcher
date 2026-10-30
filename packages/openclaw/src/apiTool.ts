/**
 * @module plugin/apiTool
 * Generic HTTP-backed watcher tool registration: config shape, request helpers, and ok/connectionFail wrapping. Requests carry the bearer key (if configured) via `requestJson`.
 */

import {
  connectionFail,
  ok,
  type PluginApi,
  type ToolDescriptor,
  type ToolResult,
} from '@karmaniverous/jeeves';

import { PLUGIN_ID } from './constants.js';
import { getApiKey } from './helpers.js';
import { requestJson } from './http.js';

/** Config for a watcher API tool. */
export interface ApiToolConfig {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Build the request: return [endpoint, body?]. No body = GET. */
  buildRequest: (params: Record<string, unknown>) => [string, unknown?];
}

/** A tool config, or the name of a catalog-built tool registered in its place. */
export type WatcherToolEntry = ApiToolConfig | string;

/** API base URL, or a resolver evaluated on every call. */
export type BaseUrlSource = string | (() => string);

/**
 * Register a single API tool with standard try/catch + ok/connectionFail.
 *
 * @remarks
 * The bearer key is resolved from `api` ({@link getApiKey}) on every call,
 * so a key set after registration takes effect without re-registering.
 */
export function registerApiTool(
  api: PluginApi,
  baseUrlSource: BaseUrlSource,
  config: ApiToolConfig,
): void {
  const tool: ToolDescriptor = {
    name: config.name,
    description: config.description,
    parameters: config.parameters,
    execute: async (
      _id: string,
      params: Record<string, unknown>,
    ): Promise<ToolResult> => {
      const baseUrl =
        typeof baseUrlSource === 'function' ? baseUrlSource() : baseUrlSource;
      try {
        const [endpoint, body] = config.buildRequest(params);
        const data = await requestJson(
          `${baseUrl}${endpoint}`,
          body,
          getApiKey(api),
        );
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
