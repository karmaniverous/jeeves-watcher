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
  description?: string;                           // Organizational strategy description (v0.5.0+)
  schemas?: Record<string, SchemaEntry>;          // Global named schemas (v0.5.0+)
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
  search?: SearchConfig;                          // Search behavior settings (scoreThresholds in v0.5.0+)
  reindex?: ReindexConfig;                        // Reindex behavior settings
  logging?: LoggingConfig;
  shutdownTimeoutMs?: number;
  maxRetries?: number;
  maxBackoffMs?: number;
}
```

---

## `description` - Deployment Description

**v0.5.0+**

```json
{
  "description": "This archive indexes documents across organizational domains (email, slack, jira, etc.). The domain property is the primary partition: every record belongs to exactly one domain."
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `description` | `string` | `undefined` | Human-readable description of this deployment's organizational strategy and content domains. Consumed by LLM agents for orientation. |

This field provides organizational context for LLM consumers. Delivered alongside the JSON Schema from `GET /config/schema`.

---

## `schemas` - Global Schemas Collection

**v0.5.0+**

Define reusable named schemas referenced by inference rules:

```json
{
  "schemas": {
    "base": {
      "type": "object",
      "properties": {
        "domain": {
          "type": "string",
          "description": "Content domain",
          "uiHint": "select"
        },
        "created": {
          "type": "integer",
          "description": "Record creation date as unix timestamp (seconds)",
          "uiHint": "date"
        }
      }
    },
    "jira-common": "schemas/jira-common.json"
  }
}
```

| Entry Type | Description |
|------------|-------------|
| Inline object | JSON Schema object defined directly in config |
| File path (string) | Relative path to a JSON schema file (resolved from config directory) |

Schema entries define property shapes (`type`, `description`, `uiHint`, `enum`) without `set` wiring. Inference rules reference these by name and layer on `set` templates in their inline tail objects.

See [Inference Rules Guide](./inference-rules.md) for merge semantics and usage patterns.

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
| `reindex` | `string` | `"issues"` | Reindex scope on config change: `"issues"` (re-process failed files), `"rules"` (re-apply inference rules), or `"full"` (re-embed all files). Note: `"path"` and `"prune"` are NOT valid for auto-trigger. |

When the config file changes:
1. Watcher reloads and validates the new config
2. Inference rules are recompiled
3. A reindex is triggered with the configured scope

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
    "port": 1936
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `host` | `string` | `"127.0.0.1"` | Host to bind to. Use `"0.0.0.0"` to accept external connections. |
| `port` | `number` | `1936` | Port to listen on. |

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

**v0.5.0:** Inference rules now use `schema` arrays instead of `set` objects. Rules require `name` and `description` fields.

```json
{
  "schemas": {
    "base": {
      "type": "object",
      "properties": {
        "domain": { "type": "string", "description": "Content domain" }
      }
    }
  },
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
      "schema": [
        "base",
        { "properties": { "domain": { "set": "meetings" } } }
      ]
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
      "schema": [
        {
          "properties": {
            "title": {
              "type": "string",
              "description": "Document title",
              "uiHint": "text",
              "set": "{{frontmatter.title}}"
            }
          }
        }
      ]
    }
  ]
}
```

Each rule requires:
- **`name`** (string, required, unique) — Rule identifier
- **`description`** (string, required) — Human-readable purpose
- **`match`** (JSON Schema object) — File attributes matcher
- **`schema`** (array of schema references and/or inline objects) — Metadata schema with `set` templates

Optional fields:
- **`map`** (JsonMap or named reference) — Transformation to derive metadata
- **`template`** (Handlebars template) — Content transformation for embedding

| `renderAs` | `string?` | Output file extension override (without dot, e.g. `"md"`). Requires `template` or `render`. 1–10 lowercase alphanumeric chars. |
See [Inference Rules Guide](./inference-rules.md) for full details on schema merge semantics, type coercion, and `uiHint`.

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

At runtime, these are replaced with actual environment variable values. Set templates in inference rules use Handlebars `{{...}}` syntax (e.g. `{{frontmatter.title}}`), which is distinct from the `${...}` environment variable syntax used in config values like `embedding.apiKey`.

---

## Example: Full Configuration

```json
{
  "description": "Production watcher indexing organizational documents across email, meetings, and projects",
  "schemas": {
    "base": {
      "type": "object",
      "properties": {
        "domain": {
          "type": "string",
          "description": "Content domain",
          "uiHint": "select"
        }
      }
    }
  },
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
    "debounceMs": 1000,
    "reindex": "issues"
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
  "stateDir": ".jeeves-watcher/state",
  "api": {
    "host": "127.0.0.1",
    "port": 1936
  },
  "inferenceRules": [
    {
      "name": "meetings-classifier",
      "description": "Classify meeting transcripts and notes",
      "match": {
        "properties": {
          "file": {
            "properties": {
              "path": { "type": "string", "glob": "d:/meetings/**" }
            }
          }
        }
      },
      "schema": [
        "base",
        { "properties": { "domain": { "set": "meetings" } } }
      ]
    }
  ],
  "search": {
    "scoreThresholds": {
      "strong": 0.85,
      "relevant": 0.70,
      "noise": 0.50
    }
  },
  "logging": {
    "level": "info",
    "file": "./logs/watcher.log"
  }
}
```
