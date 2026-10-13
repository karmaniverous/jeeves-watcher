---
title: API Reference
---

# API Reference

The watcher exposes a lightweight HTTP API for search, metadata enrichment, and operational control.

**Default address:** `http://127.0.0.1:1936` (configurable via `api.host` and `api.port`)

**Authentication:** none by default. When `api.apiKey` is set, every route except `GET /status` requires `Authorization: Bearer <key>`; see [Authentication](#authentication). The examples below omit the header.

**Request validation:** request bodies are validated against the Zod schemas exported by `@karmaniverous/jeeves-watcher-core`. An invalid body returns `400 { code: "invalid_request", error, details }`, where `error` is the first issue's message and `details` is the full issue list.

**Errors (v0.20.0+):** every non-2xx response carries a machine-readable `code`; see [Error Handling](#error-handling).

**Source documents (v0.20.0+):** besides files, the watcher indexes records retrieved from other systems by callback. See [`POST /documents`](#post-documents), [`POST /documents/delete`](#post-documentsdelete) and the [Source Documents guide](./source-documents.md).

---

## GET /status

Health check and service stats.

### Request

```bash
curl http://localhost:1936/status
```

### Response

```json
{
  "status": "ok",
  "uptime": 86400,
  "version": "0.9.9",
  "collection": {
    "name": "jeeves_archive",
    "pointCount": 10498,
    "dimensions": 3072
  },
  "reindex": {
    "active": false
  },
  "initialScan": {
    "active": true,
    "filesMatched": 156576,
    "filesEnqueued": 156576,
    "startedAt": "2026-03-15T01:22:00.000Z"
  }
}
```

| Field | Type | Description |
| --- | --- | --- |
| `status` | `string` | Always `"ok"` if the server is responding. |
| `uptime` | `number` | Process uptime in seconds. |
| `version` | `string` | Service package version (from `package.json`). |
| `collection` | `object` | Qdrant collection stats. |
| `collection.name` | `string` | Collection name. |
| `collection.pointCount` | `number` | Total indexed points (chunks). |
| `collection.dimensions` | `number` | Embedding vector dimensions. |
| `reindex` | `object` | Active reindex status. |
| `reindex.active` | `boolean` | Whether a reindex is currently running. |
| `reindex.scope` | `string?` | Reindex scope if active: `"rules"`, `"full"`, `"issues"`, `"path"`, or `"prune"`. |
| `initialScan` | `object` | Initial filesystem scan state after service start. |
| `initialScan.active` | `boolean` | Whether the initial scan is still in progress. |
| `initialScan.filesMatched` | `number?` | Files matched by watch globs so far. |
| `initialScan.filesEnqueued` | `number?` | Files enqueued for processing so far. |
| `initialScan.startedAt` | `string?` | ISO-8601 timestamp when the scan started. |
| `initialScan.completedAt` | `string?` | ISO-8601 timestamp when the scan completed (when `active` is false). |
| `initialScan.durationMs` | `number?` | Total scan duration in milliseconds (when `active` is false). |
| `reindex.startedAt` | `string?` | ISO-8601 timestamp when reindex started, if active. |

> **v0.5.0 change:** `payloadFields` has been removed from the status response. Use [`POST /config/query`](#post-configquery) or [`GET /config/schema`](#get-configschema) to discover schema and payload field information.

**Status codes:**

- `200 OK` — Service is healthy

`GET /status` is always open, even when `api.apiKey` is set, so load balancers and uptime checks can use it.

---

## POST /metadata

Enrich a document's metadata without re-embedding. Targets a file (`path`) or, since v0.20.0, a source document (`source`).

### Request

```bash
curl -X POST http://localhost:1936/metadata \
  -H "Content-Type: application/json" \
  -d '{
    "path": "D:/projects/readme.md",
    "metadata": {
      "title": "Project Overview",
      "labels": ["documentation", "important"],
      "priority": "high"
    }
  }'
```

**Body schema:**

```typescript
{
  path?: string;   // File path
  source?: string; // Source reference <name>://<id> (v0.20.0+)
  metadata: Record<string, unknown>; // Metadata to merge
}
// Exactly one of path or source is required.
```

### Response

**Success (200 OK):**

```json
{
  "ok": true,
  "matched_rules": ["chat-thread"]
}
```

`matched_rules` lists the rules whose schemas validated the metadata.

**Validation error (400 Bad Request):**

```json
{
  "code": "invalid_request",
  "error": "Metadata validation failed",
  "details": [
    { "field": "priority", "message": "must be one of: low, medium, high" }
  ]
}
```

> **v0.5.0:** Metadata is validated against the schema defined by matched inference rules. If the file matches a rule with a `schema` block, provided metadata must conform to it.

**Error (500 Internal Server Error):**

```json
{
  "error": "Internal server error"
}
```

### Behavior

1. Reads existing enrichment metadata from the metadata store
2. Merges provided metadata (new values override existing)
3. Writes merged metadata to `.meta.json` sidecar file
4. Updates all chunk payloads in Qdrant (no re-embedding)

**If the file isn't indexed yet:**

- The metadata is written to the metadata store
- The file will be processed on the next filesystem event or manual reindex

**Source documents (`source`):**

- The document must be indexed: its designated rule is read from the stored `source_rule`. Otherwise the response is `404 { "code": "source_not_indexed", "error": "Source document not indexed" }` and nothing is stored.
- The metadata is validated against the designated rule's schema (`400` on failure).
- It is stored in the enrichment store under the exact reference, written to every chunk with `setPayload` (no re-embedding, no callback), and merged again whenever the document is re-processed.
- System fields (`source`, `source_rule`, `chunk_*`, ...) can never be overwritten.

---

## POST /render

Render a document through the inference rule engine without embedding. Returns the transformed (or passthrough) content along with metadata. Targets a file (`path`) or, since v0.20.0, a source document (`source`).

**v0.8.0+**

### Request

```bash
curl -X POST http://localhost:1936/render \
  -H "Content-Type: application/json" \
  -d '{"path": "j:/domains/slack/C0ABC/1234567.json"}'
```

**Body schema:**

```typescript
{
  path?: string;   // File path (must be within watched scope)
  source?: string; // Source reference <name>://<id> (v0.20.0+)
}
// Exactly one of path or source is required.
```

### Response

**Success (200 OK):**

```json
{
  "renderAs": "md",
  "content": "---\nchannelName: general\n---\n# Message\nHello world",
  "rules": ["slack-message", "json-subject"],
  "metadata": {
    "domain": "slack",
    "entity_type": "message",
    "matched_rules": ["slack-message", "json-subject"]
  }
}
```

### Response Schema

| Field | Type | Description |
| --- | --- | --- |
| `renderAs` | `string` | Output content type (file extension without dot). Always present. |
| `content` | `string` | Rendered content (from template/render transform) or extracted text (passthrough). |
| `rules` | `string[]` | Names of matched inference rules (diagnostic). |
| `metadata` | `object` | Composed embedding properties from matched rules. |

### Caching

- **Transformed responses** (template or render ran): cached via `withCache` with the configured TTL.
- **Passthrough responses** (no transform): `Cache-Control: no-cache` header set; bypasses the cache.
- **Source documents** (`source`): never cached (no cache read, no cache write) and always sent with `Cache-Control: no-cache`, because the record behind the callback can change at any time.

### Error Codes

| Code | Condition |
| --- | --- |
| `200` | Success |
| `400` | Invalid body (neither or both of `path` / `source`, malformed reference) |
| `403` | `path_not_watched`: path is outside watched scope |
| `404` | `not_found`: file not found; or `source_not_indexed` (no stored point, so no designated rule is known); or `source_not_found` (the callback answered `404`; points are left alone) |
| `422` | `pipeline_error`: render/extraction failed; for a source document `issueType` holds the [issue code](#issue-codes) (`match_failed`, `rule_missing`, `no_content`, ...) and `details` any AJV errors. `unsupported_content_type` when the callback returned a non-JSON body |
| `502` | `source_unavailable`: the source callback failed (`issueType: "source_unavailable"`) |
| `503` | `not_available`: source render on an instance without source-document support |

### Behavior

1. Validates the path against `watch.paths` and `watch.ignored` globs
2. Runs the file through `buildMergedMetadata` (same pipeline as indexing)
3. Resolves `renderAs`: rule-declared value → file extension → `"txt"`
4. Returns rendered or extracted content with matched rules and metadata

For a **source document**, the watcher reads the designated rule from the stored `source_rule`, retrieves the record through its callback, applies that rule and returns the result. `renderAs` is `"md"` when the rule has a `template` or `render`, otherwise `"json"`. Nothing is embedded or written, and failures are returned, never recorded as issues.

**Use cases:**

- Server-side document rendering (jeeves-server consumes this for its document viewer)
- Content preview without embedding
- Debugging: see what a file looks like after template/render transforms

---

## GET /search/facets

Returns schema-derived facet definitions for building search filter UIs.

**v0.8.0+**

### Request

```bash
curl http://localhost:1936/search/facets
```

### Response

**Success (200 OK):**

```json
{
  "facets": [
    {
      "field": "domain",
      "type": "string",
      "uiHint": "dropdown",
      "values": ["email", "jira", "meetings", "slack"],
      "rules": [
        "email-archive",
        "jira-issue",
        "meetings-transcript",
        "slack-message"
      ]
    },
    {
      "field": "priority",
      "type": "string",
      "uiHint": "dropdown",
      "values": ["Critical", "High", "Medium", "Low"],
      "rules": ["jira-issue"]
    }
  ]
}
```

### Response Schema

| Field    | Type      | Description                 |
| -------- | --------- | --------------------------- |
| `facets` | `Facet[]` | Array of facet definitions. |

**Facet:**

| Field | Type | Description |
| --- | --- | --- |
| `field` | `string` | Metadata field name. |
| `type` | `string` | JSON Schema type (e.g. `"string"`, `"number"`, `"boolean"`). |
| `uiHint` | `string` | UI rendering hint (e.g. `"dropdown"`, `"tags"`, `"date"`). |
| `values` | `unknown[]` | Known values. Uses `enum` values if declared; otherwise live values from the index. |
| `rules` | `string[]` | Which inference rules define this field. |

### Behavior

1. Resolves schemas for all inference rules via `mergeSchemas`
2. Extracts properties that declare `uiHint` or `enum`
3. Deduplicates fields across rules (later rules override `uiHint`)
4. Enriches with live distinct values from the values index
5. Schema structure is cached internally; rebuilt when rules change

**Caching:** The schema structure is computed once and cached until inference rules change. Live values from `ValuesManager` are merged fresh on each request.

**Use cases:**

- Building dynamic search filter UIs
- LLM agent orientation: discover filterable fields before constructing search queries

---

## POST /search

Semantic search across indexed documents.

### Request

```bash
curl -X POST http://localhost:1936/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "machine learning algorithms",
    "limit": 10
  }'
```

**Body schema:**

```typescript
{
  query: string;                    // Natural language search query
  limit?: number;                   // Max results (default: 10)
  offset?: number;                  // Skip N results for pagination (default: 0)
  filter?: Record<string, unknown>; // Qdrant filter object (optional)
}
```

**Filtered search example:**

```bash
curl -X POST http://localhost:1936/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "authentication flow",
    "limit": 5,
    "filter": {
      "must": [{ "key": "domain", "match": { "value": "backend" } }]
    }
  }'
```

**Paginated search example:**

```bash
curl -X POST http://localhost:1936/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "authentication flow",
    "limit": 10,
    "offset": 20
  }'
```

The `filter` parameter accepts a native [Qdrant filter object](https://qdrant.tech/documentation/concepts/filtering/). Use [`POST /config/query`](#post-configquery) or [`GET /config/schema`](#get-configschema) to discover available payload fields and their types, then construct filters accordingly. Common patterns:

- **Exact match:** `{ "must": [{ "key": "domain", "match": { "value": "email" } }] }`
- **Negation:** `{ "must_not": [{ "key": "domain", "match": { "value": "codebase" } }] }`
- **Multi-field:** Combine conditions in the `must` array
- **Full-text:** `{ "key": "chunk_text", "match": { "text": "keyword" } }` (tokenized)

### Response

**Success (200 OK):**

```json
[
  {
    "id": "uuid-chunk-0",
    "score": 0.87,
    "payload": {
      "file_path": "d:/projects/ml/readme.md",
      "chunk_index": 0,
      "total_chunks": 3,
      "content_hash": "sha256:abc123...",
      "chunk_text": "Machine learning is...",
      "domain": "projects",
      "title": "ML Overview"
    }
  },
  {
    "id": "uuid-chunk-1",
    "score": 0.82,
    "payload": {/* ... */}
  }
]
```

**Embedding unavailable (503 Service Unavailable, v0.20.0+):**

```json
{
  "code": "embedding_unavailable",
  "error": "EmbeddingUnavailableError",
  "message": "Embedding provider still rate-limited after 3 attempts: ..."
}
```

Returned when the query cannot be embedded within the search budget (3 provider attempts, at most 10 seconds waiting on the shared rate limiter). A `Retry-After` header (seconds) is set when the limiter knows when it will accept requests again. See [Rate Limiting](#rate-limiting).

**Error (500 Internal Server Error):**

```json
{
  "error": "Internal server error"
}
```

### Response Schema

Each result is a Qdrant point:

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Qdrant point ID (deterministic UUID from file path or source reference + chunk index). |
| `score` | `number` | Cosine similarity score (0–1, higher is better). |
| `payload` | `object` | Document metadata and chunk info. |

**Payload fields:**

| Field | Type | Description |
| --- | --- | --- |
| `file_path` | `string` | Normalized file path (forward slashes). File points only. |
| `source` | `string` | Source reference `<name>://<id>`. Source points only (v0.20.0+). |
| `source_rule` | `string` | Designated rule of a source document. Source points only (v0.20.0+). |
| `chunk_index` | `number` | Chunk index (0-based). |
| `total_chunks` | `number` | Total chunks for this document. |
| `content_hash` | `string` | SHA-256 hash of extracted text. |
| `chunk_text` | `string` | Text content of this chunk. |
| _Custom fields_ | `any` | Metadata from inference rules and `POST /metadata`. |

### Behavior

1. Embeds the query text using the configured embedding provider
2. Searches Qdrant using cosine similarity
3. Returns top `limit` results (includes all chunks; caller groups by `file_path` or `source` if needed)

The query embedding draws from the same rate limiter as indexing.

---

## POST /scan

Filter-only point query without vector search. Returns metadata for points matching a Qdrant filter with cursor-based pagination.

### Request

```bash
curl -X POST http://localhost:1936/scan \
  -H "Content-Type: application/json" \
  -d '{
    "filter": {
      "must": [{ "key": "domain", "match": { "value": "email" } }]
    },
    "limit": 50
  }'
```

**Body schema:**

```typescript
{
  filter: Record<string, unknown>;   // Qdrant filter object (required)
  limit?: number;                    // Page size (default: 100, max: 1000)
  cursor?: string | number;          // Opaque cursor from previous response
  fields?: string[];                 // Payload field projection
  countOnly?: boolean;               // If true, return { count } instead of points
}
```

### Response

**Success (200 OK) — normal scan:**

```json
{
  "points": [
    {
      "id": "uuid-chunk-0",
      "payload": { "file_path": "j:/domains/email/msg.json", "domain": "email" }
    },
    {
      "id": "uuid-chunk-1",
      "payload": {
        "file_path": "j:/domains/email/msg2.json",
        "domain": "email"
      }
    }
  ],
  "cursor": "next-abc123"
}
```

**Success (200 OK) — count only:**

```json
{
  "count": 4217
}
```

**Last page (no more results):**

```json
{
  "points": [],
  "cursor": null
}
```

### Response Schema

| Field | Type | Description |
| --- | --- | --- |
| `points` | `ScrolledPoint[]` | Matched points with payload. |
| `cursor` | `string \| number \| null` | Opaque cursor for next page. `null` when no more results. |
| `count` | `number` | Total matching points (only when `countOnly: true`). |

### Error Codes

| Code  | Condition                                                      |
| ----- | -------------------------------------------------------------- |
| `200` | Success                                                        |
| `400` | Missing or invalid `filter`, or `limit` out of bounds (1–1000) |
| `500` | Server error                                                   |

### Behavior

1. Validates that `filter` is a non-null object
2. Clamps `limit` to 1–1000 range (rejects out-of-bounds with 400)
3. If `countOnly`: calls Qdrant `count()` with exact mode and returns `{ count }`
4. Otherwise: calls Qdrant `scroll()` with the filter, limit, cursor, and optional field projection
5. Returns matched points and an opaque cursor for the next page

**Use cases:**

- File enumeration (list all points in a domain)
- Staleness checks (count points matching a filter)
- Delta computation (scan for points with specific metadata)
- Structural queries that don't need semantic similarity

**Difference from POST /search:**

- `/scan` does NOT embed a query or compute similarity scores
- `/scan` uses cursor-based pagination (efficient for large result sets)
- `/search` uses offset-based pagination (suitable for small ranked result sets)

---

## POST /rebuild-metadata

Rebuild the metadata store from Qdrant payloads.

### Request

```bash
curl -X POST http://localhost:1936/rebuild-metadata
```

### Response

**Success (200 OK):**

```json
{
  "ok": true
}
```

**Error (500 Internal Server Error):**

```json
{
  "error": "Internal server error"
}
```

### Behavior

1. Scrolls all Qdrant points in the collection
2. For each point:
   - Extracts `file_path` and enrichment metadata from payload
   - Writes a `.meta.json` sidecar file to the metadata store
3. Skips internal fields (`chunk_index`, `total_chunks`, `content_hash`, `chunk_text`)

**Use cases:**

- Metadata store corruption or accidental deletion
- Migrating to a new machine (copy Qdrant snapshot, rebuild metadata store)
- First-time setup from an existing Qdrant collection

**Cost:** No embedding API calls — pure data extraction.

---

## POST /reindex

Trigger a scoped reindex operation. Non-prune scopes include a `plan` object showing blast area. Live prune (non-dry-run) returns immediately without a plan.

### Request

**Body schema:**

```typescript
{
  scope?: "issues" | "full" | "rules" | "path" | "prune";  // Default: "issues"
  path?: string | string[];   // Files/directories/globs for scopes "path" and "rules"
  source?: string | string[]; // Source references for scope "path" (v0.20.0+)
  dryRun?: boolean;           // Compute plan without executing (default: false)
}
// Scope "path" requires exactly one of path or source; source is only valid with scope "path".
```

**Examples:**

```bash
# Rules-only reindex (re-apply inference rules, no re-embedding)
curl -X POST http://localhost:1936/reindex \
  -H "Content-Type: application/json" \
  -d '{"scope": "rules"}'

# Full reindex (re-extract, re-embed, re-upsert all files and source documents)
curl -X POST http://localhost:1936/reindex \
  -H "Content-Type: application/json" \
  -d '{"scope": "full"}'

# Re-process only documents with issues
curl -X POST http://localhost:1936/reindex \
  -H "Content-Type: application/json" \
  -d '{"scope": "issues"}'

# Re-embed a specific directory
curl -X POST http://localhost:1936/reindex \
  -H "Content-Type: application/json" \
  -d '{"scope": "path", "path": "j:/domains/projects/jeeves-watcher"}'

# Re-process specific source documents (v0.20.0+)
curl -X POST http://localhost:1936/reindex \
  -H "Content-Type: application/json" \
  -d '{"scope": "path", "source": ["app://chat/thread/6710c3a9"]}'

# Delete orphaned points (files no longer in watch scope)
curl -X POST http://localhost:1936/reindex \
  -H "Content-Type: application/json" \
  -d '{"scope": "prune"}'

# Dry run: preview blast area without executing
curl -X POST http://localhost:1936/reindex \
  -H "Content-Type: application/json" \
  -d '{"scope": "prune", "dryRun": true}'
```

### Response

**Success (200 OK) — normal execution:**

```json
{
  "status": "started",
  "scope": "rules",
  "plan": {
    "total": 148000,
    "toProcess": 148000,
    "toDelete": 0,
    "byRoot": {
      "j:/domains": 95000,
      "j:/config": 3000
    }
  }
}
```

**Success (200 OK) — live prune (no plan):**

```json
{
  "status": "started",
  "scope": "prune"
}
```

**Success (200 OK) — dry run:**

```json
{
  "status": "dry_run",
  "scope": "prune",
  "plan": {
    "total": 562000,
    "toProcess": 0,
    "toDelete": 2300,
    "byRoot": {
      "j:/jeeves/node_modules": 1800,
      "j:/jeeves/.bridge": 500
    }
  }
}
```

**Plan fields:**

| Field | Type | Description |
| --- | --- | --- |
| `total` | `number` | Total points (prune) or files and source documents (other scopes) examined. |
| `toProcess` | `number` | Items to embed/re-apply rules (0 for prune). |
| `toDelete` | `number` | Points to delete (prune only, 0 for others). |
| `byRoot` | `object` | Counts grouped by watch root prefix (files) or source name (source documents). |

The reindex runs **asynchronously** — the API returns immediately with the plan. Use `GET /status` to track progress.

**Error codes:**

| Code | Condition |
| --- | --- |
| `200` | Success (started or dry_run) |
| `400` | `invalid_request`: invalid body (unknown scope, missing `path`/`source` for scope `path`, `source` outside scope `path`, malformed reference). `not_available`: prune without vectorStore, or `source` on an instance without source-document support |
| `500` | Server error |

### Scopes

#### `issues` (default)

Re-processes documents with open issues (from `GET /issues`): files, and source documents whose stored designated rule is known. Use after fixing the root cause of failures (permissions, encoding, file format, a source outage).

#### `rules`

Re-reads file attributes, re-applies current inference rules, updates Qdrant payloads. **No re-embedding** for files. Use after editing inference rules.

Without `path`, source documents are included: each is retrieved through its callback and its stored rule re-applied. Unchanged content gets a metadata-only `setPayload`; if the rule now renders different text, the document is re-embedded. With `path`, only matching files are covered.

#### `full`

Re-extracts text, re-embeds (new embedding API calls), re-upserts to Qdrant. Source documents are retrieved through their callbacks and **always re-embedded**. Use after changing embedding providers, chunk size, or adding watch paths.

#### `path`

With `path`: re-embeds a specific file or all files under a directory. Validates that the target is within watch scope and not gitignored. Use for targeted re-embedding without a full reindex.

With `source` (v0.20.0+): re-processes the listed source references with their stored designated rule, through the notify queue (so they coalesce with concurrent notifications, and failures land in `GET /issues`). References that are not indexed are skipped: they count in `total` but not in `toProcess`.

#### `prune`

Scrolls all Qdrant points, checks each `file_path` against current watch scope and gitignore, batch-deletes orphaned points. **No re-embedding, no file reads** — pure Qdrant scroll + local checks + deletes. Use after changing `watch.paths`, adding gitignore rules, or to clean up stale data (e.g., indexed `node_modules`).

Prune **never** selects points carrying `source`: source documents are removed only by a callback `404` or [`POST /documents/delete`](#post-documentsdelete). The file and notify queues are paused while a prune runs.

**Note:** `prune` is NOT valid for the config-watch auto-trigger (`configWatch.reindex`). It can only be triggered via explicit API calls.

### Source Documents

Explicit `POST /reindex` requests cover source documents as described above; a reindex triggered by a config change (`configWatch.reindex`) covers **files only**. Source documents are discovered from Qdrant (chunk-0 points carrying `source`), retrieved through their callbacks, and processed with their stored `source_rule`. In every scope a callback `404` deletes the document and any other failure records an issue and leaves its points untouched. See the [Source Documents guide](./source-documents.md#reindex-prune-and-deletion).

### Dry Run

When `dryRun: true`, the plan is computed and returned synchronously without starting the async job. Works for all scopes. Use to preview impact before committing to a large operation.

### Reindex Tracking

While a reindex is running, `GET /status` shows the active reindex state:

```json
{
  "reindex": {
    "active": true,
    "scope": "rules",
    "startedAt": "2026-02-24T08:00:00Z"
  }
}
```

### Completion Callback

If `reindex.callbackUrl` is configured, the watcher sends a POST request to that URL when the reindex completes:

```json
{
  "scope": "rules",
  "filesProcessed": 1234,
  "durationMs": 45000,
  "status": "completed"
}
```

The callback retries with exponential backoff (3 attempts, starting at 1 second).

---

## POST /documents

Notify the watcher that source documents changed. **v0.20.0+**

The watcher validates each notification, queues it, and later retrieves the current record through the source's configured callback, renders it with the designated rule, and indexes it. See the [Source Documents guide](./source-documents.md) for the model, configuration and callback contract.

### Request

```bash
curl -X POST http://localhost:1936/documents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WATCHER_API_KEY" \
  -d '{
    "documents": [
      { "source": "app://chat/thread/6710c3a9", "rule": "chat-thread" }
    ]
  }'
```

**Body schema:**

```typescript
{
  documents: Array<{
    source: string; // Source reference <name>://<id>; <name> must be configured in `sources`
    rule: string; // Designated rule name
  }>; // 1 to 100 entries
}
```

**Query string:** `?wait=true` processes synchronously (also accepts `1`; `false`/`0` or omitted = asynchronous).

Notify only: there is no push form. Unknown keys (for example inline `text`) fail the request with `400`.

### Response

**Accepted (202), the default:**

```json
{
  "accepted": ["app://chat/thread/6710c3a9"],
  "rejected": [
    {
      "source": "zz://chat/thread/1",
      "error": {
        "code": "unknown_source",
        "message": "Source \"zz\" is not configured"
      }
    }
  ]
}
```

Validation is synchronous and per document; accepted references are queued. A rejected document does not fail the others.

| Rejection code | Meaning |
| --- | --- |
| `invalid_reference` | `source` is not `<name>://<id>`. |
| `unknown_source` | `<name>` is not configured in `sources` (or no sources are configured). No request is made. |
| `invalid_id` | The id has an empty, `.` or `..` segment, or would produce a URL outside the configured origin. |
| `rule_missing` | No rule of that name exists in the current rule set. |
| `queue_stopped` | The service is shutting down; notify again later. |

Processing failures after acceptance are not in the response: they are recorded under the reference in [`GET /issues`](#get-issues).

**Synchronous (200) with `?wait=true`:**

```json
{
  "results": [
    {
      "source": "app://chat/thread/6710c3a9",
      "status": "indexed",
      "chunks": 2,
      "matched_rules": ["chat-thread"]
    },
    {
      "source": "app://chat/thread/6710c3b0",
      "status": "unchanged",
      "matched_rules": ["chat-thread"]
    },
    { "source": "app://chat/thread/0000", "status": "deleted" },
    {
      "source": "app://chat/thread/6710c3b1",
      "status": "failed",
      "error": {
        "code": "match_failed",
        "message": "Document does not match rule \"chat-thread\": ...",
        "details": []
      }
    }
  ]
}
```

One result per submitted document, in submission order:

| `status` | Meaning |
| --- | --- |
| `indexed` | Written: content re-embedded, or (same content, changed metadata) payloads updated without an embedding call. `chunks` is the chunk count. |
| `unchanged` | Same rendered content and metadata; nothing written, no embedding call. |
| `deleted` | The callback answered `404`; the document's points were removed. |
| `failed` | `error.code` is a rejection code above or an [issue code](#issue-codes); existing points are untouched. `details` holds AJV errors for `match_failed`. |

A designated rule whose `match` rejects the record is never an HTTP error: asynchronously it becomes a `match_failed` issue, with `?wait=true` a `failed` result.

**Errors:**

| Code | Condition |
| --- | --- |
| `400` | Invalid body: `documents` missing, empty or over 100 entries; missing or empty `source`/`rule`; unknown keys; invalid `wait` |
| `401` | `unauthorized`: `api.apiKey` is set and the bearer token is missing or wrong |
| `503` | `not_available`: the instance's document processor does not support source documents |

### Behavior

- Notifications are queued in memory, keyed by reference. A notification for a pending reference merges with it; one for an in-flight reference triggers exactly one more run after the current one. Every run retrieves the current record, so the latest state always wins. See [coalescing](./source-documents.md#notifications-queuing-and-coalescing).
- `?wait=true` uses the same queue (concurrency and coalescing apply) and waits for the results. Use it for backfills and tests.
- Re-notifying an unchanged record costs one callback and no embedding call.

---

## POST /documents/delete

Delete source documents by reference or by Qdrant filter. **v0.20.0+**

### Request

```bash
# By reference
curl -X POST http://localhost:1936/documents/delete \
  -H "Content-Type: application/json" \
  -d '{"sources": ["app://chat/thread/6710c3a9"]}'

# By filter
curl -X POST http://localhost:1936/documents/delete \
  -H "Content-Type: application/json" \
  -d '{"filter": {"must": [{"key": "user_id", "match": {"value": "u-123"}}]}}'
```

**Body schema:** exactly one of

```typescript
{ sources: string[] }                // 1 or more <name>://<id> references
{ filter: Record<string, unknown> }  // native Qdrant filter
```

### Response

```json
{ "deleted": 1 }
```

`deleted` counts **documents** (distinct references), not points.

### Behavior

- The filter is always constrained to points carrying `source`: the caller's filter is nested inside a condition that requires a non-empty `source`. A filter can never delete a file point, whatever it names. Note that `{ "filter": {} }` therefore deletes **every source document**.
- Every chunk of each matching document is deleted.
- Enrichment metadata and issues are removed for the deleted references, and, in the `sources` form, for every listed reference (so a document that only ever failed leaves no issue behind).
- Deletion does not touch the source system. If the owner notifies the reference again (or a notification for it was still queued), it is retrieved and indexed again.

**Errors:** `400` for an invalid body (both or neither of `sources`/`filter`, an empty `sources` array, a malformed reference).

---

## GET /issues

Returns the current issues file contents: every document (file or source document) whose last processing failed, with error details.

**v0.5.0+**

### Request

```bash
curl http://localhost:1936/issues
```

### Response

**Success (200 OK):**

```json
{
  "count": 2,
  "issues": {
    "j:/domains/jira/VCN/issue/WEB-123.json": [
      {
        "type": "type_collision",
        "property": "created",
        "rules": ["jira-issue", "frontmatter-created"],
        "types": ["integer", "string"],
        "message": "Type collision on 'created': jira-issue declares integer, frontmatter-created declares string",
        "timestamp": 1771865063
      }
    ],
    "j:/domains/email/archive/msg-456.json": [
      {
        "type": "interpolation_error",
        "property": "author_email",
        "rule": "email-archive",
        "message": "Failed to resolve ${json.from.email}: 'from' is null",
        "timestamp": 1771865100
      }
    ]
  }
}
```

### Response Schema

| Field | Type | Description |
| --- | --- | --- |
| `count` | `number` | Number of documents with issues (not total issue count). |
| `issues` | `object` | Issues keyed by file path or source reference. |

### IssueRecord Schema

| Field | Type | Description |
| --- | --- | --- |
| `type` | `string` | Issue code; see [Issue Codes](#issue-codes). |
| `operation` | `string?` | Operation that failed (e.g. `Failed to process source document`). |
| `property` | `string?` | Property name where the issue occurred. |
| `rules` | `string[]?` | Rule names involved in the issue (for type collisions). |
| `rule` | `string?` | Rule name for single-rule issues (backward compat). |
| `types` | `string[]?` | Declared types for type collision issues. |
| `message` | `string` | Human-readable error message. |
| `timestamp` | `number \| string` | Unix timestamp (seconds) or ISO string of last occurrence. |

### Issue Codes

Every issue record carries one code from a single canonical list (`ISSUE_TYPES` in `@karmaniverous/jeeves-watcher-core`). The same codes appear as `error.code` in `failed` results of `POST /documents?wait=true`.

| Code | Applies to | Meaning |
| --- | --- | --- |
| `type_collision` | files, sources | Matched rules declare the same property with incompatible types. |
| `interpolation_error` | files, sources | A `set` template could not be rendered. |
| `extraction_error` | files, sources | Reading or extracting the document, applying rules, or chunking failed. Also the code for any failure no stage tagged. |
| `embedding_error` | files, sources | The embedding provider failed, including a rate-limit retry budget that ran out. |
| `upsert_error` | files, sources | Writing to or deleting from the vector store failed. |
| `match_failed` | sources | The designated rule's `match` rejected the retrieved record. Nothing was written. |
| `rule_missing` | sources | The designated rule does not exist (any more). Points untouched. |
| `no_content` | sources | The callback returned an empty JSON object. |
| `source_unavailable` | sources | The callback failed: any status other than `200`/`404` (redirects included), a timeout, a network error, a body that is not valid JSON, or no sources configured. Points untouched. |
| `unsupported_content_type` | sources | The callback answered `200` with a content type other than `application/json`, or with JSON that is not an object. Points untouched. |

Issue files written by versions before 0.20.0 contain only `type_collision` and `interpolation_error` and still load unchanged.

### Behavior

The issues file is self-healing:

- Documents that hit issues are logged and **embedding is skipped**; a source document's existing points are left untouched
- Successful re-processing (config fix, file edit, re-notification, reindex) **clears** the entry
- A source document that is deleted (callback `404` or `POST /documents/delete`) has its entry cleared
- The response always represents the **current** set of unresolved problems

**Empty response:**

```json
{
  "count": 0,
  "issues": {}
}
```

---

## POST /config/query

Query the merged virtual configuration document using JSONPath expressions.

### Request

```bash
curl -X POST http://localhost:1936/config/query \
  -H "Content-Type: application/json" \
  -d '{
    "path": "$.inferenceRules[*].name",
    "resolve": ["files", "globals"]
  }'
```

**Body schema:**

```typescript
{
  path: string;                    // JSONPath expression
  resolve?: string[];              // Resolution scopes: "files", "globals" (default: all)
}
```

### Response

**Success (200 OK):**

```json
{
  "result": ["email-classifier", "meeting-tagger", "project-labeler"]
}
```

### Merged Document Shape

The query runs against a virtual document that merges:

- **config** — current configuration (rules, watch paths, etc.)
- **values** — discovered payload field names and types (replaces old `payloadFields` from status)
- **helpers** — loaded map helpers and template helpers
- **issues** — current runtime issues

See [Inference Rules Guide](./inference-rules.md) for rule structure details.

---

## GET /config/schema

Returns the JSON Schema describing the merged virtual document (authored config + runtime state).

**v0.5.0+**

### Request

```bash
curl http://localhost:1936/config/schema
```

### Response

**Success (200 OK):**

Returns a JSON Schema object describing the merged config document shape, including:

- Top-level config fields (`description`, `search`, `schemas`, `inferenceRules`, etc.)
- Runtime-injected fields (`inferenceRules[].values`, `issues`, helper introspection)

The schema is generated from Zod using `z.toJSONSchema()` and describes the queryable surface exposed by `POST /config/query`.

**Example response (excerpt):**

```json
{
  "type": "object",
  "properties": {
    "description": { "type": "string" },
    "schemas": { "type": "array" },
    "inferenceRules": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "description": { "type": "string" },
          "values": {
            "type": "object",
            "additionalProperties": { "type": "array" }
          }
        }
      }
    }
  }
}
```

### Use Cases

- Introspection of the watcher's queryable config surface
- UI generation for config editors
- LLM agent orientation (understand structure before querying)

---

## POST /config/match

Tests file paths against inference rules and watch scope without indexing.

**v0.5.0+**

### Request

```bash
curl -X POST http://localhost:1936/config/match \
  -H "Content-Type: application/json" \
  -d '{
    "paths": [
      "j:/domains/jira/VCN/issue/WEB-123.json",
      "j:/domains/slack/C0ABC/1234567.json",
      "j:/domains/unknown/file.txt"
    ]
  }'
```

**Body schema:**

```typescript
{
  paths: string[];  // File paths to test
}
```

### Response

**Success (200 OK):**

```json
{
  "matches": [
    { "rules": ["jira-issue", "json-subject"], "watched": true },
    { "rules": ["slack-message", "json-participants"], "watched": true },
    { "rules": [], "watched": false }
  ]
}
```

### Response Schema

| Field     | Type          | Description                                     |
| --------- | ------------- | ----------------------------------------------- |
| `matches` | `PathMatch[]` | Match results for each input path (same order). |

**PathMatch:**

| Field | Type | Description |
| --- | --- | --- |
| `rules` | `string[]` | Ordered list of matching inference rule names. |
| `watched` | `boolean` | Whether the path is within watch scope (matches `watch.paths` and not in `watch.ignored`). |

### Behavior

- Each path is normalized and tested against all compiled inference rules
- Rules are returned in definition order (same order as `inferenceRules` array)
- `watched` tests against watch path matchers and ignore patterns
- Empty `rules` array means no inference rules match (but file may still be watched)
- `watched: false` means the path falls outside watch scope or is excluded by ignore patterns

**Use cases:**

- Pre-flight path testing before file creation
- Debugging rule match logic
- UI path validation in config editors

---

## POST /config/validate

Pre-flight validation of configuration changes without applying them.

### Request

```bash
curl -X POST http://localhost:1936/config/validate \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "inferenceRules": [
        {
          "name": "new-rule",
          "description": "Test rule",
          "match": { "type": "object" },
          "schema": [
            { "properties": { "domain": { "type": "string", "set": "test" } } }
          ]
        }
      ]
    },
    "testPaths": ["d:/docs/sample.md"]
  }'
```

**Body schema:**

```typescript
{
  config?: Record<string, unknown>;  // Partial or full config to validate
  testPaths?: string[];              // File paths to test rules against
}
```

### Merge Semantics

When `config` is partial, rules are merged by `name`: provided rules replace existing rules with the same name; unmatched existing rules are preserved.

### Response

**Valid (200 OK):**

```json
{
  "valid": true,
  "testResults": [
    {
      "path": "d:/docs/sample.md",
      "matchedRules": ["new-rule"],
      "metadata": { "domain": "test" }
    }
  ]
}
```

**Invalid (400 Bad Request):**

```json
{
  "valid": false,
  "errors": [
    { "path": "inferenceRules[0].match", "message": "Invalid JSON Schema" }
  ]
}
```

Validation includes checking that referenced helper files can be loaded.

---

## POST /config/apply

Deep-merge a partial config into the running config, validate, write, and reload.

### Request

```bash
curl -X POST http://localhost:1936/config/apply \
  -H "Content-Type: application/json" \
  -d '{
    "patch": {
      "inferenceRules": [
        {
          "name": "new-rule",
          "description": "Test rule",
          "match": { "type": "object" },
          "schema": [
            { "properties": { "domain": { "type": "string", "set": "test" } } }
          ]
        }
      ]
    }
  }'
```

**Body schema:**

```typescript
{
  patch: Record<string, unknown>; // Partial config to merge (`config` is accepted as an alias)
  replace?: boolean;              // true = replace the whole config instead of merging
}
```

### Response

**Success (200 OK):**

```json
{
  "applied": true,
  "config": { "...": "the validated merged config" }
}
```

**Validation failure (400 Bad Request):**

```json
{
  "code": "invalid_request",
  "error": "Config validation failed",
  "issues": [
    { "path": ["embedding", "dimensions"], "message": "Invalid input" }
  ]
}
```

### Behavior

1. Reads the config file the service was started with
2. Deep-merges the patch: objects merge recursively, arrays and scalars replace, `inferenceRules` merge by `name` (so `{ "patch": {} }` or a single key is valid)
3. Validates the merged config against the schema
4. Writes it atomically to the same file
5. Triggers a reindex using `configWatch.reindex` scope (default `issues`)

---

## POST /rules/register

Register virtual inference rules from an external source.

### Request

```bash
curl -X POST http://localhost:1936/rules/register \
  -H "Content-Type: application/json" \
  -d '{
    "source": "my-external-system",
    "rules": [
      {
        "name": "external-rule",
        "description": "Rule registered from external source",
        "match": { "type": "object" },
        "schema": [
          { "properties": { "domain": { "type": "string", "set": "external" } } }
        ]
      }
    ]
  }'
```

**Body schema:**

```typescript
{
  source: string;           // Identifier for the rule source
  rules: InferenceRule[];   // Array of inference rules to register
}
```

### Response

**Success (200 OK):**

```json
{
  "ok": true,
  "registered": 1
}
```

---

## DELETE /rules/unregister

Remove all virtual rules from a source.

### Request

```bash
curl -X DELETE http://localhost:1936/rules/unregister \
  -H "Content-Type: application/json" \
  -d '{ "source": "my-external-system" }'
```

**Body schema:**

```typescript
{
  source: string; // Source identifier to unregister
}
```

### Response

**Success (200 OK):**

```json
{
  "ok": true,
  "removed": 1
}
```

---

## DELETE /rules/unregister/:source

Remove all virtual rules from a named source (path parameter variant).

### Request

```bash
curl -X DELETE http://localhost:1936/rules/unregister/my-external-system
```

### Response

**Success (200 OK):**

```json
{
  "ok": true,
  "removed": 1
}
```

---

## POST /points/delete

Delete points from Qdrant matching a filter.

### Request

```bash
curl -X POST http://localhost:1936/points/delete \
  -H "Content-Type: application/json" \
  -d '{
    "filter": {
      "must": [{ "key": "domain", "match": { "value": "obsolete" } }]
    }
  }'
```

**Body schema:**

```typescript
{
  filter: Record<string, unknown>; // Qdrant filter object
}
```

### Response

**Success (200 OK):**

```json
{
  "ok": true
}
```

---

## POST /rules/reapply

Re-apply current inference rules to indexed files matching glob patterns, without re-embedding.

### Request

```bash
curl -X POST http://localhost:1936/rules/reapply \
  -H "Content-Type: application/json" \
  -d '{
    "globs": ["j:/domains/email/**"]
  }'
```

**Body schema:**

```typescript
{
  globs: string[];  // Non-empty array of glob patterns
}
```

### Response

**Success (200 OK):**

```json
{
  "matched": 150,
  "updated": 148
}
```

### Response Schema

| Field     | Type     | Description                       |
| --------- | -------- | --------------------------------- |
| `matched` | `number` | Files matching the glob patterns. |
| `updated` | `number` | Files successfully re-processed.  |

### Behavior

1. Scrolls all indexed points to find files matching the provided globs
2. For each matching file, re-applies current inference rules (metadata update only)
3. Files that fail re-processing are logged but don't abort the operation

**Use cases:**

- After editing inference rules, selectively re-apply to specific domains
- More targeted than `POST /reindex` with scope `rules` (which re-applies to everything)

---

## VCS Endpoints

Version control endpoints for git-backed content history. Requires `vcs.enabled: true` in config. See the [Version Control (VCS) Guide](./version-control.md) for architectural context, configuration, and operational details.

---

### GET /vcs/status

VCS state for all watch roots.

#### Request

```bash
curl http://localhost:1936/vcs/status
```

#### Response

**Success (200 OK):**

```json
{
  "enabled": true,
  "roots": [
    {
      "path": "d:/documents",
      "tracked": 1523,
      "lastCommit": {
        "hash": "a1b2c3d",
        "message": "update project notes and readme",
        "timestamp": "2026-06-10T14:30:00Z"
      },
      "remoteUrl": "https://github.com/org/docs-backup.git",
      "lastPush": "2026-06-10T14:30:05Z",
      "pushErrors": []
    }
  ]
}
```

| Field | Type | Description |
| --- | --- | --- |
| `enabled` | `boolean` | Whether VCS is enabled globally. |
| `roots` | `array` | Per-root VCS state. |
| `roots[].path` | `string` | Watch root path. |
| `roots[].tracked` | `number` | Number of tracked files in this root. |
| `roots[].lastCommit` | `object?` | Most recent commit (null if no commits yet). |
| `roots[].remoteUrl` | `string?` | Configured remote URL (if any). |
| `roots[].lastPush` | `string?` | ISO-8601 timestamp of last successful push. |
| `roots[].pushErrors` | `string[]` | Recent push error messages. |

---

### GET /vcs/history

Commit history for files matching a glob pattern.

#### Request

```bash
curl "http://localhost:1936/vcs/history?glob=d:/documents/**/*.md&limit=10&since=2026-06-01T00:00:00Z"
```

**Query parameters:**

| Param   | Type     | Default      | Description                       |
| ------- | -------- | ------------ | --------------------------------- |
| `glob`  | `string` | **Required** | Glob pattern to filter history.   |
| `since` | `string` | `undefined`  | ISO-8601 lower bound (inclusive). |
| `until` | `string` | `undefined`  | ISO-8601 upper bound (inclusive). |
| `limit` | `number` | `20`         | Max entries to return.            |

#### Response

**Success (200 OK):**

```json
[
  {
    "commit": "a1b2c3d",
    "message": "update project notes and readme",
    "timestamp": "2026-06-10T14:30:00Z",
    "files": [
      "d:/documents/projects/readme.md",
      "d:/documents/projects/notes.md"
    ]
  }
]
```

| Field       | Type       | Description                                      |
| ----------- | ---------- | ------------------------------------------------ |
| `commit`    | `string`   | Short commit hash.                               |
| `message`   | `string`   | Commit message.                                  |
| `timestamp` | `string`   | ISO-8601 commit timestamp.                       |
| `files`     | `string[]` | Files changed in this commit (filtered by glob). |

#### Behavior

Parses the git log for all roots matching the glob. Results are sorted by timestamp descending.

---

### GET /vcs/show

Retrieve file content at a specific commit.

#### Request

```bash
curl "http://localhost:1936/vcs/show?path=d:/documents/readme.md&commit=a1b2c3d"
```

**Query parameters:**

| Param    | Type     | Description                       |
| -------- | -------- | --------------------------------- |
| `path`   | `string` | **Required.** Absolute file path. |
| `commit` | `string` | **Required.** Commit hash.        |

#### Response

Returns the raw file content with an appropriate `Content-Type` header based on file extension.

#### Behavior

Resolves the watch root for the path, computes the relative path, and runs `git show {commit}:{relativePath}`.

---

### GET /vcs/diff

Unified diff between commits for files matching a glob.

#### Request

```bash
curl "http://localhost:1936/vcs/diff?glob=d:/documents/**/*.md&commit=a1b2c3d"
```

**Query parameters:**

| Param       | Type     | Description                                   |
| ----------- | -------- | --------------------------------------------- |
| `glob`      | `string` | **Required.** Glob pattern to filter files.   |
| `commit`    | `string` | **Required.** Start commit hash.              |
| `commitEnd` | `string` | End commit hash. Defaults to HEAD if omitted. |

#### Response

Returns unified diff text (`Content-Type: text/plain`).

#### Behavior

Resolves matching watch roots and runs `git diff {commit}..{commitEnd}` (or `..HEAD`) filtered to matching paths.

---

### POST /vcs/revert

Restore files from a historical commit. Forward-only — writes old content as new changes, HEAD never moves backward.

#### Request

```bash
curl -X POST http://localhost:1936/vcs/revert \
  -H "Content-Type: application/json" \
  -d '{
    "glob": "d:/documents/projects/**",
    "commit": "a1b2c3d",
    "existingOnly": true
  }'
```

**Body schema:**

```typescript
{
  glob: string;            // Glob pattern for files to revert
  commit: string;          // Commit hash to revert to
  existingOnly?: boolean;  // Only restore files that currently exist on disk (default: false)
}
```

#### Response

**Success (200 OK):**

```json
{
  "restored": 3,
  "files": [
    "d:/documents/projects/readme.md",
    "d:/documents/projects/notes.md",
    "d:/documents/projects/spec.md"
  ]
}
```

| Field      | Type       | Description               |
| ---------- | ---------- | ------------------------- |
| `restored` | `number`   | Number of files restored. |
| `files`    | `string[]` | Paths of restored files.  |

#### Behavior

1. Lists files at the specified commit matching the glob
2. Retrieves content via `git show` and writes to disk
3. Records reversion metadata — the resulting commit is prefixed with `revert: {glob} to {shortCommit}`
4. Triggers watcher file events for re-embedding

---

### POST /vcs/exclude

Manage `.gitignore` entries with locality-based placement.

#### Request

```bash
curl -X POST http://localhost:1936/vcs/exclude \
  -H "Content-Type: application/json" \
  -d '{
    "glob": "d:/documents/temp/**/*.tmp",
    "remove": false
  }'
```

**Body schema:**

```typescript
{
  glob: string;      // Glob pattern to add or remove
  root?: string;     // Watch root (resolved automatically if omitted)
  remove?: boolean;  // Remove the entry instead of adding (default: false)
}
```

#### Response

**Success (200 OK):**

```json
{
  "ok": true,
  "gitignorePath": "d:/documents/temp/.gitignore",
  "action": "added"
}
```

| Field | Type | Description |
| --- | --- | --- |
| `ok` | `boolean` | Success indicator. |
| `gitignorePath` | `string` | Path to the `.gitignore` file that was modified. |
| `action` | `string` | `"added"` or `"removed"`. |

#### Behavior

Splits the glob into a directory prefix and pattern suffix, then places the entry in a `.gitignore` at the deepest appropriate directory (locality principle).

---

### GET /vcs/check-exclusion

Check whether a file is excluded by `.gitignore`.

#### Request

```bash
curl "http://localhost:1936/vcs/check-exclusion?path=d:/documents/temp/scratch.tmp"
```

**Query parameters:**

| Param  | Type     | Description                                |
| ------ | -------- | ------------------------------------------ |
| `path` | `string` | **Required.** Absolute file path to check. |

#### Response

**Success (200 OK):**

```json
{
  "excluded": true,
  "rule": "**/*.tmp",
  "source": "d:/documents/temp/.gitignore"
}
```

| Field      | Type      | Description                                        |
| ---------- | --------- | -------------------------------------------------- |
| `excluded` | `boolean` | Whether the file is ignored by git.                |
| `rule`     | `string?` | The matching `.gitignore` pattern (if excluded).   |
| `source`   | `string?` | Path to the `.gitignore` file containing the rule. |

#### Behavior

Uses `git check-ignore -v` to determine exclusion status and the specific rule/source responsible.

---

## Error Handling

Since v0.20.0 every non-2xx response has this body (`apiErrorBodySchema` in `@karmaniverous/jeeves-watcher-core`):

```json
{
  "code": "invalid_request",
  "error": "Human-readable text",
  "message": "Optional longer explanation",
  "details": []
}
```

- `code` is machine-readable and stable: branch on it. The list is `API_ERROR_CODES` in core (type `ApiErrorCode`); codes may be added, never repurposed.
- `error` is the human-readable text earlier versions sent, unchanged, so older clients keep working. Do not parse it.
- `message` (optional) adds detail; `details` (optional) holds structured data such as the Zod issues of a `400`.
- `issueType` (optional) names the [issue code](#issue-codes) behind a failed source render.
- Some endpoints add fields of their own (`issues` on `POST /config/apply`).
- HTTP statuses did not change in v0.20.0.

| `code` | Status | Meaning |
| --- | --- | --- |
| `invalid_request` | `400` | The body, query or parameters failed validation, or the request was rejected before reaching a route (malformed JSON, unsupported media type: the framework's status is kept, e.g. `415`). |
| `unauthorized` | `401` | `api.apiKey` is set and the bearer token is missing or wrong. |
| `path_not_watched` | `403` | The file path is outside the watched scope (`POST /render`). |
| `not_found` | `404` | No such route, file, VCS watch root, file at a commit, `.gitignore` or `.gitignore` pattern. |
| `source_not_indexed` | `404` | No stored point for the source reference, so no designated rule is known (`POST /render`, `POST /metadata`). |
| `source_not_found` | `404` | The source callback answered `404` (`POST /render`). |
| `unsupported_content_type` | `422` | The source callback returned a non-JSON body (`POST /render`). |
| `pipeline_error` | `422` | Rendering or extraction failed; for a source document `issueType` names the failure. |
| `source_unavailable` | `502` | The source callback failed (`POST /render`). |
| `not_available` | `503` (`400` on `POST /reindex`) | The feature is not available on this instance: no source-document support, no vector store for prune, or no filesystem watcher (`POST /walk`). |
| `scan_in_progress` | `503` | The initial filesystem scan is still running (`POST /walk`); retry later. |
| `embedding_unavailable` | `503` | The embedding provider's retry budget ran out (`POST /search`); honour `Retry-After`. |
| `internal_error` | `500` | Unexpected server-side failure (check the service log). Errors not caught by a route answer `{ "code": "internal_error", "error": "Internal Server Error", "message": "Internal server error" }` and never include the underlying error. |

Per-document outcomes are not HTTP errors and use their own codes: `rejected[].error.code` of `POST /documents` (rejection codes) and `error.code` of `failed` results ([issue codes](#issue-codes)).

**Status codes:**

- `200 OK`: success
- `202 Accepted`: notifications queued (`POST /documents`)
- `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `422 Unprocessable Entity`, `500 Internal Server Error`, `502 Bad Gateway`, `503 Service Unavailable`: see the table above

---

## Authentication

**v0.20.0+.** Authentication is optional and off by default: without `api.apiKey`, the API is open, and is intended for localhost-only access (default `host: "127.0.0.1"`).

Set `api.apiKey` (usually through an environment variable) to require a bearer token:

```json
{
  "api": {
    "host": "0.0.0.0",
    "port": 1936,
    "apiKey": "${WATCHER_API_KEY}"
  }
}
```

```bash
curl -X POST http://watcher.internal.example:1936/search \
  -H "Authorization: Bearer $WATCHER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "password reset"}'
```

- Every route requires `Authorization: Bearer <apiKey>` (the `Bearer` scheme name is case-insensitive) — including unknown routes, the config, rules and VCS endpoints — **except `GET /status`** (and `HEAD /status`), which stays open for health checks.
- A missing, malformed or wrong token gets `401 { "code": "unauthorized", "error": "Unauthorized" }`. The presented token is never logged; rejections log only the method and path at `debug` level.
- The comparison is constant-time.
- An empty `apiKey` (`""`) fails closed: no token can match, so every route except `GET /status` answers `401`.
- If `apiKey` still contains an unresolved `${...}` after environment-variable substitution, loading the config fails and the service does not start.
- The key is read **at startup only**. Rotating it means changing the config (or the environment variable) and restarting the watcher, then updating every client.
- Clients send the key as follows:
  - **CLI** (`config`, `config apply`, `search`, `enrich`, `scan`, `reindex`, `rebuild-metadata`, `issues`, `helpers`): the `--api-key <key>` flag, else the `JEEVES_WATCHER_API_KEY` environment variable. These commands do not read the config file. Prefer the environment variable: a flag value is visible in the process list. See [CLI Reference](./cli-reference.md#authentication).
  - **OpenClaw plugin**: `plugins.entries.jeeves-watcher-openclaw.config.apiKey`, else `JEEVES_WATCHER_API_KEY`; sent on every tool request.
  - **SDK**: the [`apiKey` option](./source-documents.md#sdk).
  - On `401`, the CLI and the plugin say how to supply the key and never print it.
- `api` settings never appear in `GET /config`.

For TLS, or for authentication schemes other than a single shared key, put a reverse proxy in front of the watcher.

---

## Rate Limiting

The API itself has no request rate limit; add one at a reverse proxy if you need it.

The **embedding provider** is rate-limited. Since v0.20.0, one shared limiter wraps the provider and every caller draws from it: file watching, source-document notifications, reindex and search. See [`embedding.rateLimitPerMinute`](./configuration.md#embedding-rate-limiting) for the semantics (and the 0.20.0 behaviour change).

When the provider answers `429`, the limiter pauses **all** embedding requests for the provider's `Retry-After` (capped at `maxBackoffMs`), then retries. Indexing makes up to 5 attempts per embedding request and then records an `embedding_error` issue. Search makes up to 3 attempts and waits at most 10 seconds in total; when that budget runs out, `POST /search` answers `503 { code: "embedding_unavailable", error, message }` with a `Retry-After` header instead of `500`.

---

## CORS

**Not enabled by default.** To enable for browser access, modify the Fastify server initialization (code change required).

---

## Examples

### Search and Display Results

```bash
curl -X POST http://localhost:1936/search \
  -H "Content-Type: application/json" \
  -d '{"query": "billing integration", "limit": 5}' \
  | jq '.[] | {score, path: .payload.file_path, title: .payload.title}'
```

Output:

```json
{ "score": 0.91, "path": "d:/projects/billing/spec.md", "title": "Billing API Spec" }
{ "score": 0.87, "path": "d:/meetings/2026-02-15/notes.md", "title": "Billing Discussion" }
...
```

### Enrich Multiple Files

```bash
for file in file1.md file2.md file3.md; do
  curl -X POST http://localhost:1936/metadata \
    -H "Content-Type: application/json" \
    -d "{\"path\": \"$file\", \"metadata\": {\"reviewed\": true}}"
done
```

### Check Service Health

```bash
curl http://localhost:1936/status | jq '.uptime'
```

Output: `86400` (uptime in seconds)

---

## Next Steps

- [CLI Reference](./cli-reference.md) — CLI equivalents for these endpoints
- [Configuration Reference](./configuration.md) — API server settings
- [Source Documents](./source-documents.md) — Sources, the callback contract and notify semantics
- [Architecture Guide](./architecture.md) — How the API fits into the system
