---
name: jeeves-watcher
description: >
  Semantic search and metadata enrichment via a jeeves-watcher instance.
  Use when you need to search indexed documents, discover available metadata
  fields, filter by payload values, or enrich document metadata.
---

# jeeves-watcher — Search & Discovery

## Quick Start

1. **Orient yourself** — call `watcher_query` with path `$.inferenceRules[*].['name','description']` to see what's indexed, and `$.search.scoreThresholds` for score interpretation.
2. **Search** — use `watcher_search` with a natural language query. Add `filter` for precision.
3. **Read source** — use `read` with the `file_path` from results for full context.

## Tools

### `watcher_search`
Semantic search over indexed documents.
- `query` (string, required) — natural language search query
- `limit` (number, optional) — max results, default 10
- `offset` (number, optional) — skip N results for pagination
- `filter` (object, optional) — Qdrant filter for metadata filtering

### `watcher_enrich`
Set or update metadata on a document.
- `path` (string, required) — file path of the document
- `metadata` (object, required) — key-value metadata to merge

### `watcher_status`
Service health check. Returns uptime, collection stats, reindex status.

### `watcher_query`
Query the merged virtual document via JSONPath.
- `path` (string, required) — JSONPath expression
- `resolve` (string[], optional) — `["files"]`, `["globals"]`, or both

{{> qdrant-filters.md}}

{{> search-results.md}}

{{> jsonpath-patterns.md}}

## Search Strategies

- **Broad search first:** Start with just a query, no filter. Review results to understand what's available.
- **Filter for precision:** Once you know the domain/field values, add filters to narrow results.
- **Score interpretation:** Check `$.search.scoreThresholds` via `watcher_query`. Scores below the noise threshold are unlikely to be relevant.
- **Chunk grouping:** Multiple results with the same `file_path` are chunks of one document. Read the full file for complete context.
- **Find then read:** Search gives you chunks; use `read` with `file_path` for the complete document.

## Enrichment

Use `watcher_enrich` to tag documents after analysis (e.g., `reviewed: true`, project labels). Metadata is validated against the file's matched rule schemas. Validation errors return structured messages.

## Memory Recall

If `$.slots.memory` is present during orientation, this instance indexes memory files. Before answering questions about prior work, decisions, dates, people, preferences, or todos:

1. Search with `watcher_search` using the memory slot filter
2. Use `read` with offset/limit for full context from matched files
3. Include `Source: <file_path>` citations in your response

## Error Handling

If the watcher is unreachable:
- Inform the user that semantic search is temporarily unavailable
- Fall back to direct `read` for known file paths
- Do not retry silently in a loop
