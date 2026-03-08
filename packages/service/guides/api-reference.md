---
title: API Reference
---

# API Reference

The watcher exposes a lightweight HTTP API for search, metadata enrichment, and operational control.

**Default address:** `http://127.0.0.1:1936` (configurable via `api.host` and `api.port`)

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
  "collection": {
    "name": "jeeves_archive",
    "pointCount": 10498,
    "dimensions": 3072
  },
  "reindex": {
    "active": false
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | Always `"ok"` if the server is responding. |
| `uptime` | `number` | Process uptime in seconds. |
| `collection` | `object` | Qdrant collection stats. |
| `collection.name` | `string` | Collection name. |
| `collection.pointCount` | `number` | Total indexed points (chunks). |
| `collection.dimensions` | `number` | Embedding vector dimensions. |
| `reindex` | `object` | Active reindex status. |
| `reindex.active` | `boolean` | Whether a reindex is currently running. |
| `reindex.scope` | `string?` | Reindex scope (`"rules"` or `"full"`) if active. |
| `reindex.startedAt` | `string?` | ISO-8601 timestamp when reindex started, if active. |

> **v0.5.0 change:** `payloadFields` has been removed from the status response. Use [`POST /config/query`](#post-configquery) or [`GET /config/schema`](#get-configschema) to discover schema and payload field information.

**Status codes:**
- `200 OK` — Service is healthy

---

## POST /metadata

Enrich a document's metadata without re-embedding.

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
  path: string;                    // File path (must be indexed)
  metadata: Record<string, unknown>;  // Metadata to merge
}
```

### Response

**Success (200 OK):**

```json
{
  "ok": true
}
```

**Validation error (400 Bad Request):**

```json
{
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

---

## POST /render

Render a file through the inference rule engine without embedding. Returns the transformed (or passthrough) content along with metadata.

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
  path: string;  // File path (must be within watched scope)
}
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
|-------|------|-------------|
| `renderAs` | `string` | Output content type (file extension without dot). Always present. |
| `content` | `string` | Rendered content (from template/render transform) or extracted text (passthrough). |
| `rules` | `string[]` | Names of matched inference rules (diagnostic). |
| `metadata` | `object` | Composed embedding properties from matched rules. |

### Caching

- **Transformed responses** (template or render ran): cached via `withCache` with the configured TTL.
- **Passthrough responses** (no transform): `Cache-Control: no-cache` header set; bypasses the cache.

### Error Codes

| Code | Condition |
|------|-----------|
| `200` | Success |
| `400` | Missing `path` field |
| `403` | Path is outside watched scope |
| `404` | File not found |
| `422` | Render/extraction failed |

### Behavior

1. Validates the path against `watch.paths` and `watch.ignored` globs
2. Runs the file through `buildMergedMetadata` (same pipeline as indexing)
3. Resolves `renderAs`: rule-declared value → file extension → `"txt"`
4. Returns rendered or extracted content with matched rules and metadata

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
      "rules": ["email-archive", "jira-issue", "meetings-transcript", "slack-message"]
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

| Field | Type | Description |
|-------|------|-------------|
| `facets` | `Facet[]` | Array of facet definitions. |

**Facet:**

| Field | Type | Description |
|-------|------|-------------|
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
    "payload": { /* ... */ }
  }
]
```

**Error (500 Internal Server Error):**

```json
{
  "error": "Internal server error"
}
```

### Response Schema

Each result is a Qdrant point:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Qdrant point ID (deterministic UUID from file path + chunk index). |
| `score` | `number` | Cosine similarity score (0–1, higher is better). |
| `payload` | `object` | Document metadata and chunk info. |

**Payload fields:**

| Field | Type | Description |
|-------|------|-------------|
| `file_path` | `string` | Normalized file path (forward slashes). |
| `chunk_index` | `number` | Chunk index (0-based). |
| `total_chunks` | `number` | Total chunks for this file. |
| `content_hash` | `string` | SHA-256 hash of extracted text. |
| `chunk_text` | `string` | Text content of this chunk. |
| _Custom fields_ | `any` | Metadata from inference rules and `POST /metadata`. |

### Behavior

1. Embeds the query text using the configured embedding provider
2. Searches Qdrant using cosine similarity
3. Returns top `limit` results (includes all chunks; caller groups by `file_path` if needed)

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
    { "id": "uuid-chunk-0", "payload": { "file_path": "j:/domains/email/msg.json", "domain": "email" } },
    { "id": "uuid-chunk-1", "payload": { "file_path": "j:/domains/email/msg2.json", "domain": "email" } }
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
|-------|------|-------------|
| `points` | `ScrolledPoint[]` | Matched points with payload. |
| `cursor` | `string \| number \| null` | Opaque cursor for next page. `null` when no more results. |
| `count` | `number` | Total matching points (only when `countOnly: true`). |

### Error Codes

| Code | Condition |
|------|-----------|
| `200` | Success |
| `400` | Missing or invalid `filter`, or `limit` out of bounds (1–1000) |
| `500` | Server error |

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

## POST /reindex

Trigger a full reindex of all watched files.

### Request

```bash
curl -X POST http://localhost:1936/reindex
```

### Response

**Success (200 OK):**

```json
{
  "ok": true,
  "filesIndexed": 1234
}
```

**Error (500 Internal Server Error):**

```json
{
  "error": "Internal server error"
}
```

### Behavior

1. Scans all `watch.paths` globs
2. For each file:
   - Extracts text
   - Computes content hash
   - If hash differs from Qdrant (or file not indexed): re-embed and upsert
   - If hash matches: skip (no re-embedding)
3. Processes sequentially to avoid overwhelming the embedding API

**Use cases:**
- Recovering from Qdrant data loss
- Indexing a large batch of new files
- After bulk file operations (e.g., git pull)

**Note:** This is a blocking operation — the API returns after all files are processed. For very large corpora, expect long response times.

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

## POST /config-reindex

Reindex after configuration changes (rules update or full reindex).

### Request

**Scope: `rules` (default) — metadata-only reindex:**

```bash
curl -X POST http://localhost:1936/config-reindex \
  -H "Content-Type: application/json" \
  -d '{"scope": "rules"}'
