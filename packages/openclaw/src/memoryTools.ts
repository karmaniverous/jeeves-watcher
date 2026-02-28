/**
 * @module plugin/memoryTools
 * memory_search and memory_get tool implementations with lazy init.
 *
 * Lazy init registers virtual inference rules with the watcher on first
 * memory_search call. Re-attempts on failure. memory_get reads files
 * directly from the filesystem with path validation.
 */

import { readFile } from 'node:fs/promises';

import {
  connectionFail,
  fail,
  fetchJson,
  getPluginSchemas,
  getWorkspacePath,
  normalizePath,
  ok,
  PLUGIN_SOURCE,
  type PluginApi,
  postJson,
  type ToolResult,
} from './helpers.js';

/** State for lazy init. */
interface InitState {
  initialized: boolean;
  lastWatcherUptime: number;
  workspace: string;
  baseUrl: string;
}

/** Private property prefix — namespaces plugin metadata to avoid collisions. */
const PROP_PREFIX = '_jeeves_watcher_openclaw_';

/** Private property keys used by the plugin for filtering. */
export const PROP_SOURCE = `${PROP_PREFIX}source_`;
export const PROP_KIND = `${PROP_PREFIX}kind_`;

/** Memory source value for filter queries. */
export const SOURCE_MEMORY = 'memory';

/** Virtual rule names (exported for testing and config reference). */
export const RULE_LONGTERM = 'openclaw-memory-longterm';
export const RULE_DAILY = 'openclaw-memory-daily';

/**
 * Build virtual inference rules for a workspace path.
 *
 * Each rule's schema is composed of:
 * 1. Plugin-internal schema (private namespaced properties, no uiHint)
 * 2. User-supplied schemas from plugin config (optional, owner-controlled)
 */
function buildVirtualRules(
  workspace: string,
  userSchemas: Record<string, Array<Record<string, unknown> | string>>,
) {
  const ws = normalizePath(workspace);

  const longtermInternal = {
    type: 'object' as const,
    properties: {
      [PROP_SOURCE]: { type: 'string', set: SOURCE_MEMORY },
      [PROP_KIND]: { type: 'string', set: 'long-term' },
    },
  };

  const dailyInternal = {
    type: 'object' as const,
    properties: {
      [PROP_SOURCE]: { type: 'string', set: SOURCE_MEMORY },
      [PROP_KIND]: { type: 'string', set: 'daily-log' },
    },
  };

  return [
    {
      name: RULE_LONGTERM,
      description: 'OpenClaw long-term memory file',
      match: {
        properties: {
          file: {
            properties: {
              path: { glob: `${ws}/MEMORY.md` },
            },
          },
        },
      },
      schema: [
        longtermInternal,
        ...(userSchemas[RULE_LONGTERM] ?? []),
      ],
    },
    {
      name: RULE_DAILY,
      description: 'OpenClaw daily memory logs',
      match: {
        properties: {
          file: {
            properties: {
              path: { glob: `${ws}/memory/**/*.md` },
            },
          },
        },
      },
      schema: [
        dailyInternal,
        ...(userSchemas[RULE_DAILY] ?? []),
      ],
    },
  ];
}

/** Validate a path is within the memory scope. */
function isAllowedMemoryPath(filePath: string, workspace: string): boolean {
  const norm = normalizePath(filePath).toLowerCase();
  const ws = normalizePath(workspace).toLowerCase();

  // Exact match: {workspace}/MEMORY.md
  if (norm === `${ws}/memory.md`) return true;

  // Prefix match: {workspace}/memory/**/*.md
  if (norm.startsWith(`${ws}/memory/`) && norm.endsWith('.md')) return true;

  return false;
}

/**
 * Create memory tool registrations for the plugin.
 * Returns register functions for memory_search and memory_get.
 */
