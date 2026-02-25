---
name: jeeves-watcher
description: >
  Semantic search and metadata enrichment via a jeeves-watcher instance.
  Use when you need to search indexed documents, discover available metadata
  fields, filter by payload values, or enrich document metadata.
---

# jeeves-watcher — Search & Discovery

**Key principle:** The SKILL teaches procedure. The config provides specifics. The assistant discovers everything about a deployment at runtime; nothing about domains, field names, or organizational structure is hardcoded in the SKILL.

## Quick Start

1. **Orient yourself** (once per session) — understand the deployment's organizational strategy and available record types
2. **Search** — use semantic search with optional metadata filters to find relevant documents
3. **Read source** — retrieve full file content for complete context

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
- `resolve` (string[], optional) — `["files"]`, `["globals"]`, or `["files","globals"]`

{{> qdrant-filters.md}}

{{> search-results.md}}

{{> jsonpath-patterns.md}}

---

## Orientation Pattern (Once Per Session)

Query the deployment's organizational context and available record types. This information is stable within a session; query once and rely on results for the remainder.

**Efficient pattern (two calls):**

1. **Top-level context:**
   ```
   watcher_query: path="$.['description','search']"
   ```
   Returns:
   - `description` — organizational strategy (e.g., how domains are structured, what partitioning means)
   - `search.scoreThresholds` — score interpretation boundaries (strong, relevant, noise)

2. **Available record types:**
   ```
   watcher_query: path="$.inferenceRules[*].['name','description']"
   ```
   Returns list of inference rules with their names and descriptions.

**Example result:**
```json
[
  { "name": "email-archive", "description": "Email archive messages" },
  { "name": "slack-message", "description": "Slack channel messages with channel and author metadata" },
  { "name": "jira-issue", "description": "Jira issue metadata extracted from issue JSON exports" }
]
```

The top-level `description` explains this deployment's organizational strategy. Each rule's `description` explains what that specific record type represents. Both levels are useful: one orients, the other enumerates.

---

## `resolve` Usage Guidance

The `resolve` parameter controls which reference layers are expanded in `watcher_query`:

