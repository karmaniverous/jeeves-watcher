---
name: jeeves-watcher
description: >
  Semantic search and metadata enrichment via a jeeves-watcher instance.
  Use when you need to search indexed documents, discover available metadata
  fields, filter by payload values, or enrich document metadata.
---

# Jeeves Watcher Skill

## Tools

### `watcher_status`

Get service health, collection stats, and discover available payload fields.

| Parameter | Type | Required | Description |
| --------- | ---- | -------- | ----------- |
| _(none)_  |      |          |             |

**Example:**

```json
{}
```

**Returns:** `status`, `uptime`, `collection` (name, pointCount, dimensions), `payloadFields` (field names → types).

### `watcher_search`

Semantic similarity search over indexed documents with optional Qdrant filters.

| Parameter | Type   | Required | Description                          |
| --------- | ------ | -------- | ------------------------------------ |
| `query`   | string | yes      | Natural-language search query        |
| `limit`   | number | no       | Max results to return (default: 10)  |
| `filter`  | object | no       | Qdrant filter object (see below)     |

**Example (plain search):**

```json
{ "query": "authentication flow", "limit": 5 }
```

**Example (filtered search):**

```json
{
  "query": "error handling",
  "limit": 10,
  "filter": {
    "must": [{ "key": "domain", "match": { "value": "backend" } }]
  }
}
```

### `watcher_enrich`

Set or update metadata on a document by file path.

| Parameter  | Type   | Required | Description                         |
| ---------- | ------ | -------- | ----------------------------------- |
| `path`     | string | yes      | Relative file path of the document  |
| `metadata` | object | yes      | Key-value metadata to set           |

**Example:**

```json
{
  "path": "docs/auth.md",
  "metadata": { "domain": "auth", "reviewed": true }
}
```

## Schema Discovery

Always call `watcher_status` first to discover available payload fields and their types. This tells you what fields exist in the collection and can be used in filters.

## Qdrant Filter Patterns

### Single field match (exact)

```json
{ "must": [{ "key": "domain", "match": { "value": "email" } }] }
```

### Multi-field filter

Combine conditions in the `must` array:

```json
{
  "must": [
    { "key": "domain", "match": { "value": "backend" } },
    { "key": "language", "match": { "value": "typescript" } }
  ]
}
```

### Negation

Use `must_not` to exclude results:

```json
{
  "must_not": [{ "key": "status", "match": { "value": "archived" } }]
}
```

### Full-text vs exact match

- **Exact match:** `{ "key": "domain", "match": { "value": "email" } }` — matches the exact value.
- **Full-text match:** `{ "key": "content", "match": { "text": "authentication" } }` — tokenized substring match on text fields.

## Search Strategies

1. **Start broad:** Use a plain query without filters to gauge what's available.
2. **Then narrow:** Add filters based on payload fields discovered via `watcher_status`.
3. **Interpreting scores:** Higher scores (closer to 1.0) indicate stronger semantic similarity. Scores below 0.3 are usually noise.
4. **Grouping chunks:** Multiple results may come from the same file (check the `path` payload field). Group them to get the full picture.

## Workflow Patterns

### Find then read

1. Search for relevant documents with `watcher_search`.
2. Read the actual files using the `path` from search results.
3. Use the file contents for deeper analysis.

### Find and summarize

1. Search with a focused query and reasonable limit (5–10).
2. Summarize the returned payload content directly from search results.

### Enrichment

Use `watcher_enrich` when you want to tag documents with metadata for future filtering — e.g., after reviewing a document, set `{ "reviewed": true, "domain": "auth" }` so future searches can filter by those fields.
