/**
 * @module api/mcp/registerWatcherMcp
 * The watcher's MCP endpoint (`/mcp`, #282): jeeves's `registerMcpEndpoint` over `WATCHER_CATALOG`, with the watcher's tool selection, its always-on rules as instructions and `WATCHER_SKILL` as a resource. `@modelcontextprotocol/server` is an optional peer: `@karmaniverous/jeeves/mcp` is imported only here, when the API server boots, and the endpoint is skipped (one log line) when the peer is not installed.
 */

import type * as JeevesMcp from '@karmaniverous/jeeves/mcp';
import {
  WATCHER_CATALOG,
  WATCHER_SKILL,
  type WatcherCatalog,
} from '@karmaniverous/jeeves-watcher-core';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';

import {
  type McpContentOptions,
  mcpInstructions,
  withSkillPreface,
} from './mcpContent';

/** URI of the skill resource. */
export const SKILL_URI = 'skill://jeeves-watcher/SKILL.md';

/** `watcher_status`'s timeout: a health probe answers fast or not at all (5 s, core spec 5.7). */
export const STATUS_TIMEOUT_MS = 5_000;

/** The MCP server library `/mcp` needs (an optional peer). */
export const MCP_PEER = '@modelcontextprotocol/server';

/**
 * The tools: every catalog entry an agent works with (search, scan, facets,
 * render, metadata, config, reindex, issues, walk, version history), with
 * the catalog's descriptions. Destructive housekeeping (`deletePoints`,
 * `deleteDocuments`, `unregisterRules*`), the source-owner entries
 * (`notifyDocuments`, `registerRules`), `rebuildMetadata` and
 * `getConfigSchema` are not tools.
 */
export const WATCHER_MCP_TOOLS = {
  status: { timeoutMs: STATUS_TIMEOUT_MS },
  config: true,
  configApply: { inputAliases: { patch: 'config' } },
  search: true,
  setMetadata: true,
  validateConfig: true,
  reindex: { defaults: { scope: 'rules' } },
  scan: true,
  listIssues: true,
  walk: true,
  getVcsStatus: true,
  listVcsHistory: true,
  showVcsFile: true,
  diffVcs: true,
  revertVcs: true,
  excludeVcsPath: true,
  checkVcsExclusion: true,
  listFacets: true,
  countFacets: true,
  render: true,
  matchConfig: true,
} as const satisfies JeevesMcp.McpEndpointOptions<WatcherCatalog>['tools'];

/** What the instructions and skill preface need. */
const CONTENT_OPTIONS: McpContentOptions = {
  skillUri: SKILL_URI,
  toolCount: Object.keys(WATCHER_MCP_TOOLS).length,
};

/**
 * The watcher's endpoint options: catalog, tools, instructions and skill.
 *
 * @param version - Server version reported to clients.
 * @returns The options for `registerMcpEndpoint`.
 */
export function watcherMcpOptions(
  version: string,
): JeevesMcp.McpEndpointOptions<WatcherCatalog> {
  return {
    name: 'jeeves-watcher',
    version,
    catalog: WATCHER_CATALOG,
    prefix: 'watcher',
    tools: WATCHER_MCP_TOOLS,
    instructions: mcpInstructions(CONTENT_OPTIONS),
    skill: {
      uri: SKILL_URI,
      name: 'jeeves-watcher',
      text: withSkillPreface(WATCHER_SKILL, CONTENT_OPTIONS),
    },
  };
}

/** Options for {@link registerWatcherMcp}. */
export interface WatcherMcpOptions {
  /** Server version reported to clients. */
  version: string;
  /** The watcher's logger. */
  logger: Pick<Logger, 'info'>;
  /** Loads the MCP entry point; default the dynamic import (tests replace it). */
  load?: () => Promise<typeof JeevesMcp>;
}

/**
 * Whether an import failed because the MCP server library is not installed.
 *
 * @param error - The import error.
 * @returns `true` for a missing `@modelcontextprotocol/server`.
 */
function isMissingPeer(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND' &&
    error.message.includes(MCP_PEER)
  );
}

/**
 * Register `/mcp` on the watcher's app, after its auth hook. A Fastify
 * plugin, so the import runs when the app boots (`ready`/`listen`), not when
 * the app is created.
 *
 * @param app - The watcher's Fastify app.
 * @param options - Version, logger and loader.
 */
export function registerWatcherMcp(
  app: FastifyInstance,
  options: WatcherMcpOptions,
): void {
  const { load = () => import('@karmaniverous/jeeves/mcp') } = options;
  void app.register(async (instance) => {
    let mcp;
    try {
      mcp = await load();
    } catch (error) {
      if (!isMissingPeer(error)) throw error;
      options.logger.info(
        `MCP endpoint disabled: install ${MCP_PEER} to serve /mcp`,
      );
      return;
    }
    mcp.registerMcpEndpoint(instance, watcherMcpOptions(options.version));
  });
}
