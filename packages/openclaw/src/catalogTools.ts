/**
 * @module plugin/catalogTools
 * Every watcher tool, built from `WATCHER_CATALOG` by core's toolset (D38): the four standard tools (`watcher_status`, `watcher_service`, `watcher_config`, `watcher_config_apply`) and the 14 domain tools, all sending the bearer key where their entry requires it; `registerCatalogTool` registers one of them as an optional tool.
 *
 * @remarks
 * Each tool is named `watcher_` plus its entry's verb-first name in
 * snake_case (D77, `toToolName`). Parameters come from the entry's request
 * schemas; descriptions keep the 0.17.0 wording where it is still true
 * (`WATCHER_TOOL_SELECTION`). `watcher_search` and `watcher_scan` are
 * `catalogMode: 'direct-only'`, so OpenClaw Tool Search keeps them
 * model-visible: semantic search must be a direct tool or the model reaches
 * for grep first. Every call runs on core's 120 s default timeout
 * (`DEFAULT_FETCH_TIMEOUT_MS`, D137), the status probe on 5 s. Errors are
 * reported as core's `HTTP <status>: <body>`; API-key guidance lives in the
 * skill's troubleshooting section (spec #281 D31).
 */

import {
  type CatalogToolSelection,
  createPluginToolset,
  type JeevesComponentDescriptor,
  type PluginApi,
  type ToolDescriptor,
} from '@karmaniverous/jeeves';
import { type ClientAuth, toToolName } from '@karmaniverous/jeeves/catalog';
import {
  VCS_EXCLUDE_CONFIRM_THRESHOLD,
  WATCHER_CATALOG,
  type WatcherCatalog,
} from '@karmaniverous/jeeves-watcher-core';

import { getApiKey, getApiUrl } from './helpers.js';

/** A catalog entry name. */
type EntryName = WatcherCatalog['entries'][number]['name'];

/** `watcher_exclude_vcs_path` description (D103, D137). */
export const VCS_EXCLUDE_DESCRIPTION = `Exclude a path from version history (VCS-only: it stays in search), or remove the exclusion. Adding untracks the files the pattern matches, ending their history. Without confirm: true, more than ${String(VCS_EXCLUDE_CONFIRM_THRESHOLD)} files return { confirmRequired: true, untracked } and change nothing: check the count with the user, then repeat with confirm: true. A timeout does not cancel the exclusion: check the outcome with watcher_check_vcs_exclusion before retrying.`;

/** `watcher_check_vcs_exclusion` description (0.21.0, spec B4). */
export const VCS_CHECK_DESCRIPTION =
  'Check whether git ignores a path and why: the rule, the file holding it and its line';

/** The scope `watcher_reindex` sends when the caller omits one: 0.17.0's default (owner ruling, 2026-11-04). */
export const REINDEX_DEFAULT_SCOPE = 'rules';

/** `watcher_reindex` description. */
export const REINDEX_DESCRIPTION = `Trigger a reindex of the watched files. Without scope, re-applies inference rules (scope "${REINDEX_DEFAULT_SCOPE}"); the HTTP API's own default is "issues".`;

/**
 * The 14 domain tools, in their 0.17.0 registration order, by catalog entry.
 * Descriptions keep the 0.17.0 text unless it changed with the tool.
 */
export const WATCHER_TOOL_SELECTION = {
  search: {
    description:
      'Semantic search over indexed documents. Supports Qdrant filters. This is a direct tool: call it directly, never through tool_call.',
    catalogMode: 'direct-only',
  },
  setMetadata: {
    description:
      'Set or update metadata on a document by file path or source reference.',
  },
  validateConfig: {
    description:
      'Validate a candidate config (or current config if omitted). Optionally test file paths against the config to preview rule matching and metadata output.',
  },
  reindex: { description: REINDEX_DESCRIPTION },
  scan: {
    description:
      'Filter-only point query without vector search. Returns metadata for points matching a Qdrant filter. Use for structural queries: file enumeration, staleness checks, delta computation. Use watcher_search for semantic/similarity queries. This is a direct tool: call it directly, never through tool_call.',
    catalogMode: 'direct-only',
  },
  listIssues: {
    description:
      'Get runtime processing failures. Shows the documents (file path or source reference) that failed processing and why.',
  },
  walk: {
    description:
      'Walk watched filesystem paths with glob intersection. Returns matching file paths from all configured watch roots, applying watch.ignored and gitignore filtering.',
  },
  getVcsStatus: {
    description:
      'Get version tracking health: enabled state, tracked roots, remote status, last activity',
  },
  listVcsHistory: {
    description:
      'Query change history by path or glob with optional date range',
  },
  showVcsFile: { description: 'Retrieve file content at a specific version' },
  diffVcs: {
    description:
      'Show what changed between two versions, or between a version and current',
  },
  revertVcs: {
    description: 'Undo changes by restoring files to a specific version',
  },
  excludeVcsPath: { description: VCS_EXCLUDE_DESCRIPTION },
  checkVcsExclusion: { description: VCS_CHECK_DESCRIPTION },
} as const satisfies Partial<Record<EntryName, CatalogToolSelection>>;

/** The standard tools, in their 0.17.0 registration order. */
const STANDARD_TOOLS = [
  'watcher_status',
  'watcher_service',
  'watcher_config',
  'watcher_config_apply',
] as const;

/** Every tool the plugin registers, in registration order (0.17.0 order). */
export const WATCHER_TOOL_NAMES: readonly string[] = [
  ...STANDARD_TOOLS,
  ...Object.keys(WATCHER_TOOL_SELECTION).map((entry) =>
    toToolName('watcher', entry),
  ),
];

/**
 * Core's toolset for the watcher: the four standard tools and the 14 domain
 * tools. The base URL and the bearer key are resolved from `api` on every
 * call.
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
    tools: WATCHER_TOOL_SELECTION,
  });
  return new Map(
    tools.map((tool) => [
      tool.name,
      tool.name === 'watcher_reindex' ? withDefaultScope(tool) : tool,
    ]),
  );
}

/**
 * `watcher_reindex` with 0.17.0's default scope: a call without `scope` sends
 * {@link REINDEX_DEFAULT_SCOPE}, so agents see no change from 0.17.0.
 *
 * @param tool - The catalog-built reindex tool.
 * @returns The same tool, defaulting `scope`.
 */
function withDefaultScope(tool: ToolDescriptor): ToolDescriptor {
  return {
    ...tool,
    execute: (id, params) =>
      tool.execute(id, { scope: REINDEX_DEFAULT_SCOPE, ...params }),
  };
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
