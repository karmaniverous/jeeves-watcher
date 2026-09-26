/**
 * @module plugin/promptContext
 * Always-in-context watcher rules, injected via `before_prompt_build`.
 *
 * @remarks
 * Replaces the v0.x TOOLS.md `## Watcher` section that core's
 * `ComponentWriter` wrote on a timer. The rules are static; live numbers
 * (point counts, configured score thresholds, VCS roots) are served by
 * `watcher_status` and `watcher_config`, and detail lives in the skill.
 */

import { type PluginApi, registerPromptContext } from '@karmaniverous/jeeves';

/** Static watcher rules the agent must see on every turn. */
export const WATCHER_PROMPT_CONTEXT = [
  '## Watcher',
  'This environment includes a semantic search index over the document archive (`watcher_search`).',
  '- **Escalation rule:** Use `memory_search` for personal operational notes, decisions, and rules. Escalate to `watcher_search` when memory is thin, or when searching the broader archive (tickets, docs, code). ALWAYS use `watcher_search` BEFORE filesystem commands (exec, grep) when looking for information in indexed paths.',
  '- **Scan-first rule:** For structural queries (file enumeration, staleness checks, domain listing, counts), use `watcher_scan` instead of `watcher_search`. Scan does not use embeddings and does not accept a query string.',
  '- **Search-first rule:** When finding, reading, or modifying files in indexed paths, run `watcher_search` FIRST, even if you already know the file path. Direct filesystem access is for acting on search results, not bypassing them.',
  '- **Scores:** strong / relevant / noise thresholds are configured at `$.search.scoreThresholds` (query with `watcher_config`; defaults 0.75 / 0.5 / 0.25). Discard noise; if all results are noise, broaden the query.',
  '- **Inventory on demand (`watcher_config`):** inference rules `$.inferenceRules[*]`, watched paths `$.watch.paths[*]`, ignored paths `$.watch.ignored[*]`. Version history: `watcher_vcs_*` tools. See the jeeves-watcher skill for detail.',
].join('\n');

/**
 * Register the watcher rules with OpenClaw's `before_prompt_build` hook.
 *
 * @returns `true` when the hook was registered.
 */
export function registerWatcherPromptContext(api: PluginApi): boolean {
  return registerPromptContext(api, { content: WATCHER_PROMPT_CONTEXT });
}
