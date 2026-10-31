/**
 * @module plugin/catalogTools
 * The watcher tools built from `WATCHER_CATALOG` by core's toolset: the three standard tools (`watcher_status`, `watcher_config`, `watcher_config_apply`) and `watcher_search`, `watcher_scan` and `watcher_vcs_show`, all sending the bearer key where their entry requires it.
 *
 * @remarks
 * Parameters come from the catalog's request schemas; names and
 * descriptions keep the 0.17.0 tool surface. `watcher_search` and
 * `watcher_scan` are `catalogMode: 'direct-only'`, so OpenClaw Tool Search
 * keeps them model-visible: semantic search must be a direct tool or the
 * model reaches for grep first. Errors are reported as core's
 * `HTTP <status>: <body>`; API-key guidance lives in the skill's
 * troubleshooting section (spec #281 D31).
 */

import {
  createPluginToolset,
  type JeevesComponentDescriptor,
  type PluginApi,
  type ToolDescriptor,
} from '@karmaniverous/jeeves';
import type { ClientAuth } from '@karmaniverous/jeeves/catalog';
import { WATCHER_CATALOG } from '@karmaniverous/jeeves-watcher-core';

import { getApiKey, getApiUrl } from './helpers.js';

/**
 * Core's toolset for the watcher: the four standard tools and the selected
 * catalog tools. The base URL and the bearer key are resolved from `api` on
 * every call.
 *
 * @param api - Plugin API (config source).
 * @param component - Plugin-side component descriptor.
 * @returns The tools, keyed by name.
 */
export function createCatalogTools(
  api: PluginApi,
  component: JeevesComponentDescriptor,
): Map<string, ToolDescriptor> {
  const auth: ClientAuth = { bearer: () => getApiKey(api) };
  const tools = createPluginToolset(component, {
    apiUrl: () => getApiUrl(api),
    catalog: WATCHER_CATALOG,
    auth,
    tools: {
      search: {
        description:
          'Semantic search over indexed documents. Supports Qdrant filters. This is a direct tool: call it directly, never through tool_call.',
        catalogMode: 'direct-only',
      },
      scan: {
        description:
          'Filter-only point query without vector search. Returns metadata for points matching a Qdrant filter. Use for structural queries: file enumeration, staleness checks, delta computation. Use watcher_search for semantic/similarity queries. This is a direct tool: call it directly, never through tool_call.',
        catalogMode: 'direct-only',
      },
      vcsShow: {
        description: 'Retrieve file content at a specific version',
      },
    },
  });
  return new Map(tools.map((tool) => [tool.name, tool]));
}

/**
 * Register one catalog-built tool as an optional tool.
 *
 * @param api - Plugin API (tool registration target).
 * @param catalogTools - Catalog-built tools, by name ({@link createCatalogTools}).
 * @param name - Tool name.
 * @throws When no tool of that name was built.
 */
export function registerCatalogTool(
  api: Pick<PluginApi, 'registerTool'>,
  catalogTools: ReadonlyMap<string, ToolDescriptor>,
  name: string,
): void {
  const tool = catalogTools.get(name);
  if (!tool) throw new Error(`Catalog tool not built: ${name}`);
  api.registerTool(tool, { optional: true });
}
