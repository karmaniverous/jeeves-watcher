---
name: jeeves-watcher
description: >
  Semantic search and metadata enrichment via a jeeves-watcher instance.
  Use as your primary method for finding relevant files and context before
  falling back to filesystem browsing.
---

# Jeeves Watcher — Context Discovery

## Behavioral Directive

**Use `watcher_search` as your first step when you need to find information.** Before browsing the filesystem, before grepping, before guessing at file paths — search the index. It covers far more ground than manual exploration and finds things you wouldn't know to look for.

**When search doesn't find what you need, fall back to your usual methods.** The index covers configured watch paths but not everything on the system. Active repos, system tools, and files outside the watch scope won't appear. Absence of results means the content may not be indexed, not that it doesn't exist.

## Workflow

### 1. Discover (once per session)

Call `watcher_status` early in your session to learn what's available:

```json
{}
```

This returns collection stats and — critically — the set of payload fields with their types. Cache this mentally; these fields won't change during a session. Use them to construct targeted filters.

### 2. Search (primary context discovery)

Use `watcher_search` to find relevant files:

```json
{ "query": "authentication flow", "limit": 5 }
```

Results include `chunk_text` in the payload. For quick context, the chunks may be sufficient without reading the full file. Only load the file when you need complete content or plan to edit it.

### 3. Read (when needed)

Use the `file_path` from search results to read the actual file. Group results by `file_path` when multiple chunks come from the same document.

### 4. Fall back (when search misses)

If search returns nothing useful or low-scoring results (below ~0.3), the content likely isn't indexed. Fall back to filesystem browsing, directory listing, or grep. This is expected — not everything is in the index.

## Tools

### `watcher_status`

Get service health, collection stats, and discover available payload fields.

| Parameter | Type | Required | Description |
| --------- | ---- | -------- | ----------- |
| _(none)_  |      |          |             |

**Returns:** `status`, `uptime`, `collection` (name, pointCount, dimensions), `payloadFields` (field names with types).

### `watcher_search`

Semantic similarity search with optional Qdrant filters.

| Parameter | Type   | Required | Description                          |
| --------- | ------ | -------- | ------------------------------------ |
| `query`   | string | yes      | Natural-language search query        |
| `limit`   | number | no       | Max results to return (default: 10)  |
| `filter`  | object | no       | Qdrant filter object (see below)     |

**Plain search:**

```json
{ "query": "error handling", "limit": 5 }
```

**Filtered search:**

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
| `path`     | string | yes      | File path of the document           |
| `metadata` | object | yes      | Key-value metadata to set           |

```json
{
  "path": "docs/auth.md",
  "metadata": { "domain": "auth", "reviewed": true }
}
```

## Qdrant Filter Patterns

Build filters using fields discovered via `watcher_status`.

**Exact match:**

```json
{ "must": [{ "key": "domain", "match": { "value": "email" } }] }
```

**Multiple conditions:**

```json
{
  "must": [
    { "key": "domain", "match": { "value": "codebase" } },
    { "key": "file_path", "match": { "text": "auth" } }
  ]
}
```

**Exclude results:**

```json
{
  "must_not": [{ "key": "domain", "match": { "value": "codebase" } }]
}
```

**Full-text match** (tokenized, for longer text fields):

```json
{ "must": [{ "key": "chunk_text", "match": { "text": "authentication" } }] }
```

## Score Interpretation

- **0.7+** — Strong semantic match. Trust these results.
- **0.4–0.7** — Relevant but may need verification. Worth reading.
- **Below 0.3** — Likely noise. The content you need may not be indexed.

## Tips

- **Start broad, then narrow.** A plain query without filters shows you what's available. Add filters once you know which payload field values are relevant.
- **Group by file.** Multiple chunks from the same file appear as separate results. Look at `file_path` to see when you're getting multiple views of one document.
- **Chunk text is a preview.** It's useful for quick triage but may be truncated or split mid-sentence. Read the actual file for complete context.
- **Enrich after analysis.** When you review a document and learn something about it, use `watcher_enrich` to tag it. Future searches can filter on those tags.
