---
title: API Reference
---

# API Reference

The watcher exposes a lightweight HTTP API for search, metadata enrichment, and operational control.

**Default address:** `http://127.0.0.1:1936` (configurable via `api.host` and `api.port`)

**Authentication:** none by default. When `api.apiKey` is set, every route except `GET /status` requires `Authorization: Bearer <key>`; see [Authentication](#authentication). The examples below omit the header.

**Request validation:** the bodies of `POST /metadata`, `/render`, `/search`, `/scan`, `/reindex`, `/documents`, `/documents/delete`, `/rules/register`, `/rules/reapply`, `/points/delete` and `DELETE /rules/unregister` (and the `POST /documents` query string) are validated against the Zod schemas exported by `@karmaniverous/jeeves-watcher-core`. An invalid body returns `400 { code: "invalid_request", error, details }`, where `error` is the first issue's message and `details` is the full Zod issue list. Unless a section says the schema is strict, unknown keys are dropped silently. The other routes (`POST /walk`, the `/config/*` routes, the VCS routes) check their required fields themselves; their `400` bodies carry no `details`.

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
  "name": "watcher",
  "version": "0.20.0",
  "uptime": 86400,
  "status": "healthy",
  "health": {
    "collection": {
      "name": "jeeves_archive",
      "pointCount": 10498,
      "dimensions": 3072
    },
    "reindex": {
      "active": true,
      "scope": "rules",
      "startedAt": "2026-03-15T02:00:00.000Z",
      "filesProcessed": 1200,
      "totalFiles": 4800
    },
    "initialScan": {
      "active": false,
      "filesMatched": 156576,
      "filesEnqueued": 156576,
      "completedAt": "2026-03-15T01:31:12.000Z",
      "durationMs": 552000
    }
  }
}
```

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | Always `"watcher"`. |
| `version` | `string` | Service package version. |
| `uptime` | `number` | Whole seconds since the API server was created. |
| `status` | `string` | `"healthy"`, or `"degraded"` when the health probe failed (for example Qdrant is unreachable); `health` then holds only `{ "error": "..." }`. |
| `health.collection` | `object` | Qdrant collection stats: `name`, `pointCount` (total points/chunks), `dimensions`. |
| `health.reindex` | `object` | Reindex progress. `active`; while active also `scope`, `startedAt`, `filesProcessed` and `totalFiles` (files plus source documents in the run; both stay `0` during a prune). `POST /reindex { scope: "path", source }` and `POST /documents` are not tracked here. |
| `health.initialScan` | `object?` | Initial filesystem scan after start (absent when there is no filesystem watcher). Only `{ "active": false }` before the scan starts; then `active`, `filesMatched`, `filesEnqueued`; `startedAt` while active; `completedAt` and `durationMs` once finished. |

> **v0.5.0 change:** `payloadFields` has been removed from the status response. Use [`GET /config`](#get-config) or [`GET /config/schema`](#get-configschema) to discover schema and payload field information.

**Status codes:**

- `200 OK` - always, also when `status` is `"degraded"`; check the `status` field, not the HTTP status.

The response is cached for `api.cacheTtlMs` (default 30 seconds), so progress counters can lag by that much.

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
  path?: string;   // File path (non-empty)
  source?: string; // Source reference <name>://<id> (v0.20.0+)
  metadata: Record<string, unknown>; // Metadata to merge (required object)
}
// Exactly one of path or source is required.
```

Schema: `metadataRequestSchema` in `@karmaniverous/jeeves-watcher-core`. Neither or both of `path` / `source`, a malformed reference, or a missing or non-object `metadata` (`error: "Missing required field: metadata (object)"`) is `400 invalid_request`.

### Response

**Success (200 OK):**

```json
{
  "ok": true,
  "matched_rules": ["chat-thread"]
}
```

`matched_rules` lists the rules the metadata was validated against. For a file these are the config `inferenceRules` (virtual rules are not consulted) whose `match` accepts the path alone: they are tested against synthetic attributes built from the path (no file is read, so rules that match on content or JSON fields do not apply). For a source document it is the designated rule.

**Validation error (400 Bad Request):**

```json
{
  "code": "invalid_request",
  "error": "Validation failed",
  "details": [
    {
      "property": "priority",
      "expected": "integer",
      "received": "string",
      "rule": "project-docs",
      "message": "Property 'priority' is declared as integer in project-docs schema, received string"
    }
  ]
}
```

> **v0.5.0:** Metadata is validated against the merged schema of the matched rules. Only the declared `type` of each property is checked; properties the schema does not declare, and `null` values, are accepted.

**Source not indexed (404, v0.20.0+):** `{ "code": "source_not_indexed", "error": "Source document not indexed" }`.

**Not available (503, v0.20.0+):** `not_available` for a `source` request on an instance without source-document support.

**Error (500 Internal Server Error):** the cause is logged, never returned. Every 5xx the API produces for an unexpected failure has this body:

```json
{
  "code": "internal_error",
  "error": "Internal Server Error",
  "message": "Internal server error"
}
```

### Behavior

Enrichment metadata lives in the enrichment store, a SQLite database at `<stateDir>/enrichments.sqlite` (default `stateDir`: `.jeeves-metadata`), keyed by file path or source reference. Writing to it merges shallowly: new keys are added and existing keys are overwritten.

**Files (`path`):**

1. Validates the metadata (see above).
2. Merges it into the file's enrichment-store entry, **before** checking whether the file is indexed.
3. Reads the file's chunk-0 point. When the file is indexed, writes the merged enrichment to every chunk with `setPayload` (no re-embedding). The stored `file_path` (casing included) and `matched_rules` are kept.
4. When the file is not indexed yet, nothing is written to Qdrant, but the stored enrichment is kept and merged into the payload when the file is indexed (its next filesystem event or a reindex). The response is still `200`.

A failure reading or writing Qdrant does not fail the request: it is logged (a failed payload write also records an `upsert_error` issue for the file), the response is `200`, and the enrichment stays stored.

**Source documents (`source`):**

- The document must be indexed: its designated rule is read from the stored `source_rule`. Otherwise the response is `404 source_not_indexed` and nothing is stored.
- When Qdrant cannot be read, the response is `500 internal_error` (v0.20.0+), never `404`: a failed read is not taken to mean "not indexed". A failed payload write is also `500`.
- The metadata is validated against the designated rule's schema (`400` on failure). The rule is looked up by name among the config rules, then the [virtual rules](#post-rulesregister) registered by plugins, so a document whose designated rule is virtual is validated too. A designated rule that no longer exists validates nothing (`matched_rules: []`).
- Without source support on the instance, a `source` request is `503 not_available`.
- It is stored in the enrichment store under the exact reference, written to every chunk with `setPayload` (no re-embedding, no callback), and merged again whenever the document is re-processed.

For both kinds, reserved system fields (`file_path`, `source`, `source_rule`, `chunk_*`, `total_chunks`, `content_hash`, `matched_rules`, `line_start`, `line_end`, `created_at`, `modified_at`) are dropped before any payload write, so metadata can never overwrite them. When a document is (re)indexed, its enrichment is merged over the rule metadata: scalars replace the rule value, arrays are unioned without duplicates.

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

Schema: `renderRequestSchema` in `@karmaniverous/jeeves-watcher-core`.

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
| `metadata` | `object` | Composed embedding properties from matched rules, with the document's stored enrichment merged in and `matched_rules` added. |

### Caching

