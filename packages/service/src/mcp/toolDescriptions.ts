/**
 * @module mcp/toolDescriptions
 * Tool descriptions: what each tool is for and when to use it, beyond the catalog's one-line entry descriptions. The text is shared with the OpenClaw plugin's (`packages/openclaw/src/catalogTools.ts` `WATCHER_TOOL_SELECTION`, jeeves core's standard tools), without its harness-specific sentence ("This is a direct tool: call it directly, never through tool_call").
 *
 * @remarks
 * Duplicated text: a candidate to move into watcher-core's catalog so both
 * packages generate it.
 */

import { VCS_EXCLUDE_CONFIRM_THRESHOLD } from '@karmaniverous/jeeves-watcher-core';

/** Description of each tool, keyed by catalog entry name. */
export const WATCHER_TOOL_DESCRIPTIONS = {
  status: 'Get watcher service health, version, and uptime.',
  config: 'Query watcher running configuration. Optional JSONPath filter.',
  configApply: 'Apply a config patch to the running watcher service.',
  search: 'Semantic search over indexed documents. Supports Qdrant filters.',
  setMetadata:
    'Set or update metadata on a document by file path or source reference.',
  validateConfig:
    'Validate a candidate config (or current config if omitted). Optionally test file paths against the config to preview rule matching and metadata output.',
  reindex:
    'Trigger a reindex of the watched files. Without scope, re-applies inference rules (scope "rules"); the HTTP API\'s own default is "issues".',
  scan: 'Filter-only point query without vector search. Returns metadata for points matching a Qdrant filter. Use for structural queries: file enumeration, staleness checks, delta computation. Use watcher_search for semantic/similarity queries.',
  listIssues:
    'Get runtime processing failures. Shows the documents (file path or source reference) that failed processing and why.',
  walk: 'Walk watched filesystem paths with glob intersection. Returns matching file paths from all configured watch roots, applying watch.ignored and gitignore filtering.',
  getVcsStatus:
    'Get version tracking health: enabled state, tracked roots, remote status, last activity',
  listVcsHistory:
    'Query change history by path or glob with optional date range',
  showVcsFile: 'Retrieve file content at a specific version',
  diffVcs:
    'Show what changed between two versions, or between a version and current',
  revertVcs: 'Undo changes by restoring files to a specific version',
  excludeVcsPath: `Exclude a path from version history (VCS-only: it stays in search), or remove the exclusion. Adding untracks the files the pattern matches, ending their history. Without confirm: true, more than ${String(VCS_EXCLUDE_CONFIRM_THRESHOLD)} files return { confirmRequired: true, untracked } and change nothing: check the count with the user, then repeat with confirm: true. A timeout does not cancel the exclusion: check the outcome with watcher_check_vcs_exclusion before retrying.`,
  checkVcsExclusion:
    'Check whether git ignores a path and why: the rule, the file holding it and its line',
  listFacets:
    'List the search facets: every field a rule schema gives a uiHint or enum, with its type, uiHint, rules and values (the declared enum, else values recorded per rule for dropdown, tags, select and multiselect; never per tenant). With rules, only those rules. Build Qdrant filters for watcher_search and watcher_scan from them.',
  countFacets:
    'Count documents per value of facet fields under an optional Qdrant filter (each document once; counts are approximate), or { min, max } for number, date and range fields. Each field needs a payload index (400 names the ones without); 503 while the system indexes build (retry later) or past the time budget (count fewer fields or narrow the filter). Use it for "how many per value" questions and for tenant-scoped value lists.',
  render:
    'Render a document through the inference rules it matches: its rendered content, output format, matching rules and resulting metadata. Takes exactly one of a file path (the whole file is read) or a source reference (fetched through its callback).',
  matchConfig:
    'Test file paths against the inference rules and watch scope without reading the files: per path, the matching rule names and whether the path is watched.',
} as const;
