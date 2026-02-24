---
title: Configuration Reference
---

# Configuration Reference

Complete reference for all `jeeves-watcher` configuration options.

## Configuration File

The configuration file is auto-discovered via [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig) in this order:

1. `--config <path>` CLI flag (explicit path)
2. Cosmiconfig search (current directory upward):
   - `jeeves-watcher` property in `package.json`
   - `.jeeves-watcherrc` (JSON or YAML)
   - `.jeeves-watcherrc.json`, `.jeeves-watcherrc.yaml`, `.jeeves-watcherrc.yml`
   - `.jeeves-watcherrc.js`, `.jeeves-watcherrc.ts`, `.jeeves-watcherrc.cjs`
   - `jeeves-watcher.config.js`, `jeeves-watcher.config.ts`, `jeeves-watcher.config.cjs`

### Schema Validation

The `init` command generates a config with a `$schema` pointer for IDE autocomplete and validation:

```json
{
  "$schema": "node_modules/@karmaniverous/jeeves-watcher/config.schema.json",
  "watch": { ... }
}
```

This enables IntelliSense in VSCode and other editors that support JSON Schema.

## Top-Level Schema

```typescript
interface JeevesWatcherConfig {
  watch: WatchConfig;
  configWatch?: ConfigWatchConfig;
  embedding: EmbeddingConfig;
  vectorStore: VectorStoreConfig;
  metadataDir?: string;
  stateDir?: string;                              // Directory for persistent state files
  api?: ApiConfig;
  extractors?: Record<string, unknown>;
  inferenceRules?: InferenceRule[];
  maps?: Record<string, unknown>;                 // Named JsonMap definitions
  templates?: Record<string, unknown>;            // Named template definitions
  mapHelpers?: Record<string, HelperRef>;         // Named map helper modules
  templateHelpers?: Record<string, HelperRef>;    // Named template helper modules
  slots?: Record<string, QdrantFilter>;           // Named Qdrant filter patterns
  search?: SearchConfig;                          // Search behavior settings
  reindex?: ReindexConfig;                        // Reindex behavior settings
  logging?: LoggingConfig;
  shutdownTimeoutMs?: number;
  maxRetries?: number;
  maxBackoffMs?: number;
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
    "usePolling": false,
    "respectGitignore": true
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `paths` | `string[]` | **Required** | Glob patterns for files to watch. Supports picomatch syntax. |
| `ignored` | `string[]` | `[]` | Glob patterns to exclude from watching. |
| `debounceMs` | `number` | `300` | Wait this long after last change before processing (prevents re-embedding during rapid edits). |
| `stabilityThresholdMs` | `number` | `500` | File must be stable (no size changes) for this long before processing. |
| `pollIntervalMs` | `number` | `1000` | Polling interval if `usePolling` is enabled. |
| `usePolling` | `boolean` | `false` | Use polling instead of native filesystem events. Enable for network drives or Docker volumes. |
| `respectGitignore` | `boolean` | `true` | Skip files ignored by `.gitignore` in git repositories. Nested `.gitignore` files are respected within their subtree. Only applies to repos with a `.git` directory. |

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
| `debounceMs` | `number` | `1000` | Debounce window for config changes. |
| `reindex` | `string` | `"rules"` | Reindex behavior on config change: `"rules"` (metadata-only), `"full"` (re-embed), `"none"` (no reindex). |

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
    "rateLimitPerMinute": 300,
    "concurrency": 5
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provider` | `string` | `"gemini"` | Embedding provider: `"gemini"`, `"mock"`. |
| `model` | `string` | `"gemini-embedding-001"` | Model name (e.g., `"gemini-embedding-001"` for Gemini). |
| `apiKey` | `string` | `undefined` | API key. Supports `${ENV_VAR}` template syntax. Required for production providers (not mock). |
| `chunkSize` | `number` | `1000` | Maximum characters per chunk for text splitting. |
| `chunkOverlap` | `number` | `200` | Overlap between consecutive chunks (helps preserve context at boundaries). |
| `dimensions` | `number` | Provider default | Vector dimensions. Gemini `gemini-embedding-001` = 3072. |
| `rateLimitPerMinute` | `number` | `300` | Max embedding requests per minute (provider rate limit). |
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
2. Restart the watcher (it will recreate the collection and reindex)

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

### JSON Content Extraction

For `.json` files, the extractor looks for text content in these fields (in order):

1. `content`
2. `body`
3. `text`
4. `snippet`
5. `subject`
6. `description`
7. `summary`
8. `transcript`

If none are found, the entire JSON is stringified for embedding.

---

## `inferenceRules` - Metadata Enrichment Rules

