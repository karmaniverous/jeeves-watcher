---
title: Configuration Reference
---

# Configuration Reference

Complete reference for all `jeeves-watcher` configuration options.

## Configuration File

The configuration file is auto-discovered in this order:

1. `--config <path>` CLI flag (explicit)
2. `JEEVES_WATCHER_CONFIG` environment variable
3. `./jeeves-watcher.config.json` (current directory)
4. `~/.jeeves-watcher/config.json` (user home)

Supported formats: JSON, JSON5, YAML (via `.yaml`/`.yml` extension).

## Top-Level Schema

```typescript
interface JeevesWatcherConfig {
  watch: WatchConfig;
  configWatch?: ConfigWatchConfig;
  embedding: EmbeddingConfig;
  vectorStore: VectorStoreConfig;
  metadataDir?: string;
  api?: ApiConfig;
  extractors?: Record<string, unknown>;
  inferenceRules?: InferenceRule[];
  logging?: LoggingConfig;
  shutdownTimeoutMs?: number;
}
```

---

## `watch` - Filesystem Watching

```json
{
  "watch": {
    "paths": ["./docs/**/*.md", "./notes/**/*.txt"],
    "ignored": ["**/node_modules/**", "**/.git/**"],
    "debounceMs": 2000,
    "stabilityThresholdMs": 500,
    "pollIntervalMs": 1000,
    "usePolling": false
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `paths` | `string[]` | **Required** | Glob patterns for files to watch. Supports picomatch syntax. |
| `ignored` | `string[]` | `[]` | Glob patterns to exclude from watching. |
| `debounceMs` | `number` | `1000` | Wait this long after last change before processing (prevents re-embedding during rapid edits). |
| `stabilityThresholdMs` | `number` | `500` | File must be stable (no size changes) for this long before processing. |
| `pollIntervalMs` | `number` | `1000` | Polling interval if `usePolling` is enabled. |
| `usePolling` | `boolean` | `false` | Use polling instead of native filesystem events. Enable for network drives or Docker volumes. |

**Glob examples:**

```json
{
  "paths": [
    "d:/email/archive/**/*.json",      // All .json files under archive (Windows)
    "./meetings/**/*.{txt,md}",        // .txt or .md files under meetings
    "**/*.pdf",                        // All PDFs recursively
    "/absolute/path/to/docs/**"        // Absolute path (Linux/macOS)
  ]
}
```

---

## `configWatch` - Config File Watching

```json
{
  "configWatch": {
    "enabled": true,
    "debounceMs": 10000
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Watch config file for changes and trigger scoped reindex. |
| `debounceMs` | `number` | `10000` | Debounce window for config changes. Longer than file debounce to allow editing multiple rules. |

When the config file changes:
1. Watcher reloads and validates the new config
2. Inference rules are recompiled
3. A **metadata-only reindex** is triggered for files matching changed rules (no re-embedding)

---

## `embedding` - Embedding Provider

```json
{
  "embedding": {
    "provider": "gemini",
    "model": "gemini-embedding-001",
    "apiKey": "${GOOGLE_API_KEY}",
    "chunkSize": 1000,
    "chunkOverlap": 200,
    "dimensions": 3072,
    "rateLimitPerMinute": 1000,
    "concurrency": 5
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provider` | `string` | **Required** | Embedding provider: `"gemini"`, `"openai"`, `"mock"`. |
| `model` | `string` | **Required** | Model name (e.g., `"gemini-embedding-001"` for Gemini). |
| `apiKey` | `string` | `undefined` | API key. Supports `${ENV_VAR}` template syntax. |
| `chunkSize` | `number` | `1000` | Maximum characters per chunk for text splitting. |
| `chunkOverlap` | `number` | `200` | Overlap between consecutive chunks (helps preserve context at boundaries). |
| `dimensions` | `number` | Provider default | Vector dimensions. Gemini `gemini-embedding-001` = 3072. |
| `rateLimitPerMinute` | `number` | `1000` | Max embedding requests per minute (provider rate limit). |
| `concurrency` | `number` | `5` | Max concurrent embedding requests. Bounded by rate limiter. |

### Supported Providers

#### Google Gemini

```json
{
  "embedding": {
    "provider": "gemini",
    "model": "gemini-embedding-001",
    "apiKey": "${GOOGLE_API_KEY}",
    "dimensions": 3072
  }
}
```

**Models:**
- `gemini-embedding-001` - 3072 dimensions (recommended)

#### Mock (Testing)

```json
{
  "embedding": {
    "provider": "mock",
    "dimensions": 3072
  }
}
```

Generates deterministic embeddings from content hashes. No API calls, no cost. Ideal for CI/CD tests.

---

## `vectorStore` - Qdrant Configuration

```json
{
  "vectorStore": {
    "url": "http://localhost:6333",
    "collectionName": "jeeves-watcher",
    "apiKey": "${QDRANT_API_KEY}"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | `string` | **Required** | Qdrant server URL. |
| `collectionName` | `string` | **Required** | Qdrant collection name. Created automatically if it doesn't exist. |
| `apiKey` | `string` | `undefined` | Qdrant API key (for Qdrant Cloud). |

**On startup**, the watcher:
1. Checks if the collection exists
2. If not, creates it with the configured vector dimensions
3. If it exists with **different dimensions**, logs an error and refuses to start (dimension mismatch)

To change embedding settings that affect vector dimensions, you must:
1. Delete the old collection (or rename `collectionName` in config)
2. Run `POST /reindex?force=true` to re-embed with the new provider

---

## `metadataDir` - Metadata Storage

```json
{
  "metadataDir": ".jeeves-watcher"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `metadataDir` | `string` | `".jeeves-watcher"` | Directory for `.meta.json` sidecar files. Mirrors watched filesystem hierarchy. |

Metadata enrichment (via `POST /metadata`) is persisted here, separate from Qdrant. This ensures enrichment survives Qdrant rebuilds.

**Directory structure:**

```
.jeeves-watcher/
  d/
    projects/
      my-project/
        readme.md.meta.json
```

For a file at `D:\projects\my-project\readme.md`, the metadata sidecar is at `.jeeves-watcher/d/projects/my-project/readme.md.meta.json`.

---

## `api` - HTTP API Server

```json
{
  "api": {
    "host": "127.0.0.1",
    "port": 3456
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `host` | `string` | `"127.0.0.1"` | Host to bind to. Use `"0.0.0.0"` to accept external connections. |
| `port` | `number` | `3456` | Port to listen on. |

The API provides endpoints for search, metadata enrichment, reindexing, and status. See [API Reference](./api-reference.md).

---

## `extractors` - Text Extraction (Advanced)

```json
{
  "extractors": {
    ".md": "markdown",
    ".txt": "plaintext",
    ".json": "json-content",
    ".pdf": "pdf-parse",
    ".docx": "docx-extract",
    ".html": "html-to-text"
  }
}
```

Maps file extensions to extraction strategies. **Usually not needed** - defaults cover common formats.

---

## `inferenceRules` - Metadata Enrichment Rules

```json
{
  "inferenceRules": [
    {
      "match": {
        "properties": {
          "file": {
            "properties": {
              "path": { "type": "string", "glob": "**/meetings/**" }
            }
          }
        }
      },
      "set": {
        "domain": "meetings"
      }
    },
    {
      "match": {
        "properties": {
          "frontmatter": {
            "properties": {
              "title": { "type": "string" }
            },
            "required": ["title"]
          }
        }
      },
      "set": {
        "title": "${frontmatter.title}"
      }
    }
  ]
}
```

Each rule is a **JSON Schema `match`** paired with a **`set` action**. See [Inference Rules Guide](./inference-rules.md) for full details.

---

## `logging` - Logging Configuration

```json
{
  "logging": {
    "level": "info",
    "file": "./logs/watcher.log"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `level` | `string` | `"info"` | Log level: `"debug"`, `"info"`, `"warn"`, `"error"`, `"silent"`. |
| `file` | `string` | `undefined` | Log file path. If omitted, logs to stdout. |

Uses structured JSON logging via [pino](https://github.com/pinojs/pino).

---

## `shutdownTimeoutMs` - Graceful Shutdown

```json
{
  "shutdownTimeoutMs": 30000
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `shutdownTimeoutMs` | `number` | `30000` | Max time (ms) to wait for in-flight operations on shutdown (SIGTERM/SIGINT). |

On shutdown, the watcher:
1. Stops accepting new file events
2. Drains current in-flight embeddings/upserts (up to timeout)
3. Exits cleanly

---

## Environment Variable Substitution

All string fields support `${ENV_VAR}` template syntax:

```json
{
  "embedding": {
    "apiKey": "${GOOGLE_API_KEY}"
  },
  "vectorStore": {
    "apiKey": "${QDRANT_API_KEY}"
  }
}
```

At runtime, these are replaced with actual environment variable values.

---

## Example: Full Configuration

```json
{
  "watch": {
    "paths": [
      "d:/email/archive/**/*.json",
      "d:/meetings/**/*.{txt,md}",
      "d:/projects/**/*.{md,pdf,docx}"
    ],
    "ignored": ["**/node_modules/**", "**/.git/**"],
    "debounceMs": 2000,
    "stabilityThresholdMs": 500
  },
  "configWatch": {
    "enabled": true,
    "debounceMs": 10000
  },
  "embedding": {
    "provider": "gemini",
    "model": "gemini-embedding-001",
    "apiKey": "${GOOGLE_API_KEY}",
    "chunkSize": 1000,
    "chunkOverlap": 200,
    "dimensions": 3072,
    "rateLimitPerMinute": 1000,
    "concurrency": 5
  },
  "vectorStore": {
    "url": "http://localhost:6333",
    "collectionName": "jeeves_archive"
  },
  "metadataDir": ".jeeves-watcher",
  "api": {
    "host": "127.0.0.1",
    "port": 3456
  },
  "inferenceRules": [
    {
      "match": {
        "properties": {
          "file": {
            "properties": {
              "path": { "type": "string", "glob": "d:/meetings/**" }
            }
          }
        }
      },
      "set": { "domain": "meetings" }
    }
  ],
  "logging": {
    "level": "info",
    "file": "./logs/watcher.log"
  }
}
```
