---
title: OpenClaw Integration Guide
---

# OpenClaw Integration Guide

The `@karmaniverous/jeeves-watcher-openclaw` plugin gives your OpenClaw agent access to jeeves-watcher's semantic search, metadata enrichment, and management capabilities.

## Installation

```bash
openclaw plugins install @karmaniverous/jeeves-watcher-openclaw
```

## Configuration

The plugin needs the URL of a running jeeves-watcher REST API. Set `apiUrl` in the plugin config:

```json
{
  "apiUrl": "http://localhost:3000"
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
