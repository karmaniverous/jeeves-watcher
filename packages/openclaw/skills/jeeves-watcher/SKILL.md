---
name: jeeves-watcher
description: >
  Semantic search across a structured document archive. Use when you need to
  recall prior context, find documents, answer questions that require searching
  across domains (email, Slack, Jira, codebase, meetings, projects), enrich
  document metadata, manage watcher config, or diagnose indexing issues.
---

# jeeves-watcher — Search, Discovery & Administration

## Service Architecture

The watcher is an HTTP API running as a background service (typically NSSM on Windows, systemd on Linux).

**Default port:** 3458 (configurable via `api.port` in watcher config)
**Non-default port:** If the watcher runs on a different port, the user must set `plugins.entries.jeeves-watcher.config.apiUrl` in `openclaw.json`. The plugin cannot auto-discover a non-default port.

**Health check:** `GET /status` returns uptime, point count, collection dimensions, and reindex status.

**Mental model:** The `watcher_*` tools are thin HTTP wrappers. Each tool call translates to an HTTP request to the watcher API. When tools are available, use them. When they're not (e.g., different session, plugin not loaded), you can hit the API directly:

```
# Health check
curl http://127.0.0.1:3458/status

# Search
curl -X POST http://127.0.0.1:3458/search \
  -H "Content-Type: application/json" \
  -d '{"query": "search text", "limit": 5}'

# Query config
curl -X POST http://127.0.0.1:3458/config/query \
  -H "Content-Type: application/json" \
  -d '{"path": "$.inferenceRules[*].name"}'
```

