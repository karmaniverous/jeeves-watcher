/**
 * @module mcp/mcpContent
 * What an MCP client's model reads besides the tools: the server instructions (the watcher's always-on rules, written for any agent harness) and a preface for the skill resource. Pure.
 *
 * @remarks
 * The instructions are this package's own: the shared `WATCHER_PROMPT_RULES`
 * name tools of one harness (`memory_search`, `exec`), which MCP clients do
 * not have. The skill is watcher-core's `WATCHER_SKILL`, served whole; its
 * preface lists the sections that do not apply over MCP.
 */

/** Arguments the content needs. */
export interface McpContentOptions {
  /** URI of the skill resource. */
  skillUri: string;
  /** Number of tools the server exposes. */
  toolCount: number;
}

/**
 * The server instructions: the watcher's always-on rules for any agent.
 *
 * @param options - Skill URI.
 * @returns Markdown.
 */
export function mcpInstructions({ skillUri }: McpContentOptions): string {
  return [
    '## Watcher',
    'The `watcher_*` tools search and manage a semantic index of the document archive.',
    '- **Search first:** when looking for information in indexed paths, or before reading or changing files there, call `watcher_search` before grep, file reads or shell commands, even when you already know the path. Use the filesystem to act on search results, not to bypass them.',
    '- **Scan for structure:** for enumeration, counts, staleness checks or listing by metadata, use `watcher_scan` (a Qdrant filter, no query string, no embeddings) or `watcher_count_facets`. `watcher_list_facets` gives the fields and values to filter on.',
    '- **Scores:** strong / relevant / noise thresholds apply only when configured at `$.search.scoreThresholds` (read it with `watcher_config`); there are no defaults. When configured, discard noise; if every result is noise, broaden the query.',
    '- **Inventory on demand (`watcher_config`):** inference rules `$.inferenceRules[*]`, watched paths `$.watch.paths[*]`, ignored paths `$.watch.ignored[*]`. Version history: `watcher_list_vcs_history`, `watcher_diff_vcs`, `watcher_show_vcs_file`.',
    `- **Skill:** read the resource \`${skillUri}\` before configuring, reindexing, building filters or diagnosing errors.`,
  ].join('\n');
}

/**
 * Preface inserted after the skill's front matter.
 *
 * @param options - Tool count.
 * @returns Markdown.
 */
export function skillPreface({ toolCount }: McpContentOptions): string {
  return [
    "> **Using this skill over MCP.** This server has the skill's `watcher_*` tools (" +
      String(toolCount) +
      ' of them), so its guidance on search, filters, config, reindexing and diagnostics applies as written. Skip the parts about the OpenClaw plugin:',
    "> - Plugin installation and `openclaw.json` settings (`plugins.entries.jeeves-watcher-openclaw.config.*`). Here the MCP endpoint is the watcher's own `/mcp`, and the API key (the watcher's `api.apiKey`) is the `Authorization: Bearer` header in the MCP client config.",
    '> - `watcher_service`: not a tool here. The user manages the service with the `jeeves-watcher service` CLI.',
    '> - Error text: a failed call starts with `Error: `; an unreachable watcher reads `Error: service not reachable: <reason>`.',
  ].join('\n');
}

/** Front matter at the start of a skill: `---` ... `---` and its line break. */
const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

/**
 * The skill with the preface inserted after its front matter (or at the
 * start when it has none).
 *
 * @param skill - Skill markdown.
 * @param options - Skill URI and tool count.
 * @returns Markdown.
 */
export function withSkillPreface(
  skill: string,
  options: McpContentOptions,
): string {
  const head = FRONT_MATTER.exec(skill)?.[0] ?? '';
  return `${head}\n${skillPreface(options)}\n\n${skill.slice(head.length)}`;
}
