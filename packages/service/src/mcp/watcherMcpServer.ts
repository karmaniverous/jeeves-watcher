/**
 * @module mcp/watcherMcpServer
 * The watcher's MCP server: tools generated from `WATCHER_CATALOG`, the watcher's always-on rules as instructions and `WATCHER_SKILL` as a resource, each tool call sent through a `CatalogTransport` (the watcher's own routes, `injectTransport`).
 */

import { DEFAULT_FETCH_TIMEOUT_MS } from '@karmaniverous/jeeves';
import type { CatalogTransport } from '@karmaniverous/jeeves/catalog';
import {
  WATCHER_CATALOG,
  WATCHER_SKILL,
  type WatcherCatalog,
} from '@karmaniverous/jeeves-watcher-core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  type CatalogMcpServerOptions,
  type CatalogMcpToolOptions,
  createCatalogMcpServer,
} from './catalogMcpServer';
import {
  type McpContentOptions,
  mcpInstructions,
  withSkillPreface,
} from './mcpContent';
import { WATCHER_TOOL_DESCRIPTIONS } from './toolDescriptions';

/** URI of the skill resource. */
export const SKILL_URI = 'skill://jeeves-watcher/SKILL.md';

/** `watcher_status`'s timeout: a health probe answers fast or not at all (5 s, core spec 5.7). */
export const STATUS_TIMEOUT_MS = 5_000;

/** Per-tool options beyond the description: the status probe timeout, and the alias and reindex default the skill documents. */
const TOOL_OPTIONS: Partial<
  Record<keyof typeof WATCHER_TOOL_DESCRIPTIONS, CatalogMcpToolOptions>
> = {
  status: { timeoutMs: STATUS_TIMEOUT_MS },
  configApply: { inputAliases: { patch: 'config' } },
  reindex: { defaults: { scope: 'rules' } },
};

/**
 * The tools: every catalog entry an agent works with (search, scan, facets,
 * render, metadata, config, reindex, issues, walk, version history).
 * Destructive housekeeping (`deletePoints`, `deleteDocuments`,
 * `unregisterRules*`), the source-owner entries (`notifyDocuments`,
 * `registerRules`), `rebuildMetadata` and `getConfigSchema` are not tools.
 */
export const WATCHER_MCP_TOOLS: CatalogMcpServerOptions<WatcherCatalog>['tools'] =
  Object.fromEntries(
    Object.entries(WATCHER_TOOL_DESCRIPTIONS).map(([entry, description]) => [
      entry,
      {
        description,
        ...TOOL_OPTIONS[entry as keyof typeof WATCHER_TOOL_DESCRIPTIONS],
      },
    ]),
  );

/** What the instructions and skill preface need. */
const CONTENT_OPTIONS: McpContentOptions = {
  skillUri: SKILL_URI,
  toolCount: Object.keys(WATCHER_TOOL_DESCRIPTIONS).length,
};

/** Options for {@link createWatcherMcpServer}. */
export interface WatcherMcpServerOptions {
  /** Server version reported to clients. */
  version: string;
  /** Where tool calls go: the watcher's own routes, with the caller's credentials. */
  transport: CatalogTransport;
}

/**
 * Create the watcher MCP server.
 *
 * @param options - Version and transport.
 * @returns The server, ready to connect to an MCP transport.
 */
export function createWatcherMcpServer(
  options: WatcherMcpServerOptions,
): McpServer {
  return createCatalogMcpServer({
    name: 'jeeves-watcher',
    version: options.version,
    catalog: WATCHER_CATALOG,
    prefix: 'watcher',
    tools: WATCHER_MCP_TOOLS,
    transport: options.transport,
    timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
    instructions: mcpInstructions(CONTENT_OPTIONS),
    skill: {
      uri: SKILL_URI,
      name: 'jeeves-watcher',
      text: withSkillPreface(WATCHER_SKILL, CONTENT_OPTIONS),
    },
  });
}