**Key endpoints:**
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/status` | GET | Health check, uptime, collection stats |
| `/search` | POST | Semantic search (main query interface) |
| `/config/query` | POST | JSONPath query over merged virtual document |
| `/config/validate` | POST | Validate candidate config |
| `/config/apply` | POST | Apply config changes |
| `/config-reindex` | POST | Trigger reindex |
| `/metadata` | POST | Enrich document metadata |
| `/issues` | GET | Runtime embedding failures |

**If the watcher is unreachable:** Check the service status (`nssm status jeeves-watcher` on Windows), check the configured port in the watcher config file, and check logs for startup errors.

## Theory of Operation

You have access to a **semantic archive** of your human's working world: email, Slack messages, Jira tickets, code repositories, meeting notes, project documents, and more. Everything is indexed, chunked, embedded, and searchable. This is your long-term memory for anything beyond the current conversation.

**When to reach for the watcher:**

- **Someone asks about something that happened.** A meeting, a decision, a conversation, a ticket. You weren't there, but the archive was. Search it.
- **You need context you don't have.** Before asking the human "what's the status of X?", search for X. The answer is probably already indexed.
- **You're working on a project and need background.** Architecture decisions, prior discussions, related tickets, relevant code. Search by topic, filter by domain.
- **You need to verify something.** Don't guess from stale memory. Search for the current state.
- **You want to connect dots across domains.** The same topic might appear in a Jira ticket, a Slack thread, an email, and a code commit. A single semantic search surfaces all of them.

**When NOT to use it:**

- You already have the information in the current conversation
- The question is about general knowledge, not the human's specific context
- The watcher is unreachable (fall back to filesystem browsing)

**How it works, conceptually:**

The watcher monitors directories on the filesystem. When files change, it extracts text, applies **inference rules** (config-driven pattern matching) to derive structured metadata, and embeds everything into a vector store. Each inference rule defines a record type: what files it matches, what metadata schema applies, how to extract fields.

You don't need to know the rules in advance. The config is introspectable at runtime. Orient once per session, then search with confidence.

**Key mental model:** Think of it as a search engine scoped to your human's data, with structured metadata on every result. Plain semantic search works. Adding metadata filters makes it precise.

## Quick Start

1. **Orient yourself** (once per session) — learn the deployment's organizational strategy and available record types
2. **Search** — semantic search with optional metadata filters
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

### `watcher_validate`
Validate config and optionally test file paths.
- `config` (object, optional) — candidate config (partial or full). Omit to validate current config.
- `testPaths` (string[], optional) — file paths to test against the config

Partial configs merge with current config by rule name. If `config` is omitted, tests against the running config.

### `watcher_config_apply`
Apply config changes atomically.
- `config` (object, required) — full or partial config to apply

Validates, writes to disk, and triggers configured reindex behavior. Returns validation errors if invalid.

### `watcher_reindex`
Trigger a reindex.
- `scope` (string, optional) — `"rules"` (default) or `"full"`

Rules scope re-applies inference rules without re-embedding (lightweight). Full scope re-processes all files.

### `watcher_issues`
Get runtime embedding failures. Returns `{ filePath: IssueRecord }` showing files that failed and why.

## Qdrant Filter Syntax

Filters use Qdrant's native JSON filter format, passed as the `filter` parameter to `watcher_search`.

### Basic Patterns

**Match exact value:**
```json
{ "must": [{ "key": "domain", "match": { "value": "email" } }] }
```

**Match text (full-text search within field):**
```json
{ "must": [{ "key": "chunk_text", "match": { "text": "authentication" } }] }
```

**Combine conditions (AND):**
```json
{
  "must": [
    { "key": "domain", "match": { "value": "jira" } },
    { "key": "status", "match": { "value": "In Progress" } }
  ]
}
```

**Exclude (NOT):**
```json
{
  "must_not": [{ "key": "domain", "match": { "value": "repos" } }]
}
```

**Any of (OR):**
```json
{
  "should": [
    { "key": "domain", "match": { "value": "email" } },
    { "key": "domain", "match": { "value": "slack" } }
  ]
}
```

**Nested (combine AND + NOT):**
```json
{
  "must": [{ "key": "domain", "match": { "value": "jira" } }],
  "must_not": [{ "key": "status", "match": { "value": "Done" } }]
}
```

### Key Differences
- `match.value` — exact match (case-sensitive, for keyword fields like `domain`, `status`)
- `match.text` — full-text match (for text fields like `chunk_text`)

## Search Result Shape

Each result from `watcher_search` contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Qdrant point ID |
| `score` | number | Similarity score (0-1, higher = more relevant) |
| `payload.file_path` | string | Source file path |
| `payload.chunk_text` | string | The matched text chunk |
| `payload.chunk_index` | number | Chunk position within the file |
| `payload.total_chunks` | number | Total chunks for this file |
| `payload.content_hash` | string | Hash of the full document content |
| `payload.matched_rules` | string[] | Names of inference rules that matched |

Additional metadata fields depend on the deployment's inference rules (e.g., `domain`, `status`, `author`). Use `watcher_query` to discover available fields.

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

## JSONPath Patterns for Schema Discovery

Use `watcher_query` to explore the merged virtual document. Common patterns:

### Orientation
```
$.inferenceRules[*].['name','description']    — List all rules with descriptions
$.search.scoreThresholds                       — Score interpretation thresholds
$.slots                                        — Named filter patterns (e.g., memory)
```

### Schema Discovery
```
$.inferenceRules[?(@.name=='jira-issue')]               — Full rule details
$.inferenceRules[?(@.name=='jira-issue')].values        — Distinct values for a rule
$.inferenceRules[?(@.name=='jira-issue')].values.status — Values for a specific field
```

### Helper Enumeration
```
$.mapHelpers                        — All JsonMap helper namespaces
$.mapHelpers.slack.exports          — Exports from the 'slack' helper
$.templateHelpers                   — All Handlebars helper namespaces
```

### Issues
```
$.issues                            — All runtime embedding failures
```

### Full Config Introspection
```
$.schemas                           — Global named schemas
$.maps                              — Named JsonMap transforms
$.templates                         — Named Handlebars templates
```

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

## uiHint → Filter Mapping

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

## Config Authoring

### Rule Structure
Each inference rule has:
- `name` (required) — unique identifier
- `description` (optional) — human-readable purpose
- `match` — JSON Schema with picomatch glob for path matching
- `set` — metadata fields to set on match
- `map` (optional) — named JsonMap transform
- `template` (optional) — named Handlebars template

### Config Workflow
1. Edit config (or build partial config object)
2. Validate: `watcher_validate` with optional `testPaths` for dry-run preview
3. Apply: `watcher_config_apply` — validates, writes, triggers reindex
4. Monitor: `watcher_issues` for runtime embedding failures

### When to Reindex
- **Rules scope** (`"rules"`): Changed rule matching patterns, set expressions, schema mappings. No re-embedding needed.
- **Full scope** (`"full"`): Changed embedding config, added watch paths, broad schema restructuring. Re-embeds everything.

---

## Diagnostics

### Escalation Path
1. `watcher_status` — is the service healthy? Is a reindex running?
2. `watcher_issues` — what files are failing and why?
3. `watcher_query` with `$.issues` — same data via JSONPath
4. Check logs at the configured log path

### Error Categories
- `type_collision` — metadata field type mismatch during extraction (includes `property`, `rules[]`, `types[]`)
- `interpolation` / `interpolation_error` — template/set expression failed to resolve (includes `property`, `rule`)
- `read_failure` — file couldn't be read (permissions, encoding)
- `embedding` — embedding API error

**Issues are self-healing:** resolved on successful re-process. The issues file always represents the current set of unresolved problems: a live todo list.

---

## Helper Management

Helpers use namespace prefixing: config key becomes prefix. A helper named `slack` exports `slack_extractParticipants`.

Enumerate loaded helpers:
```
$.mapHelpers              — JsonMap helper namespaces with exports
$.templateHelpers         — Handlebars helper namespaces with exports
```

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

## Error Handling

If the watcher is unreachable:
- Inform the user that semantic search is temporarily unavailable
- Fall back to direct `read` for known file paths
- Do not retry silently in a loop

If tools are unavailable (plugin not loaded in this session):
- The watcher API is still accessible via direct HTTP calls
- Use `exec` to call the endpoints listed in Service Architecture
- Default: `http://127.0.0.1:3458`

**CLI Fallbacks:**
- `jeeves-watcher status` — check if the service is running
- `jeeves-watcher validate` — validate config from CLI
- Restart via NSSM (Windows) or systemctl (Linux)

---

## References

- [JSONPath Plus documentation](https://www.npmjs.com/package/jsonpath-plus) for JSONPath syntax
- [Qdrant filtering documentation](https://qdrant.tech/documentation/concepts/filtering/) for advanced query patterns and search response format
