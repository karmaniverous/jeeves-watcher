/**
 * @module plugin/toolTestHarness
 * Test-only helpers: a fetch stub and a plugin API that captures registered watcher tools by name. No side effects.
 */

import type {
  PluginApi,
  ToolDescriptor,
  ToolRegistrationOptions,
} from '@karmaniverous/jeeves';
import { type Mock, vi } from 'vitest';

import type { CatalogToolDescriptor } from './apiTool.js';
import { registerWatcherTools } from './watcherTools.js';

/** Base URL used by tool tests. */
export const BASE = 'http://localhost:1936';

/** Signature of the `fetch` stub. */
type FetchStub = (...args: unknown[]) => Promise<unknown>;

/** A `fetch` stub resolving to an OK JSON response carrying `data`. */
export function mockFetch(data: unknown = {}): Mock<FetchStub> {
  return vi.fn<FetchStub>().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

/** A registered tool plus the options it was registered with. */
export interface CapturedTool {
  tool: CatalogToolDescriptor;
  options?: ToolRegistrationOptions;
}

/** Register the watcher tools against a capturing API; returns them by name, in order. */
export function captureTools(baseUrl = BASE): Map<string, CapturedTool> {
  const tools = new Map<string, CapturedTool>();
  const api: PluginApi = {
    registerTool: (tool: ToolDescriptor, options?: ToolRegistrationOptions) => {
      tools.set(tool.name, { tool, options });
    },
  };
  registerWatcherTools(api, baseUrl);
  return tools;
}

/** Invoke a captured tool by name. */
export function run(
  tools: Map<string, CapturedTool>,
  name: string,
  params: Record<string, unknown>,
) {
  const captured = tools.get(name);
  if (!captured) throw new Error(`Tool not registered: ${name}`);
  return captured.tool.execute('id', params);
}
