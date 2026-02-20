---
title: API Reference
---

# API Reference

The watcher exposes a lightweight HTTP API for search, metadata enrichment, and operational control.

**Default address:** `http://127.0.0.1:3100` (configurable via `api.host` and `api.port`)

---

## `GET /status`

Health check and service stats.

### Request

```bash
curl http://localhost:3100/status
```

### Response

```json
{
  "status": "ok",
  "uptime": 86400
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | Always `"ok"` if the server is responding. |
| `uptime` | `number` | Process uptime in seconds. |

**Status codes:**
- `200 OK` — Service is healthy

---

## `POST /metadata`

Enrich a document's metadata without re-embedding.

### Request

```bash
curl -X POST http://localhost:3100/metadata \
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

## `POST /search`

Semantic search across indexed documents.

### Request

```bash
curl -X POST http://localhost:3100/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "machine learning algorithms",
    "limit": 10
  }'
```

**Body schema:**

```typescript
{
  query: string;   // Natural language search query
  limit?: number;  // Max results (default: 10)
}
```

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

## `POST /reindex`

Trigger a full reindex of all watched files.

### Request

```bash
curl -X POST http://localhost:3100/reindex
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

## `POST /rebuild-metadata`

Rebuild the metadata store from Qdrant payloads.

### Request

```bash
curl -X POST http://localhost:3100/rebuild-metadata
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

## `POST /config-reindex`

Reindex after configuration changes (rules update or full reindex).

### Request

**Scope: `rules` (default) — metadata-only reindex:**

```bash
curl -X POST http://localhost:3100/config-reindex \
  -H "Content-Type: application/json" \
  -d '{"scope": "rules"}'
```

**Scope: `full` — re-extract, re-embed, re-upsert:**

```bash
curl -X POST http://localhost:3100/config-reindex \
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
curl -X POST http://localhost:3100/search \
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
  curl -X POST http://localhost:3100/metadata \
    -H "Content-Type: application/json" \
    -d "{\"path\": \"$file\", \"metadata\": {\"reviewed\": true}}"
done
```

### Check Service Health

```bash
curl http://localhost:3100/status | jq '.uptime'
```

Output: `86400` (uptime in seconds)

---

## Next Steps

- [CLI Reference](./cli-reference.md) — CLI equivalents for these endpoints
- [Configuration Reference](./configuration.md) — API server settings
- [Architecture Guide](./architecture.md) — How the API fits into the system