- **No `resolve` (default):** Raw config structure with references intact (lightweight)
- **`resolve: ["files"]`:** Resolve file path references to their contents (e.g., `"schemas/base.json"` → the JSON Schema object)
- **`resolve: ["globals"]`:** Resolve named schema references (e.g., `"base"` in a rule's schema array → the global schema object)
- **`resolve: ["files","globals"]`:** Fully inlined, everything expanded

**When to use:**
- **Orientation:** No resolve (just names and descriptions, lightweight)
- **Query planning:** `resolve: ["files","globals"]` (need complete merged schemas for filter construction)
- **Browsing global schemas:** `resolve: ["files"]` (see schema contents but keep named references visible for DRY structure understanding)

---

## Query Planning (Per Search Task)

Identify relevant rule(s) from the orientation model, then retrieve their schemas:

**Retrieve complete schema for a rule:**
```
watcher_query: path="$.inferenceRules[?(@.name=='jira-issue')].schema"
              resolve=["files","globals"]
```

Returns the fully merged schema with properties, types, `set` provenance, `uiHint`, `enum`, etc.

**For select/multiselect fields without `enum` in schema:**
```
watcher_query: path="$.inferenceRules[?(@.name=='jira-issue')].values.status"
```

Retrieves valid filter values from the runtime values index (distinct values accumulated during embedding).

**When search results span multiple rules** (indicated by `matched_rules` on results): query each unique rule's schema separately and merge mentally. Most result sets share the same rule combination, so this is typically one or two queries, not one per result.

---

## uiHint → Qdrant Filter Mapping

Use `uiHint` to determine filter construction strategy. **This table is explicit, not intuited:**

| `uiHint` | Qdrant filter | Notes |
|----------|--------------|-------|
| `text` | `{ "key": "<field>", "match": { "text": "<value>" } }` | Substring/keyword match |
| `select` | `{ "key": "<field>", "match": { "value": "<enum_value>" } }` | Exact match; use `enum` values from schema or runtime values index |
| `multiselect` | `{ "key": "<field>", "match": { "value": "<enum_value>" } }` | Any-element match on array field; use `enum` or runtime values index |
| `date` | `{ "key": "<field>", "range": { "gte": <unix_ts>, "lt": <unix_ts> } }` | Either bound optional for open-ended ranges (e.g., "after January" → `gte` only) |
| `number` | `{ "key": "<field>", "range": { "gte": <n>, "lte": <n> } }` | Either bound optional for open-ended ranges |
| `check` | `{ "key": "<field>", "match": { "value": true } }` | Boolean match |
| *(absent)* | Do not use in filters | Internal bookkeeping field, not intended for search |

**Fallback:** If a `select`/`multiselect` field has neither `enum` in schema nor values in the index, treat it as `text` (substring match instead of exact match).

---

## Qdrant Filter Combinators

Compose individual field conditions into complex queries using three combinators:

| Combinator | Semantics | Use case |
|-----------|-----------|----------|
| `must` | AND — all conditions required | Intersecting constraints (domain + date range + assignee) |
| `should` | OR — at least one must match | Alternative values, fuzzy criteria ("assigned to X or Y") |
| `must_not` | Exclusion — any match triggers exclude | Filtering out noise (exclude Done, exclude codebase domain) |

**Combinators nest arbitrarily for complex boolean logic:**
```json
{
  "must": [
    { "key": "domain", "match": { "value": "jira" } },
    { "key": "created", "range": { "gte": 1735689600 } }
  ],
  "should": [
    { "key": "assignee", "match": { "value": "Jason Williscroft" } },
    { "key": "assignee", "match": { "value": null } }
  ],
  "must_not": [
    { "key": "status", "match": { "value": "Done" } }
  ]
}
```

A consuming UI will necessarily compose simple single-field filters. The assistant can compose deeply complex queries combining multiple fields, nested boolean logic, and open-ended ranges to precisely target what it needs.

---

## Search Execution

**Plain semantic search is valid and often sufficient.** Not every query needs metadata filters. When the user's question is broad or exploratory, a natural language query with no filter object is the right starting point. Add filters to narrow, not as a default.

**Result limit guidance:**
- Default: 10 results
- Broad discovery / exploratory: 20–30, apply score threshold cutoff from config
- Targeted retrieval with tight filters: 5
- Cross-domain sweep: 15–20, no domain filter, use score to separate signal from noise

---

## Search Result Shape

**Qdrant output (stable across all configs):**
```json
{
  "id": "<point_id>",
  "score": 0.82,
  "payload": {
    "file_path": "j:/domains/jira/VCN/issue/WEB-123.json",
    "chunk_index": 0,
    "total_chunks": 1,
    "chunk_text": "...",
    "content_hash": "...",
    "matched_rules": ["jira-issue", "json-subject"],
    ...config-defined metadata fields...
  }
}
```

**System fields present on every result** (watcher-managed, not config-defined):
- `file_path` — source file path
- `chunk_index` / `total_chunks` — chunk position within document
- `chunk_text` — the embedded text content
- `content_hash` — content fingerprint for deduplication
- `matched_rules` — inference rules that produced this point's metadata

**All other payload fields are config-defined** (via inference rule schemas).

Refer to Qdrant documentation for the complete search response envelope.

---

## Post-Processing Guidance

### Score Interpretation
Use `scoreThresholds` from config (queried during orientation). Values are deployment-specific, constrained to [-1, 1]:
- `strong` — minimum score for a strong match
- `relevant` — minimum score for relevance
- `noise` — maximum score below which results are noise

### Chunk Grouping
Multiple results with the same `file_path` are chunks of one document. Read the full file for complete context.

### Schema Lookup
Use `matched_rules` on results to look up applicable schemas for metadata interpretation:
```
watcher_query: path="$.inferenceRules[?(@.name=='jira-issue')].schema"
              resolve=["files","globals"]
```

### Full Context
Search gives you chunks; use `read` with `file_path` for the complete document.

---

## Path Testing

When uncertain whether a file is indexed, use the path test endpoint:
```
watcher_query: path="$.inferenceRules[?(@.name=='<rule>')].match"
```

Or check if a specific path would match:
- Returns matching rule names and watch scope status
- Empty `rules` array means no inference rules match
- `watched: false` means the path falls outside watch paths or is excluded by ignore patterns

---

## Diagnostics

Check the issues endpoint for failed embeddings:
```
watcher_query: path="$.issues"
```

**Issues are self-healing:** resolved on successful re-process. The issues file always represents the current set of unresolved problems: a live todo list.

**Issue types:**
- `type_collision` — multiple rules declare the same property with incompatible types (includes `property`, `rules[]`, `types[]`)
- `interpolation_error` — `set` template path doesn't resolve (includes `property`, `rule`)

---

## Enrichment

Use `watcher_enrich` to tag documents after analysis (e.g., `reviewed: true`, project labels).

**Metadata is validated against the file's matched rule schemas.** Validation errors return structured messages:
```json
{
  "error": "Validation failed",
  "details": [
    {
      "property": "priority",
      "expected": "string",
      "received": "number",
      "rule": "jira-issue",
      "message": "Property 'priority' is declared as string in jira-issue schema, received number"
    }
  ]
}
```

---

## Memory Recall

If `$.slots.memory` is present during orientation, this instance indexes memory files. Before answering questions about prior work, decisions, dates, people, preferences, or todos:

1. Search with `watcher_search` using the memory slot filter
2. Use `read` with offset/limit for full context from matched files
3. Include `Source: <file_path>` citations in your response

---

## Error Handling

If the watcher is unreachable:
- Inform the user that semantic search is temporarily unavailable
- Fall back to direct `read` for known file paths
- Do not retry silently in a loop

---

## References

- [JSONPath Plus documentation](https://www.npmjs.com/package/jsonpath-plus) for JSONPath syntax
- [Qdrant filtering documentation](https://qdrant.tech/documentation/concepts/filtering/) for advanced query patterns and search response format