- **Transformed responses** (template or render ran): cached via `withCache` with the configured TTL.
- **Passthrough responses** (no transform): `Cache-Control: no-cache` header set; bypasses the cache.
- **Source documents** (`source`): never cached (no cache read, no cache write) and always sent with `Cache-Control: no-cache`, because the record behind the callback can change at any time.

### Error Codes

| Code | Condition |
| --- | --- |
| `200` | Success |
| `400` | `invalid_request`: invalid body (neither or both of `path` / `source`, empty `path`, malformed reference) |
| `403` | `path_not_watched` (`error: "Path is outside watched scope"`): the path does not match `watch.paths` or matches `watch.ignored` |
| `404` | `not_found` (`error: "File not found"`); or `source_not_indexed` (`"Source document not indexed"`: no stored point, so no designated rule is known); or `source_not_found` (`"Source document not found"`: the callback answered `404`; points are left alone) |
| `422` | `pipeline_error`: rendering or extraction failed. `error` is the failure message and `issueType` the [issue code](#issue-codes): for a file `extraction_error` unless a pipeline stage tagged the failure with another code; for a source document `match_failed`, `rule_missing`, `no_content`, ... with `details` holding any AJV errors. `unsupported_content_type` (`issueType` of the same name) when the callback returned a non-JSON body |
| `502` | `source_unavailable`: the source callback failed (`issueType: "source_unavailable"`) |
| `503` | `not_available`: source render on an instance without source-document support |
| `500` | `internal_error`: unexpected failure, including a Qdrant read failure while looking up a source document's designated rule (generic body; the cause is only logged) |

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
| `uiHint` | `string` | UI rendering hint (e.g. `"dropdown"`, `"tags"`, `"date"`); `"dropdown"` when only `enum` is declared. |
| `values` | `unknown[]` | Known values: the `enum` values if declared; otherwise, for the enumerated hints `dropdown`, `tags`, `select` and `multiselect`, the sorted live values from the values index; otherwise `[]`. |
| `rules` | `string[]` | Which inference rules define this field. |

### Behavior

1. Resolves the schemas of the config `inferenceRules` via `mergeSchemas` (virtual rules registered by plugins are not included)
2. Extracts properties that declare `uiHint` or `enum` (`object` properties never become facets; a property without `type` is reported as `"string"`)
3. Deduplicates fields across rules (later rules override `uiHint` and `enum`)
4. Enriches with live distinct values from the values index
5. Schema structure is cached internally; rebuilt when rules change

If the rule schemas cannot be resolved, the error is logged and the response is `{ "facets": [] }`.

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
  query: string;                    // Natural language search query (non-empty)
  limit?: number;                   // Max results, positive integer (default: 10)
  offset?: number;                  // Skip N results for pagination, integer >= 0 (default: 0)
  filter?: Record<string, unknown>; // Qdrant filter object (optional)
}
```

Schema: `searchRequestSchema` in `@karmaniverous/jeeves-watcher-core`; the default limit is `SEARCH_DEFAULT_LIMIT` (10). The schema is strict (v0.20.0+): an unknown key such as `collapse` is a `400 invalid_request` instead of being silently ignored.

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

The `filter` parameter accepts a native [Qdrant filter object](https://qdrant.tech/documentation/concepts/filtering/). A filter Qdrant rejects (malformed condition, unknown match variant) is a `400 invalid_request` with `error: "Invalid filter"` and Qdrant's explanation as `message` (v0.20.0+). Use [`GET /config`](#get-config) or [`GET /config/schema`](#get-configschema) to discover available payload fields and their types, then construct filters accordingly. Common patterns:

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
      "content_hash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "chunk_text": "Machine learning is...",
      "domain": "projects",
      "title": "ML Overview"
    }
  },
  {
    "id": "uuid-chunk-1",
    "score": 0.82,
    "payload": {
      "file_path": "d:/projects/ml/readme.md",
      "chunk_index": 1,
      "total_chunks": 3
    }
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

Returned when the query cannot be embedded within the search budget (3 provider attempts, at most 10 seconds waiting on the shared rate limiter), or at once when the provider has asked for a pause longer than the root `maxBackoffMs`. A `Retry-After` header (seconds) is set when the limiter knows when it will accept requests again. See [Rate Limiting](#rate-limiting).

**Invalid filter (400 Bad Request, v0.20.0+):**

```json
{
  "code": "invalid_request",
  "error": "Invalid filter",
  "message": "Format error in JSON body: ..."
}
```

**Error (500 Internal Server Error):** generic body (`internal_error`), see [Error Handling](#error-handling).

### Response Schema

Each result is a Qdrant point:

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Qdrant point ID (deterministic UUID from file path or source reference + chunk index). |
| `score` | `number` | Cosine similarity score (higher is better), or the fused rank score when `search.hybrid.enabled` is set. |
| `payload` | `object` | Document metadata and chunk info. |

**Payload fields:**

| Field | Type | Description |
| --- | --- | --- |
| `file_path` | `string` | Normalized file path (forward slashes). File points only. |
| `source` | `string` | Source reference `<name>://<id>`. Source points only (v0.20.0+). |
| `source_rule` | `string` | Designated rule of a source document. Source points only (v0.20.0+). |
| `chunk_index` | `number` | Chunk index (0-based). |
| `total_chunks` | `number` | Total chunks for this document. |
| `content_hash` | `string` | SHA-256 hex digest of the document text that was chunked and embedded (extracted or rendered). |
| `chunk_text` | `string` | Text content of this chunk. |
| `matched_rules` | `string[]` | Names of the rules applied to the document. |
| `line_start`, `line_end` | `number` | 1-based lines of the document text where the chunk starts and ends. |
| `created_at`, `modified_at` | `number` | Document timestamps (Unix seconds). |
| _Custom fields_ | `any` | Metadata from inference rules and `POST /metadata`. |

### Behavior

1. Embeds the query text using the configured embedding provider
2. Searches Qdrant using cosine similarity; with `search.hybrid.enabled`, fuses the vector results with full-text matches on `chunk_text` (reciprocal rank fusion, text weighted by `search.hybrid.textWeight`, default `0.3`)
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
  limit?: number;                    // Page size, integer 1-1000 (default: 100)
  cursor?: string | number;          // Opaque cursor from previous response
  fields?: string[];                 // Payload field projection
  countOnly?: boolean;               // If true, return { count } instead of points
}
```

Schema: `scanRequestSchema` in `@karmaniverous/jeeves-watcher-core`; the default page size is `SCAN_DEFAULT_LIMIT` (100) and the maximum `SCAN_MAX_LIMIT` (1000).

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
  "cursor": "5f0c3e2a-8b1d-5c4e-9a7f-2d6b8e1c0a93"
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

| Code | Condition |
| --- | --- |
| `200` | Success |
| `400` | `invalid_request`: missing or non-object `filter` (`error: "Missing required field: filter (object)"`), a `limit` outside 1 to 1000 (`"limit must be between 1 and 1000"`) or not an integer (`"limit must be an integer"`), or a filter Qdrant rejects (`error: "Invalid filter"`, Qdrant's reason as `message`) |
| `500` | `internal_error`: unexpected failure (generic body) |

### Behavior

1. Validates the body (`filter` must be an object; `limit` out of range is rejected, never clamped)
2. If `countOnly`: calls Qdrant `count()` with exact mode and returns `{ count }`
3. Otherwise: calls Qdrant `scroll()` with the filter, limit, cursor, and optional field projection
4. Returns matched points and an opaque cursor for the next page

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

## POST /walk

List watched files whose paths match globs, from the filesystem watcher's in-memory file list (no filesystem reads, no Qdrant).

### Request

```bash
curl -X POST http://localhost:1936/walk \
  -H "Content-Type: application/json" \
  -d '{"globs": ["/data/domains/email/**/*.json"]}'