```json
{
  "inferenceRules": [
    {
      "name": "meeting-classifier",
      "description": "Classify files under meetings directory",
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
      "name": "frontmatter-title",
      "description": "Extract title from frontmatter",
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

Each rule requires a **`name`** (unique identifier) and has an optional **`description`**, a **JSON Schema `match`**, a **`set` action**, and optional **`map` (JsonMap) transform**. See [Inference Rules Guide](./inference-rules.md) for full details.

> **v0.5.0:** The `name` field is now required on all inference rules. The optional `description` field documents the rule's purpose.

---

## `maps` - Named JsonMap Definitions

`maps` is an optional dictionary of reusable [JsonMap](https://github.com/karmaniverous/jsonmap) definitions.

Rules can reference these by name via `inferenceRules[*].map: "mapName"`.

Maps support an optional description wrapper format:

```json
{
  "maps": {
    "extractProject": {
      "description": "Extract project name from first path segment",
      "project": {
        "$": [
          { "method": "$.lib.split", "params": ["$.input.file.path", "/"] },
          { "method": "$.lib.slice", "params": ["$[0]", 0, 1] },
          { "method": "$.lib.join", "params": ["$[0]", ""] }
        ]
      }
    }
  }
}
```

---

## `mapHelpers` - Map Helper Modules

```json
{
  "mapHelpers": {
    "dateUtils": { "path": "./helpers/date-utils.js", "description": "Date parsing utilities" },
    "pathUtils": { "path": "./helpers/path-utils.js" }
  }
}
```

Named object format (`Record<string, { path, description? }>`). Helper names are namespace-prefixed when loaded (e.g., `dateUtils.parseDate`).

---

## `templateHelpers` - Template Helper Modules

```json
{
  "templateHelpers": {
    "jira": { "path": "./helpers/jira-helpers.js", "description": "Jira-specific Handlebars helpers" },
    "formatting": { "path": "./helpers/formatting.js" }
  }
}
```

Named object format (`Record<string, { path, description? }>`). Helper names are namespace-prefixed when registered with Handlebars (e.g., `jira.ticketUrl`).

---

## `templates` - Named Template Definitions

```json
{
  "templates": {
    "jira-issue": "templates/jira-issue.hbs",
    "simple-doc": {
      "description": "Simple document template",
      "template": "# {{heading}}\n\n{{body}}"
    }
  }
}
```

Templates support an optional description wrapper format alongside direct string values.

---

## `slots` - Named Qdrant Filter Patterns

Reusable filter patterns referenced by name in search operations.

```json
{
  "slots": {
    "meetings-only": {
      "must": [{ "key": "domain", "match": { "value": "meetings" } }]
    },
    "recent-projects": {
      "must": [{ "key": "domain", "match": { "value": "projects" } }],
      "must_not": [{ "key": "labels", "match": { "value": "archived" } }]
    }
  }
}
```

Each slot is a standard [Qdrant filter object](https://qdrant.tech/documentation/concepts/filtering/).

---

## `search` - Search Behavior

```json
{
  "search": {
    "scoreThresholds": {
      "strong": 0.85,
      "relevant": 0.70,
      "noise": 0.50
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `scoreThresholds.strong` | `number` | `0.85` | Score above which results are considered strong matches. |
| `scoreThresholds.relevant` | `number` | `0.70` | Score above which results are considered relevant. |
| `scoreThresholds.noise` | `number` | `0.50` | Score below which results are considered noise. |

---

## `stateDir` - Persistent State

```json
{
  "stateDir": ".jeeves-watcher/state"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `stateDir` | `string` | `".jeeves-watcher/state"` | Directory for persistent state files (reindex tracking, issue records, etc.). |

---

## `reindex` - Reindex Behavior

```json
{
  "reindex": {
    "callbackUrl": "http://localhost:8080/webhook/reindex-complete"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `callbackUrl` | `string` | `undefined` | URL to POST when a reindex completes. Retries with exponential backoff (3 attempts, 1s start). |

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
  "shutdownTimeoutMs": 10000
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `shutdownTimeoutMs` | `number` | `10000` | Max time (ms) to wait for in-flight operations on shutdown (SIGTERM/SIGINT). |

On shutdown, the watcher:
1. Stops accepting new file events
2. Drains current in-flight embeddings/upserts (up to timeout)
3. Exits cleanly

---

## `maxRetries` / `maxBackoffMs` - Error Resilience

```json
{
  "maxRetries": 10,
  "maxBackoffMs": 60000
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxRetries` | `number` | `Infinity` | Maximum consecutive system-level failures before triggering fatal error. |
| `maxBackoffMs` | `number` | `60000` | Maximum backoff delay in milliseconds for system errors. |

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

At runtime, these are replaced with actual environment variable values. **Unresolvable expressions are left untouched** — this allows `${...}` template syntax used in inference rule `set` values (e.g. `${frontmatter.title}`, `${file.path}`) to pass through for later resolution by the rules engine.

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
    "debounceMs": 1000
  },
  "embedding": {
    "provider": "gemini",
    "model": "gemini-embedding-001",
    "apiKey": "${GOOGLE_API_KEY}",
    "chunkSize": 1000,
    "chunkOverlap": 200,
    "dimensions": 3072,
    "rateLimitPerMinute": 300,
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
