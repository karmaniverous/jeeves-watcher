---
title: OpenClaw Integration Guide
---

# OpenClaw Integration Guide

The `@karmaniverous/jeeves-watcher-openclaw` plugin gives your OpenClaw agent access to jeeves-watcher's semantic search, metadata enrichment, and management capabilities.

## Installation

### Standard (OpenClaw CLI)

```bash
openclaw plugins install @karmaniverous/jeeves-watcher-openclaw
```

### Self-Installer

OpenClaw's `plugins install` command has a known bug on Windows where it fails with `spawn EINVAL` or `spawn npm ENOENT` ([#9224](https://github.com/openclaw/openclaw/issues/9224), [#4557](https://github.com/openclaw/openclaw/issues/4557), [#6086](https://github.com/openclaw/openclaw/issues/6086)). This package includes a self-installer that works around the issue:

```bash
npx @karmaniverous/jeeves-watcher-openclaw install
```

The installer:

1. Copies the plugin into OpenClaw's extensions directory (`~/.openclaw/extensions/jeeves-watcher-openclaw/`)
2. Adds the plugin to `plugins.entries` in `openclaw.json`
3. If `plugins.allow` or `tools.allow` are already populated (explicit allowlists), adds the plugin to those lists

To remove:

```bash
npx @karmaniverous/jeeves-watcher-openclaw uninstall
```

#### Non-default installations

If OpenClaw is installed at a non-default location, set one of these environment variables:

| Variable | Description |
|----------|-------------|
| `OPENCLAW_CONFIG` | Full path to `openclaw.json` (overrides all other detection) |
| `OPENCLAW_HOME` | Path to the `.openclaw` directory |

Default location: `~/.openclaw/openclaw.json`

After install or uninstall, restart the OpenClaw gateway to apply changes.

## Configuration

The plugin needs the URL of a running jeeves-watcher REST API. Set `apiUrl` in the plugin config:

```json
{
  "apiUrl": "http://127.0.0.1:3458"
}
```

## Available Tools

### `watcher_status`

Returns service health, uptime, and Qdrant collection statistics. No parameters required.

### `watcher_search`

Semantic search across all indexed documents. Pass a natural-language query and optional filters.

**Parameters:**

- `query` (string, required) — search text
- `limit` (number) — max results (default: 10)
- `filter` (object) — Qdrant filter conditions

### `watcher_enrich`

Run the rules engine against a document to infer or update metadata fields.

### `watcher_query`

Execute a raw Qdrant query with full filter support. Useful for precise metadata-based lookups.

### `watcher_validate`

Validate a jeeves-watcher configuration object. Returns validation errors if any.

### `watcher_config_apply`

Apply a new configuration to the running watcher service. Triggers re-evaluation of watched paths and rules.

### `watcher_reindex`

Trigger a full reindex of all watched files. Useful after configuration changes or to recover from drift.

### `memory_search`

Semantically search MEMORY.md and memory/*.md files. Powered by the watcher's vector store with Gemini 3072-dim embeddings.

**Parameters:**

- `query` (string, required) — search query text
- `maxResults` (number) — maximum results to return
- `minScore` (number) — minimum similarity score threshold

### `memory_get`

Read content from MEMORY.md or memory/*.md files with optional line range.

**Parameters:**

- `path` (string, required) — path to the memory file
- `from` (number) — line number to start reading from (1-indexed)
- `lines` (number) — number of lines to read

Path validation: only files within the workspace's MEMORY.md and memory/**/*.md are accessible.

### `watcher_issues`

List current indexing issues — files that failed extraction, embedding errors, etc.

## Example Usage Patterns

### Search for relevant documents

> "Search the watcher for documents about authentication configuration"

The agent calls `watcher_search` with the query and returns matching document chunks with their source paths and metadata.

### Check service health

> "Is the watcher service running? How many documents are indexed?"

The agent calls `watcher_status` and reports uptime, health, and collection point count.

### Investigate indexing problems

> "Are there any files that failed to index?"

The agent calls `watcher_issues` and summarizes any errors or warnings.

### Reindex after config change

> "I updated the watcher config — please reindex everything"

The agent calls `watcher_config_apply` (if a new config is provided) followed by `watcher_reindex`.