```

**Body schema:**

```typescript
{
  globs: string[]; // Non-empty array of glob patterns
}
```

### Response

**Success (200 OK):**

```json
{
  "paths": ["/data/domains/email/archive/msg-456.json"],
  "matchedCount": 1,
  "scannedRoots": ["/data/domains"]
}
```

| Field | Type | Description |
| --- | --- | --- |
| `paths` | `string[]` | Entries of the watcher's list matching any of the globs. |
| `matchedCount` | `number` | Length of `paths`. |
| `scannedRoots` | `string[]` | Resolved base directories of the configured `watch.paths`. |

Globs are matched against slash-normalised paths, case-insensitively, dotfiles included. `paths` and `scannedRoots` are returned in the platform's native form (backslashes on Windows).

### Error Codes

| Code | Condition |
| --- | --- |
| `400` | `invalid_request` (`error: "Missing globs"`, `message: "The \"globs\" field is required and must be a non-empty string array."`): `globs` is missing, not an array, or empty (the entries' types are not checked) |
| `503` | `not_available` (`"Watcher unavailable"`): the instance has no filesystem watcher; `scan_in_progress` (`"Scan in progress"`): the initial filesystem scan is still running, retry later |
| `500` | `internal_error`: unexpected failure, including a request without a JSON body (generic body) |

---

## POST /rebuild-metadata

Rebuild the enrichment store from Qdrant file point payloads.

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

**Error (500 Internal Server Error):** generic body (`internal_error`), see [Error Handling](#error-handling).

No request body is needed.

### Behavior

1. Scrolls all Qdrant points in the collection
2. Skips every point without a non-empty `file_path`: source documents are never touched
3. For each file point, drops every reserved system field (`isReservedPayloadField` in `@karmaniverous/jeeves-watcher-core`: `file_path`, `source`, `source_rule`, `chunk_index`, `chunk_text`, `total_chunks`, `content_hash`, `matched_rules`, `line_start`, `line_end`, `created_at`, `modified_at`) and merges the remaining payload fields into the file's entry in the enrichment store (`<stateDir>/enrichments.sqlite`)

Qdrant payloads do not distinguish enrichment from rule metadata, so every remaining field, rule-inferred ones included, becomes stored enrichment for the file.

**Use cases:**

- Enrichment store corruption or accidental deletion
- Migrating to a new machine (copy Qdrant snapshot, rebuild the enrichment store)
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
  path?: string | string[];   // Scope "path": files or directories; scope "rules": globs
  source?: string | string[]; // Source references for scope "path" (v0.20.0+), at most 1000
  dryRun?: boolean;           // Compute plan without executing (default: false)
}
// Scope "path" requires exactly one of path or source; source is only valid with scope "path".
```

Schema: `reindexRequestSchema` in `@karmaniverous/jeeves-watcher-core`. Paths must be non-empty strings and an array must not be empty. `source` accepts at most 1000 references per request (`MAX_REINDEX_SOURCES_PER_REQUEST`); split larger sets into several requests. `path` is ignored by the scopes `issues`, `full` and `prune`.

**Examples:**

