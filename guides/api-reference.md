---
title: API Reference
---

# API Reference

The watcher exposes a lightweight HTTP API for search, metadata enrichment, and operational control.

**Default address:** `http://127.0.0.1:3456` (configurable via `api.host` and `api.port`)

---

## GET /status

Health check and service stats.

### Request

```bash
curl http://localhost:3456/status
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

> **v0.5.0 change:** `payloadFields` has been removed from the status response. Use [`POST /config/query`](#post-configquery) to discover schema and payload field information.

**Status codes:**
- `200 OK` — Service is healthy

---

## POST /metadata

Enrich a document's metadata without re-embedding.

### Request

```bash
curl -X POST http://localhost:3456/metadata \
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

## POST /search

Semantic search across indexed documents.

### Request

```bash
curl -X POST http://localhost:3456/search \
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
curl -X POST http://localhost:3456/search \
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
curl -X POST http://localhost:3456/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "authentication flow",
    "limit": 10,
    "offset": 20
  }'
```

The `filter` parameter accepts a native [Qdrant filter object](https://qdrant.tech/documentation/concepts/filtering/). Use `watcher_status` (or `GET /status`) to discover available payload fields and their types, then construct filters accordingly. Common patterns:

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

## POST /reindex

Trigger a full reindex of all watched files.

### Request

```bash
curl -X POST http://localhost:3456/reindex
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
curl -X POST http://localhost:3456/rebuild-metadata
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
curl -X POST http://localhost:3456/config-reindex \
  -H "Content-Type: application/json" \
  -d '{"scope": "rules"}'
```

**Scope: `full` — re-extract, re-embed, re-upsert:**

```bash
curl -X POST http://localhost:3456/config-reindex \
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

Returns runtime embedding failures and processing errors.

### Request

```bash
curl http://localhost:3456/issues
```

### Response

**Success (200 OK):**

```json
[
  {
    "rule": "email-classifier",
    "error": "Template render failed: missing helper 'customFormat'",
    "errorType": "template",
    "timestamp": "2026-02-24T08:15:00Z",
    "attempts": 3
  }
]
```

### IssueRecord Schema

| Field | Type | Description |
|-------|------|-------------|
| `rule` | `string` | Name of the inference rule that failed. |
| `error` | `string` | Human-readable error message. |
| `errorType` | `string` | Error category: `"template"`, `"embedding"`, `"extraction"`, `"validation"`. |
| `timestamp` | `string` | ISO-8601 timestamp of last occurrence. |
| `attempts` | `number` | Number of retry attempts made. |

---

## POST /config/query

Query the merged virtual configuration document using JSONPath expressions.

### Request

```bash
curl -X POST http://localhost:3456/config/query \
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

## POST /config/validate

Pre-flight validation of configuration changes without applying them.

### Request

```bash
curl -X POST http://localhost:3456/config/validate \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "inferenceRules": [
        { "name": "new-rule", "match": { "type": "object" }, "set": { "domain": "test" } }
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
curl -X POST http://localhost:3456/config/apply \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "inferenceRules": [
        { "name": "new-rule", "match": { "type": "object" }, "set": { "domain": "test" } }
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
curl -X POST http://localhost:3456/search \
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
  curl -X POST http://localhost:3456/metadata \
    -H "Content-Type: application/json" \
    -d "{\"path\": \"$file\", \"metadata\": {\"reviewed\": true}}"
done
```

### Check Service Health

```bash
curl http://localhost:3456/status | jq '.uptime'
```

Output: `86400` (uptime in seconds)

---

## Next Steps

- [CLI Reference](./cli-reference.md) — CLI equivalents for these endpoints
- [Configuration Reference](./configuration.md) — API server settings
- [Architecture Guide](./architecture.md) — How the API fits into the system