```

**Scope: `full` — re-extract, re-embed, re-upsert:**

```bash
curl -X POST http://localhost:1936/config-reindex \
  -H "Content-Type: application/json" \
  -d '{"scope": "full"}'
```

**Body schema:**

```typescript
{
  scope?: "rules" | "full";  // Default: "rules"
}
```

### Response

**Success (200 OK):**

```json
{
  "status": "started",
  "scope": "rules"
}
```

The reindex runs **asynchronously** — the API returns immediately.

**Error (500 Internal Server Error):**

```json
{
  "error": "Internal server error"
}
```

### Behavior

#### Scope: `rules`

1. Re-reads file attributes (path, stats, frontmatter, JSON)
2. Re-applies current inference rules
3. Merges with enrichment metadata from the metadata store
4. Updates Qdrant payloads (no re-embedding)

**Use case:** You edited inference rules and want to update metadata without re-embedding.

#### Scope: `full`

1. Re-extracts text from all files
2. Re-embeds (new embedding API calls)
3. Re-upserts to Qdrant

**Use case:** You changed embedding providers (e.g., Gemini 3072-dim → 768-dim) or chunk size.

### Reindex Tracking

While a reindex is running, `GET /status` shows the active reindex state:

```json
{
  "reindex": { "active": true, "scope": "rules", "startedAt": "2026-02-24T08:00:00Z" }
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

## GET /issues

Returns the current issues file contents: all files that failed to embed, with error details.

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
|-------|------|-------------|
| `count` | `number` | Number of files with issues (not total issue count). |
| `issues` | `object` | Issues keyed by file path. |

### IssueRecord Schema

| Field | Type | Description |
|-------|------|-------------|
| `type` | `string` | Error category: `"type_collision"` or `"interpolation_error"`. |
| `property` | `string?` | Property name where the issue occurred. |
| `rules` | `string[]?` | Rule names involved in the issue (for type collisions). |
| `rule` | `string?` | Rule name for single-rule issues (backward compat). |
| `types` | `string[]?` | Declared types for type collision issues. |
| `message` | `string` | Human-readable error message. |
| `timestamp` | `number \| string` | Unix timestamp (seconds) or ISO string of last occurrence. |

### Behavior

The issues file is self-healing:
- Files that hit issues are logged and **embedding is skipped**
- Successful re-processing (config fix, file edit, reindex) **clears** the entry
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

| Field | Type | Description |
|-------|------|-------------|
| `matches` | `PathMatch[]` | Match results for each input path (same order). |

**PathMatch:**

| Field | Type | Description |
|-------|------|-------------|
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

Atomically validate, write, and reload configuration.

### Request

```bash
curl -X POST http://localhost:1936/config/apply \
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
    }
  }'
```

**Body schema:**

```typescript
{
  config: Record<string, unknown>;  // Configuration to apply
}
```

### Response

**Success (200 OK):**

```json
{
  "applied": true,
  "reindexTriggered": true,
  "scope": "rules"
}
```

**Validation failure (400 Bad Request):**

```json
{
  "applied": false,
  "errors": [
    { "path": "inferenceRules[0].match", "message": "Invalid JSON Schema" }
  ]
}
```

### Behavior

1. Validates the provided config (same as `POST /config/validate`)
2. Writes the merged config to disk
3. Reloads the running watcher with new config
4. Triggers a scoped reindex if rules changed

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
  source: string;  // Source identifier to unregister
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
  filter: Record<string, unknown>;  // Qdrant filter object
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

| Field | Type | Description |
|-------|------|-------------|
| `matched` | `number` | Files matching the glob patterns. |
| `updated` | `number` | Files successfully re-processed. |

### Behavior

1. Scrolls all indexed points to find files matching the provided globs
2. For each matching file, re-applies current inference rules (metadata update only)
3. Files that fail re-processing are logged but don't abort the operation

**Use cases:**
- After editing inference rules, selectively re-apply to specific domains
- More targeted than `POST /config-reindex` (which re-applies to everything)

---

## Error Handling

All endpoints return JSON errors with this schema:

```json
{
  "error": "Human-readable error message"
}
```

**Status codes:**
- `200 OK` — Success
- `500 Internal Server Error` — Server-side failure (check logs for details)

---

## Authentication

**Current:** None. The API is intended for localhost-only access (default `host: "127.0.0.1"`).

**For production:** Use a reverse proxy (nginx, Caddy) with authentication, or bind to `0.0.0.0` only within a trusted network.

---

## Rate Limiting

**No built-in rate limiting.** The embedding provider's rate limit (`embedding.rateLimitPerMinute`) applies, but the API itself is unbounded.

For high-traffic deployments, add rate limiting at the reverse proxy layer.

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
- [Architecture Guide](./architecture.md) — How the API fits into the system