```bash
# Rules-only reindex (re-apply inference rules, no re-embedding)
curl -X POST http://localhost:1936/reindex \
  -H "Content-Type: application/json" \
  -d '{"scope": "rules"}'

# Full reindex (re-process every watched file; re-embed every source document)
curl -X POST http://localhost:1936/reindex \
  -H "Content-Type: application/json" \
  -d '{"scope": "full"}'

# Re-process only documents with issues
curl -X POST http://localhost:1936/reindex \
  -H "Content-Type: application/json" \
  -d '{"scope": "issues"}'

# Re-process a specific directory
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
| `byRoot` | `object` | Files to process grouped by watch root prefix, plus source documents to process grouped by source name. For a prune: orphaned **files** (not points) grouped by watch root. Files outside every root count under `"(unmatched)"`. Root containment is separator-aware (`/docs` does not contain `/docs2`). |
| `incomplete` | `boolean?` | Prune only: `true` when the Qdrant scroll failed part-way (after 5 attempts per page), so the counts are partial. A live prune with an incomplete plan deletes nothing. |

The reindex runs **asynchronously**: the API returns immediately with the plan. Use `GET /status` to track progress.

The plan is computed once per request, before the response: the files listed and the source documents discovered for it are the ones the run then processes (no second listing or Qdrant scroll). An invalid `path` target is therefore an HTTP error (see below), and so is a failure while planning (for example Qdrant unreachable during source discovery: `500 internal_error`). Once the run has started, failures are logged and reported to the [completion callback](#completion-callback), never as an HTTP error.

**Error codes:**

| Code | Condition |
| --- | --- |
| `200` | Success (started or dry_run) |
| `400` | `invalid_request`: invalid body (unknown scope, missing `path`/`source` for scope `path`, both given, `source` outside scope `path`, empty path or array, malformed reference, more than 1000 references), or a scope-`path` target that is neither a file nor a directory (`"Path is neither a file nor a directory: <path>"`). `not_available` (`message: "Prune scope requires vectorStore to be configured."`): prune without a vector store, the one code whose status does not follow the [code table](#error-handling) (`400` kept from 0.19) |
| `403` | `path_not_watched`: a scope-`path` target is outside the watch scope (`error: "Path is outside watch scope: <path>"`) or gitignored (`"Path is gitignored: <path>"`) (v0.20.0+; was `500`) |
| `404` | `not_found`: a scope-`path` target does not exist (`"Path not found: <path>"`) (v0.20.0+; was `500`) |
| `503` | `not_available`: `source` on an instance without source-document support (v0.20.0+) |
| `500` | `internal_error`: unexpected failure, including a planning failure (generic body) |

### Scopes

#### `issues` (default)

Re-processes documents with open issues (from `GET /issues`): files, and source references. An indexed source document is re-processed with its stored designated rule; a reference that was never indexed (its first notification failed, so it has no points) is retried with the `rule` recorded on its issue. A reference with neither is counted in `total` but skipped. Use after fixing the root cause of failures (permissions, encoding, file format, a source outage).

#### `rules`

Re-reads file attributes, re-applies current inference rules, updates Qdrant payloads of indexed files (changed values are written, keys the rules no longer project are removed; files that are not indexed are skipped). **No re-embedding** for files. Use after editing inference rules.

With `path`, the entries are globs matched (case-insensitively) against the watched files, and only matching files are covered. Without `path`, every watched file is covered and so are the source documents: each is retrieved through its callback and its stored rule re-applied. Unchanged content gets a metadata-only `setPayload`; if the rule now renders different text, the document is re-embedded.

#### `full`

Re-processes every watched file through the full pipeline (extract, apply rules, render) and clears the values index first. A file is re-embedded and re-upserted only when its rendered text changed: a file whose text hashes to the `content_hash` stored on its chunk 0 is skipped without an embedding call and its payload is not rewritten. Source documents are retrieved through their callbacks and **always re-embedded** (forced). Use after adding watch paths or changing rules that alter rendered text. Unchanged files are not re-embedded after an embedding provider or chunk size change; delete their points (for example with [`POST /points/delete`](#post-pointsdelete)) or re-create the collection first.

#### `path`

With `path`: re-processes a specific file or all watched files under a directory (globs are not expanded here), with the same unchanged-content skip as `full`. Each target must match `watch.paths` and not `watch.ignored` (a directory target must itself match, e.g. with a `/**` watch glob) and must not be gitignored (`403 path_not_watched`); it must exist (`404 not_found`). Directory containment is separator-aware: `/docs` covers `/docs/a.md`, never `/docs2/a.md`. A file named directly and found again by expanding its directory is processed once. Use for targeted re-embedding without a full reindex.

With `source` (v0.20.0+): looks up each distinct reference's stored designated rule (up to `reindex.concurrency` lookups in flight, default `50`) and **enqueues** the indexed ones on the notify queue, exactly as `POST /documents` does: they coalesce with concurrent notifications and failures land in `GET /issues`. References that are not indexed are skipped: they count in `total` but not in `toProcess`. This form is not a tracked run: `GET /status` does not show it and no completion callback is sent. `plan.byRoot` counts the enqueued references by source name.

#### `prune`

Lists the watched files, scrolls all Qdrant points, and batch-deletes orphaned file points: those whose `file_path` is not a watched file (outside the watch scope, ignored or gitignored), whose file no longer exists on disk, or that have no `file_path` at all. **No re-embedding, no file content reads**: a file listing, a Qdrant scroll, existence checks and deletes. Use after changing `watch.paths`, adding gitignore rules, or to clean up stale data (e.g., indexed `node_modules`).

Prune **never** selects source points (a non-empty `source` and no `file_path`): source documents are removed only by a callback `404` or [`POST /documents/delete`](#post-documentsdelete). A legacy file point that carries a rule-written `source` field is still a file point and is pruned like any other. The file and notify queues are paused (and in-flight work drained) while a prune plans and runs.

**Note:** `prune` is NOT valid for the config-watch auto-trigger (`configWatch.reindex`). It can only be triggered via explicit API calls.

### Source Documents

Explicit `POST /reindex` requests cover source documents as described above; a reindex triggered by a config change (`configWatch.reindex`, `POST /config/apply`) or by rule registration covers **files only**. Source documents are discovered from Qdrant (chunk-0 source points: a non-empty `source` and no `file_path`), retrieved through their callbacks, and processed with their stored `source_rule`; one without a stored `source_rule` counts in `total` but is skipped. Up to `reindex.concurrency` (default `50`) documents are submitted at once; the notify queue's own concurrency still applies. In every scope a callback `404` deletes the document and any other failure records an issue and leaves its points untouched.

Every source run goes through the notify queue, like a notification: a reindex and a notification of the same reference never run in parallel, they coalesce (a pending `full` run stays forced if a notification merges into it), and the latest record wins. See the [Source Documents guide](./source-documents.md#reindex-prune-and-deletion).

### Dry Run

When `dryRun: true`, the plan is computed and returned synchronously without starting the async job. Works for all scopes. Use to preview impact before committing to a large operation.

### Reindex Tracking

While a reindex is running, `GET /status` shows the active reindex state under `health`:

```json
{
  "health": {
    "reindex": {
      "active": true,
      "scope": "rules",
      "startedAt": "2026-02-24T08:00:00Z",
      "filesProcessed": 1200,
      "totalFiles": 4800
    }
  }
}
```

### Completion Callback

If `reindex.callbackUrl` is configured, the watcher sends a POST request (JSON body) to that URL when a tracked reindex completes (every run except `POST /reindex { scope: "path", source }`, which only enqueues):

```json
{
  "scope": "rules",
  "filesProcessed": 1234,
  "durationMs": 45000,
  "errors": [],
  "sources": { "indexed": 12, "unchanged": 300, "deleted": 1, "failed": 2 }
}
```

| Field | Description |
| --- | --- |
| `scope` | The run's scope. |
| `filesProcessed` | Files whose processing completed (`0` for a prune or a failed run). |
| `durationMs` | Run duration. |
| `errors` | The failed file paths, then the failed source references. A failure inside the pipeline (extraction, embedding, upsert) is recorded as an issue and does not count here; only a file whose processing threw is listed. When the run fails as a whole (including a live prune whose planning fails), `errors` holds the failure message and `filesProcessed` is `0`. |
| `sources` | v0.20.0+, only when the run covered source documents: counts by outcome (`indexed`, `unchanged`, `deleted`, `failed`). Failed documents are also recorded in `GET /issues`. |
| `pointsDeleted` | Prune only: points deleted. |

A failing file or source document never stops the run: it is logged and collected, and the rest still run. A live prune whose plan is incomplete is aborted without deleting anything and sends no callback.

Delivery is attempted up to 3 times, with exponential backoff (1 second, then 2 seconds); a non-2xx response counts as a failure. When every attempt fails the failure is logged (`Reindex callback delivery failed; giving up`) and the run's result is unaffected: callback delivery never throws, and a reindex started fire-and-forget never rejects.

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

Schema: `documentsEnvelopeSchema` (the request shape of `documentsRequestSchema` with `source` validated per document) and `documentsQuerySchema` in `@karmaniverous/jeeves-watcher-core`; at most `MAX_DOCUMENTS_PER_REQUEST` (100) documents. Notify only: there is no push form. Document entries are strict: unknown keys (for example inline `text`) fail the request with `400`. A malformed reference rejects only its own document (`invalid_reference`).

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
| `failed` | `error.code` is a rejection code above or an [issue code](#issue-codes); existing points are untouched. `details` holds AJV errors for `match_failed` and the per-rule errors for `interpolation_error`. |

A designated rule whose `match` rejects the record is never an HTTP error: asynchronously it becomes a `match_failed` issue, with `?wait=true` a `failed` result.

**Errors:**

| Code | Condition |
| --- | --- |
| `400` | `invalid_request`: `documents` missing, empty or over 100 entries; missing or empty `source`/`rule`; unknown keys in a document; invalid `wait` (the query and body are validated before source support is checked) |
| `401` | `unauthorized`: `api.apiKey` is set and the bearer token is missing or wrong |
| `503` | `not_available`: the instance's document processor does not support source documents |
| `500` | `internal_error`: unexpected failure, including an unexpected processing error with `?wait=true` (a stopping queue is reported per document as `queue_stopped` instead) |

### Behavior

- Notifications are queued in memory, keyed by reference. A notification for a pending reference merges with it; one for an in-flight reference triggers exactly one more run after the current one. Every run retrieves the current record, so the latest state always wins. See [coalescing](./source-documents.md#notifications-queuing-and-coalescing).
- `?wait=true` uses the same queue (concurrency and coalescing apply) and waits for the results. Use it for backfills and tests.
- Up to `embedding.concurrency` references are processed at once (default `5`).
- The `error.code` values are typed in `@karmaniverous/jeeves-watcher-core`: rejection codes (`documentRejectionCodeSchema`) plus issue types (`documentFailureCodeSchema` covers both).
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
{ sources: string[] }                // 1 to 1000 <name>://<id> references
{ filter: Record<string, unknown> }  // native Qdrant filter with at least one condition
```

Schema: `documentsDeleteRequestSchema` in `@karmaniverous/jeeves-watcher-core`. Both forms are strict (no other keys). `sources` accepts at most `MAX_DELETE_SOURCES_PER_REQUEST` (1000) references (v0.20.0+); split larger sets into several requests.

### Response

```json
{ "deleted": 1 }
```

`deleted` counts **documents** (distinct references), not points.

### Behavior

- The filter is always constrained to source points: the caller's filter is nested inside a condition that requires a non-empty `source` **and** an empty `file_path`. A filter can never delete a file point, whatever it names (even a legacy file point whose rule wrote a `source` field). The `sources` form carries the same `file_path` guard.
- A filter without any condition is rejected with `400 invalid_request` (v0.20.0+): `{}`, `{ "must": [] }` and filters whose clauses are all empty, at any depth. To remove every source document, name a condition explicitly (for example `{ "must": [{ "key": "source_rule", "match": { "any": [...] } }] }`). The SDK refuses such filters before sending them.
- A filter Qdrant rejects is `400 invalid_request` (`error: "Invalid filter"`); nothing is deleted.
- Every chunk of each matching document is deleted.
- Enrichment metadata and issues are removed for the deleted references, and, in the `sources` form, for every listed reference (so a document that only ever failed leaves no issue behind).
- Deletion does not touch the source system. If the owner notifies the reference again (or a notification for it was still queued), it is retrieved and indexed again.

**Errors:** `400 invalid_request` for an invalid body (both or neither of `sources`/`filter`, an empty `sources` array or one over 1000 references, a malformed reference, a condition-free filter, an unknown key) or a filter Qdrant rejects; `500 internal_error` (generic body) for an unexpected failure. This route does not depend on source-document support: it never answers `503`.

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
| `rule` | `string?` | Rule name for single-rule issues; for a source document, its designated rule (recorded on every source failure). |
| `types` | `string[]?` | Declared types for type collision issues. |
| `message` | `string` | Human-readable error message. |
| `details` | `unknown?` | Structured details (JSON), e.g. the AJV errors of a `match_failed` issue. |
| `timestamp` | `number \| string` | Unix timestamp (seconds) or ISO string of last occurrence. |

### Issue Codes

Every issue record carries one code from a single canonical list (`ISSUE_TYPES` in `@karmaniverous/jeeves-watcher-core`). The same codes appear as `error.code` in `failed` results of `POST /documents?wait=true` (where a notification that failed synchronous validation carries its rejection code instead, e.g. `invalid_reference`).

| Code | Applies to | Meaning |
| --- | --- | --- |
| `type_collision` | files, sources | Matched rules declare the same property with incompatible types. |
| `interpolation_error` | files, sources | A `set` expression, `template` or `render` could not be resolved. A **file** is still indexed (without the failed values) and the issue records the failures; a **source document** fails and nothing is written. `details` holds one entry per failed rule step. |
| `extraction_error` | files, sources | Reading or extracting the document, applying rules, or chunking failed. Also the code for any failure no stage tagged. |
| `embedding_error` | files, sources | The embedding provider failed, including a rate-limit retry budget that ran out. |
| `upsert_error` | files, sources | Writing to or deleting from the vector store failed. |
| `match_failed` | sources | The designated rule's `match` rejected the retrieved record. Nothing was written. |
| `rule_missing` | sources | The designated rule does not exist (any more). Points untouched. |
| `no_content` | sources | The callback returned an empty JSON object, or the designated rule rendered no text. Nothing was written. |
| `source_unavailable` | sources | The callback failed: any status other than `200`/`404` (redirects included), a timeout, a network error, a body that is not valid JSON, a body over 10 MiB (`response too large`), or no sources configured. Points untouched. |
| `unsupported_content_type` | sources | The callback answered `200` with a content type other than `application/json`, or with JSON that is not an object. Points untouched. |

Issue files written by versions before 0.20.0 contain only `type_collision` and `interpolation_error` and still load unchanged.

Source-document issues (v0.20.0+) always carry `rule` (the designated rule of the failed run). `POST /reindex { "scope": "issues" }` uses it to retry a reference that was never indexed. `details` carries structured context where there is any: the AJV errors of `match_failed`, the per-step failures of `interpolation_error`.

### Behavior

The issues file is self-healing:

- A document whose processing failed is logged and **not written**; a source document's existing points are left untouched. (A file whose only problem is an `interpolation_error` is still indexed, without the failed values.)
- Successful re-processing (config fix, file edit, re-notification, reindex) **clears** the entry
- A source document that is deleted (callback `404` or `POST /documents/delete`) has its entry cleared
- The response represents the current set of unresolved problems, cached for `api.cacheTtlMs` (default 30 seconds)

**Empty response:**

```json
{
  "count": 0,
  "issues": {}
}
```

---

## GET /config

Return the merged virtual configuration document, optionally filtered with a JSONPath expression. (Earlier guides described this as `POST /config/query`; that route does not exist.)

### Request

```bash
# Whole document
curl http://localhost:1936/config

# JSONPath filter (URL-encoded)
curl "http://localhost:1936/config?path=%24.inferenceRules%5B*%5D.name"
```

**Query string:** `path`: optional JSONPath expression (evaluated with `jsonpath-plus`).

### Response

**Success (200 OK):** the whole document, or `{ "result": [...], "count": n }` for a `path` query.

```json
{
  "result": ["email-classifier", "meeting-tagger", "project-labeler"],
  "count": 3
}
```

An invalid JSONPath expression is `400 { "code": "invalid_request", "error": "<parser message>" }`. A failure building the document is logged and answered with the generic `500 internal_error` body. Responses are cached for `api.cacheTtlMs` (default 30 seconds).

### Merged Document Shape

The query runs against a virtual document with exactly these top-level keys (the allow-list `PUBLIC_CONFIG_KEYS`, plus `issues`):

- `description` (`""` when unset), `watch`, `configWatch`, `search`, `schemas`, `maps`, `templates`: from the running configuration (`maps`, `templates` and `.json` rule `map` file references are resolved to their contents; named schema references in a rule's `schema` are expanded).
- `inferenceRules`: the config rules (`source: "config"`) followed by the [virtual rules](#post-rulesregister) registered by plugins (`source`: the registering source). Each rule carries `values`: the distinct values seen per property (replaces the old `payloadFields` of `/status`). Values are collected from files only: source documents never feed the values index (v0.20.0+).
- `mapHelpers`, `templateHelpers`: the configured helper modules, with their introspected `exports` when available.
- `issues`: the current runtime issues (as in `GET /issues`).

Everything else (`api` including `api.apiKey`, `sources` with callback URLs and headers, `embedding` and `vectorStore` with provider keys, `stateDir`, `logging`, `vcs`, ...) is never included, with or without a `path`.

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

- Top-level fields `description`, `search` (`scoreThresholds`), `schemas`, `inferenceRules`, `maps`, `templates`, `templateHelpers`, `mapHelpers` (and a legacy `slots` entry, which is not a config key)
- Runtime-injected fields (`inferenceRules[].values`, `issues`)

The schema is generated from Zod using `z.toJSONSchema()` and describes the queryable surface exposed by [`GET /config`](#get-config).

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

A body whose `paths` is not an array is `400 { "code": "invalid_request", "error": "Request body must include \"paths\" array" }`; a request without a JSON body fails with the generic `500`.

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

- Each path is normalized and tested against the config `inferenceRules` (virtual rules are not included), using synthetic attributes built from the path alone: no file is read, so rules that match on content or JSON fields do not match here
- Rules are returned in definition order (same order as `inferenceRules` array)
- `watched` tests against the `watch.paths` and `watch.ignored` globs (case-sensitive; gitignore rules are not consulted)
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

`config` is merged into the **running** configuration (as loaded, after `${ENV_VAR}` substitution) one level deep: each top-level key it contains replaces the running value as a whole (unlike [`POST /config/apply`](#post-configapply), nested objects are not merged), except `inferenceRules`, which merge by `name`: provided rules replace existing rules with the same name, new ones are appended, and unmatched existing rules are preserved. Without `config`, the running configuration itself is validated.

`testPaths` are matched against the candidate rules using each file's path and stat attributes (its content is not read). A path that cannot be stat'ed gets `{ "matchedRules": [], "metadata": {}, "error": "File not found" }`; `testResults` is omitted when there are none.

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

**Invalid (also 200 OK):** an invalid config is a successful validation with a negative result, not an HTTP error. The route has no `400` of its own: only malformed JSON is rejected (by the framework, `400 invalid_request`). A request without a JSON body fails with the generic `500`.

```json
{
  "valid": false,
  "errors": [
    {
      "path": "api.apiKey",
      "message": "api.apiKey must be a non-empty string (remove it to disable authentication)"
    }
  ]
}
```

`errors[].path` is the dotted config path (for schema failures) or names the rule (`inferenceRules[<name>]`) or helper whose check failed. Validation stops at the first failing stage (schema, helper files, rule schemas), and an invalid result carries no `warnings`.

**Valid with warnings (200 OK, v0.20.0+):**

```json
{
  "valid": true,
  "warnings": [
    {
      "path": "sources.app.timeout",
      "message": "Unknown source setting \"timeout\" is ignored (supported: url, headers, timeoutMs, concurrency)."
    }
  ]
}
```

Validation includes checking that referenced helper files can be loaded. Warnings (never failures) report unknown keys under `sources.<name>` and rule schema properties that use a [reserved payload field](./source-documents.md#files-and-source-documents) name; the same warnings are logged at startup and on config reload.

Schema checks added in v0.20.0 make these configs **invalid**: an empty `api.apiKey` (also after `${ENV_VAR}` substitution), and a `vectorStore.payloadIndexes` entry repeating a field or naming the system-indexed `source` / `source_rule`.

---

## POST /config/apply

Deep-merge a partial config into the config file the service runs from, validate it, write it, and trigger a reindex.

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
  patch?: Record<string, unknown>; // Partial config to merge (`config` is accepted as an alias; default {})
  replace?: boolean;               // true = the patch replaces the whole config instead of merging
}
```

The body has no core schema; other keys are ignored. A `patch` that is not an object is `400` with `issues: [{ "path": ["patch"], "message": "patch must be an object" }]`.

### Response

**Success (200 OK):**

```json
{
  "applied": true,
  "config": {
    "watch": { "paths": ["j:/domains/**"], "ignored": [] },
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
}
```

| Field | Type | Description |
| --- | --- | --- |
| `applied` | `true` | The file was written. |
| `config` | `object` | The validated config, reduced to the same allow-list as [`GET /config`](#get-config) (`PUBLIC_CONFIG_KEYS`: `description`, `watch`, `configWatch`, `search`, `schemas`, `inferenceRules`, `mapHelpers`, `templateHelpers`, `maps`, `templates`; only the keys present). `api`, `sources`, `embedding`, `vectorStore` and every other key, so every secret, is never echoed (v0.20.0+). |
| `warning` | `string?` | Present when the file was written but the post-write step that triggers the reindex failed: `"Config written but callback failed: <message>"`. The status is still `200`. |

**Validation failure (400 Bad Request):** `issues` holds the Zod issues of the merged config (there is no `details`):

```json
{
  "code": "invalid_request",
  "error": "Config validation failed",
  "issues": [
    {
      "expected": "number",
      "code": "invalid_type",
      "path": ["embedding", "dimensions"],
      "message": "Invalid input: expected number, received string"
    }
  ]
}
```

**Server failure (500, v0.20.0+):** when the config file cannot be read (or does not hold a JSON object) or cannot be written, the cause (which names the file) is logged and the response is the generic `internal_error` body. An unreadable file is left untouched.

### Behavior

1. Reads the raw config file the service was started with (not the running, environment-substituted config)
2. Deep-merges the patch: objects merge recursively, arrays and scalars replace, `inferenceRules` merge by `name` (so `{ "patch": {} }` or a single key is valid). With `replace: true` the patch is the new config
3. Validates the merged config against the config schema
4. Writes the merged raw object (not the schema's parsed output: unknown keys are kept, defaults are not added) atomically to the same file, keeping its permission bits
5. Triggers a **file-only** reindex with the running config's `configWatch.reindex` scope (default `issues`)

The new settings take effect when the config watcher reloads the file (`configWatch.enabled`, default `true`); that reload triggers the configured `configWatch.reindex` scope again. With config watching off, restart the service to load the file.

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
  source: string;           // Identifier for the rule source (non-empty)
  rules: InferenceRule[];   // Array of inference rules to register (each with a non-empty name)
}
```

Schema: `rulesRegisterRequestSchema` in `@karmaniverous/jeeves-watcher-core` (v0.20.0+). It checks `source` and that every rule is an object with a `name`; the rest of each rule is validated when it is compiled.

### Response

**Success (200 OK):**

```json
{
  "source": "my-external-system",
  "registered": 1,
  "totalVirtualRules": 4
}
```

`totalVirtualRules` is the number of virtual rules registered across all sources after this registration.

Registering replaces the source's previous rules, rebuilds the processor's rule set (config rules plus all virtual rules) and, when any virtual rule matches on a `file.path` glob (`match.properties.file.properties.path.glob`), starts a **file-only** `rules` reindex of the watched files under the globs of all virtual rules. That reindex is tracked in `GET /status` and reported to the completion callback.

Virtual rules live in memory: a restart loses them and they must be registered again. A config reload rebuilds the processor's rule set from the config rules alone: registered virtual rules stay in the store (and in `GET /config`) but stop applying to processing until the next register or unregister call.

**Errors (v0.20.0+; these were `500` before):** `400 invalid_request` when `source` is missing or empty (`error: "Missing required field: source"`), `rules` is not an array (`"Missing required field: rules (array)"`), a rule is not an object with a `name` (`"Every rule must be an object with a name"`), or the rules do not compile, for example two rules share a name or a `match` schema is invalid (`error: "Invalid rules"`, the compiler's explanation in `message`). Nothing is registered then.

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
  "source": "my-external-system",
  "removed": true
}
```

`removed` is `false` when the source had no rules. When rules were removed, the processor's rule set is rebuilt and, if the remaining virtual rules match on `file.path` globs, a file-only `rules` reindex runs as for registration. A missing or empty `source` is `400 invalid_request` (`error: "Missing required field: source"`; schema `rulesUnregisterRequestSchema`; v0.20.0+, was `500`).

---

## DELETE /rules/unregister/:source

Remove all virtual rules from a named source (path parameter variant).

### Request

```bash
curl -X DELETE http://localhost:1936/rules/unregister/my-external-system
```

Same behaviour as the body variant; the `:source` path segment is the source.

### Response

**Success (200 OK):**

```json
{
  "source": "my-external-system",
  "removed": true
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

Schema: `pointsDeleteRequestSchema` in `@karmaniverous/jeeves-watcher-core` (v0.20.0+).

### Response

**Success (200 OK):**

```json
{
  "deleted": 42
}
```

`deleted` counts points. Unlike [`POST /documents/delete`](#post-documentsdelete), this route applies the filter as given, to file and source points alike, and does not refuse a condition-free filter: `{ "filter": {} }` deletes every point. Matching points are collected first, then deleted in batches.

**Errors (v0.20.0+; these were `500` before):** `400 invalid_request` when `filter` is missing or not an object (`error: "Missing required field: filter (object)"`), or when Qdrant rejects it (`error: "Invalid filter"`). Nothing is deleted then.

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

Missing or empty `globs`, or an empty or non-string entry, is `400 invalid_request` (`error: "Missing required field: globs (non-empty string array)"`; schema `rulesReapplyRequestSchema`; v0.20.0+, was `500`).

### Response

**Success (200 OK):**

```json
{
  "matched": 150,
  "updated": 148
}
```

### Response Schema

| Field     | Type     | Description                                        |
| --------- | -------- | -------------------------------------------------- |
| `matched` | `number` | Distinct indexed files matching the glob patterns. |
| `updated` | `number` | Files whose points were updated.                   |

### Behavior

1. Scrolls all points (`file_path` only) to find the indexed files matching the globs (slashes normalised, case-insensitive, dotfiles included); source documents never match
2. For each matching file, re-applies current inference rules (metadata update only): changed values are written and payload keys the rules no longer project are removed
3. Files that fail re-processing are logged but don't abort the operation

**Use cases:**

- After editing inference rules, selectively re-apply to specific domains
- More targeted than `POST /reindex` with scope `rules` (which re-applies to everything)

---

## VCS Endpoints

Version control endpoints for git-backed content history. Requires `vcs.enabled: true` in config: without it there are no VCS roots, so `GET /vcs/status` answers `{ "enabled": false, "roots": [] }` and the other VCS routes answer `404 not_found` (no matching watch root). See the [Version Control (VCS) Guide](./version-control.md) for architectural context, configuration, and operational details.

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
        "hash": "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
        "message": "update project notes and readme",
        "timestamp": "2026-06-10T14:30:00+00:00"
      },
      "remoteUrl": "https://github.com/org/docs-backup.git",
      "lastPush": "2026-06-10T14:30:05.000Z",
      "pushErrors": [],
      "breaker": {
        "consecutiveFailures": 0,
        "tripped": false,
        "trippedAt": null,
        "lastError": null,
        "pendingCount": 0
      }
    }
  ]
}
```

| Field | Type | Description |
| --- | --- | --- |
| `enabled` | `boolean` | Whether any watch root has VCS enabled. |
| `roots` | `array` | Per-root VCS state. |
| `roots[].path` | `string` | Watch root path. |
| `roots[].tracked` | `number` | Number of commits on `HEAD` in this root's repository (`git rev-list --count HEAD`; `0` without commits). |
| `roots[].lastCommit` | `object \| null` | Most recent commit: full `hash`, subject `message`, author `timestamp` (ISO 8601); `null` if no commits yet. |
| `roots[].remoteUrl` | `string \| null` | Configured remote URL, else the repository's `origin` URL, else `null`. |
| `roots[].lastPush` | `string \| null` | ISO 8601 timestamp of the last successful push since start. |
| `roots[].pushErrors` | `{ timestamp, message }[]` | Recent push errors. |
| `roots[].breaker` | `object \| null` | Commit circuit breaker: `consecutiveFailures`, `tripped`, `trippedAt`, `lastError`, and `pendingCount` (files queued or in flight, not yet committed). |

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
    "commit": "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    "message": "update project notes and readme",
    "timestamp": "2026-06-10T14:30:00+00:00",
    "files": ["projects/readme.md", "projects/notes.md"]
  }
]
```

| Field | Type | Description |
| --- | --- | --- |
| `commit` | `string` | Full commit hash. |
| `message` | `string` | Commit subject line. |
| `timestamp` | `string` | ISO 8601 author timestamp. |
| `files` | `string[]` | Files changed in this commit that match the glob, relative to the watch root. |

#### Behavior

Runs `git log` (with `--since` / `--until` when given) in every VCS root the glob falls under, or that falls under the glob's base path, with the root-relative glob as pathspec. Entries from all roots are merged, sorted by timestamp descending and cut to `limit`. A root whose log fails (for example no commits yet) is skipped.

#### Errors

`400 invalid_request` without `glob` (`error: "Missing required query parameter: glob"`); `404 not_found` when no VCS root matches (`"No VCS-enabled watch root matches the given glob"`).

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

Returns the raw file content with a `Content-Type` header based on the file extension: `text/plain` (`.txt`, `.ts`), `text/markdown` (`.md`), `application/json`, `application/xml`, `text/html`, `text/css`, `application/javascript`, `text/yaml` (`.yaml`, `.yml`), `text/csv`; otherwise `application/octet-stream`.

#### Behavior

Resolves the watch root for the path, computes the relative path, and runs `git show {commit}:{relativePath}`.

#### Errors

`400 invalid_request` when `path` or `commit` is missing (`"Missing required query parameters: path, commit"`); `404 not_found` when no VCS root contains the path (`"Path does not match any VCS-enabled watch root"`) or `git show` fails, for example an unknown commit or a file absent at that commit (`"File not found at the specified commit"`).

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

Resolves matching watch roots and runs `git diff {commit}..{commitEnd}` (or `..HEAD`) in each, with the root-relative glob as pathspec, and joins the outputs with newlines. A root where the diff fails (for example an unknown commit) contributes nothing, so the response can be `200` with an empty body.

#### Errors

`400 invalid_request` when `glob` or `commit` is missing (`"Missing required query parameters: glob, commit"`); `404 not_found` when no VCS root matches (`"No VCS-enabled watch root matches the given glob"`).

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

| Field | Type | Description |
| --- | --- | --- |
| `restored` | `number` | Number of files restored. |
| `files` | `string[]` | Absolute paths (forward slashes) of restored files. |

#### Behavior

1. Lists the files at the specified commit with `git ls-tree -r --name-only {commit} -- {root-relative glob}` (the whole tree when the glob is a root itself)
2. Retrieves each file's content via `git show` and writes it to disk (skipping files absent on disk when `existingOnly` is set, and files `git show` cannot read)
3. Records reversion metadata: the resulting commit message is `revert: {glob} to {shortCommit} — restored {n} files`
4. The written files then flow through the normal watcher events and are re-indexed

A root whose listing fails (for example an unknown commit) restores nothing, so the response can be `{ "restored": 0, "files": [] }`.

#### Errors

`400 invalid_request` when `glob` or `commit` is missing (`"Missing required body parameters: glob, commit"`); `404 not_found` when no VCS root matches (`"Glob does not match any VCS-enabled watch root"`).

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
| `gitignorePath` | `string` | Path (forward slashes) of the `.gitignore` file that was modified. |
| `action` | `string` | `"added"` or `"removed"`. |

#### Behavior

Splits the root-relative glob at its first segment containing a wildcard into a directory prefix and pattern suffix (a literal path goes to its parent directory's `.gitignore`), then places the entry in a `.gitignore` at that directory (locality principle), creating the directory and file if needed. Adding a pattern that is already present changes nothing and still answers `"added"`. Removing deletes the lines equal to the pattern.

#### Errors

`400 invalid_request` without `glob` (`"Missing required body parameter: glob"`). `404 not_found` when `root` is not a VCS root (`"Root is not a VCS-enabled watch root"`), when no VCS root contains the glob (`"Glob does not match any VCS-enabled watch root"`), or, for `remove`, when the `.gitignore` does not exist (`"No .gitignore found at the expected location"`) or does not contain the pattern (`"Pattern not found in .gitignore"`).

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
  "source": "temp/.gitignore"
}
```

| Field | Type | Description |
| --- | --- | --- |
| `excluded` | `boolean` | Whether the file is ignored by git. |
| `rule` | `string?` | The matching `.gitignore` pattern (if excluded). |
| `source` | `string?` | The file containing the rule, as `git check-ignore -v` reports it (relative to the watch root for a `.gitignore` in the tree). |

#### Behavior

Runs `git check-ignore -v` in the watch root to determine exclusion status and the specific rule/source responsible. If git's output cannot be parsed, the response is `{ "excluded": true }` without `rule` and `source`. Any non-zero git exit (not only "not ignored") answers `{ "excluded": false }`.

#### Errors

`400 invalid_request` without `path` (`"Missing required query parameter: path"`); `404 not_found` when no VCS root contains the path (`"Path does not match any VCS-enabled watch root"`).

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
- `issueType` (optional) names the [issue code](#issue-codes) behind a failed render.
- Some endpoints add fields of their own (`issues` on `POST /config/apply`).
- A route's status is derived from its `code` through `API_ERROR_STATUS` in core (the table below), so the same code always has the same status. The single exception is `not_available` from a prune without a vector store, which keeps its 0.19 status `400`. Requests rejected by the framework before reaching a route keep the framework's status: `401` maps to `unauthorized`, `404` to `not_found` (unknown route: `{ "code": "not_found", "error": "Not Found", "message": "Route POST:/nope not found" }`), any other 4xx to `invalid_request` (with the HTTP status text as `error` and the framework's explanation as `message`), and any 5xx to the generic `internal_error` body.
- The CLI and the plugin report an error as one line, `HTTP <status> <code>: <message>`, where `<message>` is `error` plus `: <message>` when the body has a different `message` (`formatHttpError` in core).
- A 5xx body never carries the underlying error (file paths, Qdrant or provider messages): the cause is logged and the body is the generic `internal_error` text below.
- HTTP status changes in v0.20.0, all from `500` for what are client mistakes: invalid bodies of the rules routes and `POST /points/delete`, filters Qdrant rejects (`400`), and invalid `POST /reindex` path targets (`403` / `404` / `400`). Successful responses and every other status are unchanged.

| `code` | Status | Meaning |
| --- | --- | --- |
| `invalid_request` | `400` | The body, query or parameters failed validation, a filter was rejected by Qdrant (`error: "Invalid filter"`) or has no condition (`POST /documents/delete`), an invalid JSONPath (`GET /config`), a `POST /reindex` path target that is neither file nor directory, or the request was rejected before reaching a route (malformed JSON, unsupported media type: the framework's status is kept, e.g. `415`). |
| `unauthorized` | `401` | `api.apiKey` is set and the bearer token is missing or wrong. |
| `path_not_watched` | `403` | The file path is outside the watched scope (`POST /render`), or a `POST /reindex` path target is outside it or gitignored. |
| `not_found` | `404` | No such route, file (including a `POST /reindex` path target), VCS watch root, file at a commit, `.gitignore` or `.gitignore` pattern. |
| `source_not_indexed` | `404` | No stored point for the source reference, so no designated rule is known (`POST /render`, `POST /metadata`). |
| `source_not_found` | `404` | The source callback answered `404` (`POST /render`). |
| `unsupported_content_type` | `422` | The source callback returned a non-JSON body (`POST /render`). |
| `pipeline_error` | `422` | Rendering or extraction failed (`POST /render`); `issueType` names the failure. |
| `source_unavailable` | `502` | The source callback failed (`POST /render`). |
| `not_available` | `503` | The feature is not available on this instance: no source-document support (`POST /documents`, and `POST /render`, `POST /metadata` and `POST /reindex` with `source`; `POST /documents/delete` works without it), or no filesystem watcher (`POST /walk`). A prune without a vector store keeps its 0.19 status `400`. |
| `scan_in_progress` | `503` | The initial filesystem scan is still running (`POST /walk`); retry later. |
| `embedding_unavailable` | `503` | The embedding provider's retry budget ran out (`POST /search`); honour `Retry-After`. |
| `internal_error` | `500` | Unexpected server-side failure (check the service log), including a Qdrant read failure on `POST /metadata` or `POST /render` with `source`. Always `{ "code": "internal_error", "error": "Internal Server Error", "message": "Internal server error" }`, never the underlying error. |

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
- `apiKey` must be non-empty: `""` (or a variable that substitutes to `""`) is a config validation error, so the service does not start. Omit the key to run without authentication. (Should an empty key ever reach the server, it still fails closed: no token matches.)
- If `apiKey` still contains an unresolved `${...}` after environment-variable substitution, loading the config fails and the service does not start.
- The key is read **at startup only**. Rotating it means changing the config (or the environment variable) and restarting the watcher, then updating every client.
- Clients send the key as follows:
  - **CLI** (`config`, `config apply`, `search`, `enrich`, `scan`, `reindex`, `rebuild-metadata`, `issues`, `helpers`): the `--api-key <key>` flag, else the `JEEVES_WATCHER_API_KEY` environment variable. These commands do not read the config file. Prefer the environment variable: a flag value is visible in the process list. See [CLI Reference](./cli-reference.md#authentication).
  - **OpenClaw plugin**: `plugins.entries.jeeves-watcher-openclaw.config.apiKey`, else `JEEVES_WATCHER_API_KEY`; sent on every tool request.
  - **SDK**: the [`apiKey` option](./source-documents.md#sdk).
  - On `401`, the CLI and the plugin say how to supply the key (or, when one was sent, that it was rejected) and never print it. The environment variable name is `API_KEY_ENV_VAR` in core.
- `api` settings never appear in `GET /config`.

For TLS, or for authentication schemes other than a single shared key, put a reverse proxy in front of the watcher.

---

## Rate Limiting

The API itself has no request rate limit; add one at a reverse proxy if you need it.

The **embedding provider** is rate-limited. Since v0.20.0, one shared limiter wraps the provider and every caller draws from it: file watching, source-document notifications, reindex and search. See [`embedding.rateLimitPerMinute`](./configuration.md#embedding-rate-limiting) for the semantics (and the 0.20.0 behaviour change).

When the provider answers `429`, the limiter pauses **all** embedding requests:

- A pause the provider asks for (`Retry-After`, or Google's `retryDelay` when there is no header) of up to the root `maxBackoffMs` is waited in full, then the request is retried. Without either, the limiter backs off exponentially, capped at `maxBackoffMs`.
- A requested pause **longer** than `maxBackoffMs` is not shortened: the request fails at once, and every other caller fails fast until the pause has passed, instead of retrying early and being throttled again.
- Indexing makes up to 5 attempts per embedding request and then records an `embedding_error` issue (the document is retried on its next change, notification or reindex).
- Search makes up to 3 attempts and waits at most 10 seconds in total; when that budget runs out, or the provider's pause is too long, `POST /search` answers `503 { code: "embedding_unavailable", error, message }` with a `Retry-After` header instead of `500`.
- Retries the Gemini client makes on its own (non-`429` failures) also take a limiter token, so every HTTP request to the provider counts against `rateLimitPerMinute`.

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

```text
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