export function createMemoryTools(api: PluginApi, baseUrl: string) {
  const workspace = getWorkspacePath(api);
  const userSchemas = getPluginSchemas(api);
  const state: InitState = {
    initialized: false,
    lastWatcherUptime: 0,
    workspace,
    baseUrl,
  };

  /** Lazy init: register virtual rules with watcher. */
  async function ensureInit(): Promise<void> {
    // Check watcher is reachable and detect restarts
    const status = (await fetchJson(`${state.baseUrl}/status`)) as {
      uptime?: number;
    };
    const uptime = status.uptime ?? 0;

    // If watcher restarted (uptime decreased), re-register virtual rules
    if (state.initialized && uptime >= state.lastWatcherUptime) return;
    state.lastWatcherUptime = uptime;

    // Clear any stale rules
    await fetchJson(`${state.baseUrl}/rules/unregister`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: PLUGIN_SOURCE }),
    });

    // Register virtual rules
    const virtualRules = buildVirtualRules(state.workspace, userSchemas);
    await postJson(`${state.baseUrl}/rules/register`, {
      source: PLUGIN_SOURCE,
      rules: virtualRules,
    });

    // Re-apply rules to already-indexed files matching virtual rule globs
    const globs = virtualRules
      .map((r) => {
        const path = r.match.properties.file.properties.path as Record<
          string,
          unknown
        >;
        return typeof path.glob === 'string' ? path.glob : undefined;
      })
      .filter((g): g is string => g !== undefined);

    if (globs.length > 0) {
      try {
        await postJson(`${state.baseUrl}/rules/reapply`, { globs });
      } catch {
        // Non-fatal: files will get correct rules on next change
      }
    }

    state.initialized = true;
  }

  const memorySearch = async (
    _id: string,
    params: Record<string, unknown>,
  ): Promise<ToolResult> => {
    try {
      await ensureInit();

      const body: Record<string, unknown> = {
        query: params.query,
        filter: {
          must: [{ key: PROP_SOURCE, match: { value: SOURCE_MEMORY } }],
        },
      };
      if (params.maxResults !== undefined) body.limit = params.maxResults;

      const raw = await postJson(`${state.baseUrl}/search`, body);

      // Map results to system-prompt-compatible format
      const results = (raw as Array<Record<string, unknown>>).map((r) => {
        const payload = r.payload as Record<string, unknown>;
        const mapped: Record<string, unknown> = {
          path: payload.file_path,
          snippet: payload.chunk_text,
          score: r.score,
        };
        if (payload.line_start != null) mapped.from = payload.line_start;
        if (payload.line_end != null) mapped.to = payload.line_end;
        return mapped;
      });

      const minScore =
        typeof params.minScore === 'number' ? params.minScore : 0;
      const filtered = results.filter(
        (r) => typeof r.score === 'number' && r.score >= minScore,
      );

      return ok(filtered);
    } catch (error) {
      state.initialized = false;
      return connectionFail(error, state.baseUrl);
    }
  };

  const memoryGet = async (
    _id: string,
    params: Record<string, unknown>,
  ): Promise<ToolResult> => {
    try {
      const filePath = String(params.path);

      // Re-derive workspace on every call for immediate pickup of moves
      const currentWorkspace = getWorkspacePath(api);
      if (!isAllowedMemoryPath(filePath, currentWorkspace)) {
        return fail(
          `Path not within memory scope. Allowed: ${currentWorkspace}/MEMORY.md and ${currentWorkspace}/memory/**/*.md`,
        );
      }

      const content = await readFile(filePath, 'utf-8');

      if (params.from !== undefined) {
        const from = Number(params.from);
        const lines = content.split('\n');
        const startIdx = Math.max(0, from - 1); // 1-indexed to 0-indexed
        const count =
          params.lines !== undefined
            ? Number(params.lines)
            : lines.length - startIdx;
        const sliced = lines.slice(startIdx, startIdx + count);
        return ok(sliced.join('\n'));
      }

      return ok(content);
    } catch (error) {
      return fail(error);
    }
  };

  return { memorySearch, memoryGet };
}
