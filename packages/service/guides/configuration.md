---
title: Configuration Reference
---

# Configuration Reference

Complete reference for all `jeeves-watcher` configuration options.

## Configuration File

The CLI always takes the config path explicitly: `jeeves-watcher start -c <path>` (and `service install -c <path>`, `config validate -c <path>`). `start` loads the file with [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig), so it may be JSON, YAML or JavaScript/TypeScript; `jeeves-watcher init -o <dir>` writes `<dir>/config.json`.

Only programmatic use without a path (`startFromConfig()` or `loadConfig()` with no argument) searches for a config: a legacy `jeeves-watcher.config.json` in the working directory is first moved to `jeeves-watcher/config.json` and that file is loaded; otherwise cosmiconfig searches the working directory (not its parents) for:

- a `jeeves-watcher` property in `package.json`
- `.jeeves-watcherrc` (JSON or YAML)
- `.jeeves-watcherrc.json`, `.yaml`, `.yml`, `.js`, `.ts`, `.cjs`, `.mjs`
- the same `jeeves-watcherrc` files under `.config/` (for example `.config/jeeves-watcherrc.json`)
- `jeeves-watcher.config.js`, `.ts`, `.cjs`, `.mjs`

When the config is loaded, string `inferenceRules` entries and string `maps` values (JSON file paths) are read relative to the config file's directory, defaults are applied and `${ENV_VAR}` references are substituted (see [Environment Variable Substitution](#environment-variable-substitution)).

### Schema Validation

The `init` command generates a config with a `$schema` pointer for IDE autocomplete and validation:

```jsonc
{
  "$schema": "node_modules/@karmaniverous/jeeves-watcher/config.schema.json",
  "watch": { ... }
}
```

This enables IntelliSense in VSCode and other editors that support JSON Schema.

`jeeves-watcher config validate -c <path>` checks a JSON config file against the same schema (without substituting `${ENV_VAR}` references or loading rule files). A running service validates a candidate config more deeply with [`POST /config/validate`](./api-reference.md#post-configvalidate).

Top-level keys the schema does not define are dropped without an error or warning. In particular `metadataDir`, `extractors` and `slots`, documented by older versions, are not config keys: enrichment lives in the SQLite enrichment store under [`stateDir`](#-persistent-state), and extractors are built in (see [Text Extraction](./architecture.md#text-extraction)).

> **Check the version before deploying new keys.** Versions before 0.20.0 silently ignore config keys they do not know. A config that uses `sources`, `api.apiKey` or `vectorStore.payloadIndexes` loads without error on an older watcher, which then runs without those features (for example, with an open API). Confirm `jeeves-watcher --version` reports 0.20.0 or later before deploying such a config.

## Top-Level Schema

```typescript
interface JeevesWatcherConfig {
  description?: string; // Organizational strategy description (v0.5.0+)
  schemas?: Record<string, SchemaEntry>; // Global named schemas (v0.5.0+)
  watch: WatchConfig;
  configWatch?: ConfigWatchConfig;
  embedding: EmbeddingConfig;
  vectorStore: VectorStoreConfig;
  stateDir?: string; // Persistent state directory (default ".jeeves-metadata")
  api?: ApiConfig;
  inferenceRules?: (InferenceRule | string)[]; // Inline rules or JSON rule file paths
  maps?: Record<string, unknown>; // Named JsonMap definitions
  templates?: Record<string, unknown>; // Named template definitions
  mapHelpers?: Record<string, HelperRef>; // Named map helper modules
  templateHelpers?: Record<string, HelperRef>; // Named template helper modules
  search?: SearchConfig; // Score thresholds and hybrid search
  reindex?: ReindexConfig; // Completion callback and concurrency
  vcs?: VcsConfig; // Version control settings
  sources?: Record<string, SourceConfig>; // Named callback sources for source documents (v0.20.0+)
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
| --- | --- | --- | --- |
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
| --- | --- |
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
| --- | --- | --- | --- |
| `paths` | `(string \| { path, vcs? })[]` | **Required** | Glob patterns for files to watch (at least one). Supports picomatch syntax. An entry may be an object with a `path` glob and per-root `vcs` overrides (see [Version Control](./version-control.md#per-root-overrides)). |
| `ignored` | `string[]` | `["**/node_modules/**"]` | Glob patterns to exclude from watching. Setting the key replaces the default, so list `**/node_modules/**` again if you need it. |
| `debounceMs` | `number` | `300` | Events for the same file are collapsed until this long has passed since the last one (prevents re-embedding during rapid edits). |
| `stabilityThresholdMs` | `number` | `500` | File must be stable (no size changes) for this long before processing. |
| `pollIntervalMs` | `number` | `1000` | Polling interval if `usePolling` is enabled. |
| `usePolling` | `boolean` | `false` | Use polling instead of native filesystem events. Enable for network drives or Docker volumes. |
| `respectGitignore` | `boolean` | `true` | Skip files ignored by `.gitignore` in git repositories. Nested `.gitignore` files are respected within their subtree. Only applies to repos with a `.git` directory. |
| `moveDetection.enabled` | `boolean` | `true` | Treat an unlink followed by an add of the same content as a move: the points are re-keyed to the new path without re-embedding. |
| `moveDetection.bufferMs` | `integer` | `2000` | How long (ms, min 100) an unlink is held while waiting for a matching add before it is treated as a delete. |

A config reload that changes `paths`, `ignored`, `moveDetection` or `respectGitignore` rebuilds the filesystem watcher with the new `watch` settings; a change to the other keys alone does not. `debounceMs` belongs to the file event queue and is read at startup only.

**Glob examples:**

```jsonc
{
  "paths": [
    "d:/email/archive/**/*.json", // All .json files under archive (Windows)
    "./meetings/**/*.{txt,md}", // .txt or .md files under meetings
    "**/*.pdf", // All PDFs recursively
    "/absolute/path/to/docs/**", // Absolute path (Linux/macOS)
  ],
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
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | Watch config file for changes and trigger scoped reindex. |
| `debounceMs` | `number` | `1000` | Debounce window for config changes. |
| `reindex` | `string` | `"issues"` | Reindex scope on config change: `"issues"` (re-process files with open issues), `"rules"` (re-apply inference rules without re-embedding), or `"full"` (clear the values index and re-process every watched file; files whose embedded text is unchanged are still skipped by content hash). `"path"` and `"prune"` fail config validation here. |

When the config file changes:

1. Watcher reloads and validates the new config (non-fatal warnings, such as a rule property named like a reserved system field, are logged)
2. Inference rules are recompiled and templates and helpers rebuilt
3. The filesystem watcher is rebuilt if the `watch` settings changed
4. A reindex is triggered with the configured scope

A reload that fails (invalid config, unreadable rule file) is logged as `Failed to reload config` and the previous config stays in effect. `POST /config/apply` triggers the same `configWatch.reindex` scope after it writes the file.

The config-triggered reindex covers files only; source documents are re-processed by an explicit `POST /reindex`. Settings read only at startup (`api.apiKey`, `sources`, `vectorStore.payloadIndexes`) do not change on reload: restart the watcher.

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
| --- | --- | --- | --- |
| `provider` | `string` | `"gemini"` | Embedding provider: `"gemini"`, `"mock"`. Any other name stops the service at startup (`Unsupported embedding provider`). |
| `model` | `string` | `"gemini-embedding-001"` | Model name (e.g., `"gemini-embedding-001"` for Gemini). |
| `apiKey` | `string` | `undefined` | API key. Supports `${ENV_VAR}` template syntax. Required by the Gemini provider (startup fails without it); ignored by mock. |
| `chunkSize` | `number` | `1000` | Maximum characters per chunk for text splitting. |
| `chunkOverlap` | `number` | `200` | Overlap between consecutive chunks (helps preserve context at boundaries). |
| `dimensions` | `number` | `3072` | Vector dimensions: the size of a new collection, and the vector size requested from Gemini (`outputDimensionality`). Must match an existing collection. |
| `rateLimitPerMinute` | `number` | `300` | Max embedding API **requests** per minute, shared by every caller. `0` disables the request-rate limit. See [Rate Limiting](#embedding-rate-limiting). |
| `concurrency` | `number` | `5` | Max documents processed concurrently by the file event queue, and by the source-document notify queue. |

### Embedding Rate Limiting

> **Behaviour change in 0.20.0.** `embedding.rateLimitPerMinute` now limits embedding API **requests**, not file-watch events. Review the value when upgrading.

Before 0.20.0, `rateLimitPerMinute` drove a token bucket inside the file event queue that counted processed watch events, while reindex and search called the provider without any limit.

Since 0.20.0, one token bucket wraps the embedding provider. It is created once at startup and shared by file watching, source-document notifications, reindex and search:

- Each provider request costs one token. A request is a batch of up to 100 chunks of one document, or a single search query, so a large document can cost several tokens.
- The bucket holds one minute's worth of tokens (`rateLimitPerMinute`, which is also the burst size) and refills continuously.
- `0` disables the request-rate limit. When the key is omitted, the default of `300` applies.
- `embedding.concurrency` is unchanged in meaning: it caps how many queued documents are processed at once.

On HTTP `429` the limiter pauses **every** caller for the provider's `Retry-After` (the header, or Google's `retryDelay` in the response body; without either, 1 second doubling per attempt, capped at the root `maxBackoffMs`, default 60 seconds; see Error Resilience below), then retries:

- A requested pause of up to `maxBackoffMs` is waited **in full** (never shortened, so the retry is not throttled again).
- A requested pause **longer** than `maxBackoffMs` fails the request at once, and every other caller fails fast until the pause has fully passed (even once less than `maxBackoffMs` of it remains).
- **Indexing** (watch, notify, reindex): up to 5 attempts per request, then the document gets an `embedding_error` issue.
- **Search**: up to 3 attempts and at most 10 seconds of waiting (or at once on a pause longer than `maxBackoffMs`), then `POST /search` answers `503` with a `Retry-After` header instead of `500`:

```json
{
  "code": "embedding_unavailable",
  "error": "EmbeddingUnavailableError",
  "message": "Embedding provider still rate-limited after 3 attempts: ..."
}
```

- Retries the Gemini client makes on its own after other failures also take a token, so every HTTP request to the provider counts against `rateLimitPerMinute`.

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

The provider calls the Gemini `batchEmbedContents` REST endpoint and requests vectors of the configured `dimensions` (`outputDimensionality`), so any size the model supports works: `3072` (native, the default and the `init` template value) or a smaller one such as `768` or `1536`. A response of any other length fails with `Gemini embedding returned invalid dimensions`. Reduced-size Gemini vectors are not normalised; the collection's Cosine distance makes that irrelevant for search. `dimensions` must still match an existing collection.

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
| --- | --- | --- | --- |
| `url` | `string` | **Required** | Qdrant server URL. |
| `collectionName` | `string` | **Required** | Qdrant collection name. Created automatically if it doesn't exist. |
| `apiKey` | `string` | `undefined` | Qdrant API key (for Qdrant Cloud). |
| `payloadIndexes` | `PayloadIndex[]` | `[]` | Qdrant payload indexes to create at startup (v0.20.0+). See [Payload Indexes](#payload-indexes). |

**On startup**, the watcher:

1. Checks if the collection exists
2. If not, creates it with the configured vector dimensions and Cosine distance
3. If it already exists, uses it as-is (dimensions and distance are not validated)
4. Creates any missing payload index (configured, plus the automatic `source` and `source_rule` indexes)

**Warning:** If the collection exists with different dimensions (e.g., manually created with 768 instead of 3072), the service will start but embedding upserts will fail with a dimension mismatch error.

To change embedding settings that affect vector dimensions:

1. Delete the old collection (or rename `collectionName` in config)
2. Restart the watcher (it will recreate the collection and reindex)

### Payload Indexes

**v0.20.0+**

Qdrant filters on large collections are fast only on indexed fields. Declare the fields you filter on:

```json
{
  "vectorStore": {
    "url": "http://localhost:6333",
    "collectionName": "app_documents",
    "payloadIndexes": [
      { "field": "user_id", "type": "keyword", "isTenant": true },
      { "field": "type", "type": "keyword" },
      { "field": "updated_at", "type": "integer", "isPrincipal": true }
    ]
  }
}
```

| Field | Type | Description |
| --- | --- | --- |
| `field` | `string` | Payload field to index. |
| `type` | `string` | Qdrant index type: `keyword`, `integer`, `float`, `bool`, `datetime`, `uuid` or `text`. |
| `isTenant` | `boolean?` | Qdrant `is_tenant: true`: optimises storage for per-tenant filtering. Valid only for `keyword` and `uuid`. |
| `isPrincipal` | `boolean?` | Qdrant `is_principal: true`: optimises storage for range filtering on the main ordering field. Valid only for `integer`, `float` and `datetime`. |

Behaviour:

- Indexes are created **at startup only**, when missing. A config reload does not create them; restart after adding one.
- Indexes are never dropped or recreated. If a field is already indexed with a different type, or with the same type but different `isTenant` / `isPrincipal` flags, the watcher logs a warning and leaves it alone (drop the index in Qdrant and restart to apply the configured one).
- `source` and `source_rule` always get `keyword` indexes and may not be listed here: an entry for either fails config validation.
- Each field may be listed once: a repeated `field` fails config validation.
- Failing to create an index stops startup with an error naming the field.
- The `chunk_text` full-text index is separate: it is managed by `search.hybrid.enabled`, not by `payloadIndexes`.
- `isTenant` / `isPrincipal` on an unsupported type fails config validation.

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
| --- | --- | --- | --- |
| `host` | `string` | `"127.0.0.1"` | Host to bind to. Use `"0.0.0.0"` to accept external connections. |
| `port` | `number` | `1936` | Port to listen on. |
| `cacheTtlMs` | `number` | `30000` | TTL in milliseconds for caching read-heavy endpoints. |
| `apiKey` | `string` | `undefined` | Bearer API key required on every route except `GET /status` (v0.20.0+). Supports `${ENV_VAR}`. Read at startup only. |

The API provides endpoints for search, metadata enrichment, reindexing, and status. See [API Reference](./api-reference.md).

When `apiKey` is set, every request except `GET /status` must send `Authorization: Bearer <apiKey>`, or it gets `401`. It must be non-empty: `""`, or a `${...}` that substitutes to an empty string, fails config validation, and an unresolved `${...}` stops the service at startup. Omit the key to run without authentication. The whole `api` block is left out of `GET /config`. Changing the key requires a restart. The CLI API commands read the key from `--api-key` or `JEEVES_WATCHER_API_KEY`, and the OpenClaw plugin from its `apiKey` setting or the same variable; setting `apiKey` here does not configure them. See [Authentication](./api-reference.md#authentication).

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
      "schema": ["base", { "properties": { "domain": { "set": "meetings" } } }]
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

- **`name`** (non-empty string, unique): rule identifier
- **`description`** (non-empty string): human-readable purpose
- **`match`** (JSON Schema object): attributes matcher

Optional fields:

- **`schema`** (array of named schema references and/or inline objects): metadata schema with `set` templates
- **`map`** (inline JsonMap, named map reference, or `.json` file path): transformation to derive metadata
- **`template`** (inline Handlebars string, named template, or `.hbs`/`.handlebars` file path): content transformation for embedding
- **`render`** (declarative `frontmatter` + `body` sections): structured Markdown output; mutually exclusive with `template`
- **`renderAs`** (1–10 lowercase alphanumeric characters, e.g. `"md"`): output file extension override; requires `template` or `render`

An `inferenceRules` entry may also be a string: the path of a JSON file holding one rule, resolved relative to the config file's directory.

See the [Inference Rules Guide](./inference-rules.md) for full details on schema merge semantics, type coercion, `uiHint` and reserved field names.

---

## `maps` - Named JsonMap Definitions

`maps` is an optional dictionary of reusable [JsonMap](https://github.com/karmaniverous/jsonmap) definitions.

Rules can reference these by name via `inferenceRules[*].map: "mapName"`.

Each value is an inline JsonMap, a `.json` file path (resolved relative to the config directory when the config loads), or a wrapper object `{ "map": <JsonMap or file path>, "description": "..." }`:

```json
{
  "maps": {
    "extractProject": {
      "description": "Extract project name from first path segment",
      "map": {
        "project": {
          "$": [
            { "method": "$.lib.split", "params": ["$.input.file.path", "/"] },
            { "method": "$.lib.slice", "params": ["$[0]", 0, 1] },
            { "method": "$.lib.join", "params": ["$[0]", ""] }
          ]
        }
      }
    },
    "fromFile": "maps/from-file.json"
  }
}
```

---

## `mapHelpers` - Map Helper Modules

```json
{
  "mapHelpers": {
    "dateUtils": {
      "path": "./helpers/date-utils.js",
      "description": "Date parsing utilities"
    },
    "pathUtils": { "path": "./helpers/path-utils.js" }
  }
}
```

Named object format (`Record<string, { path, description? }>`), paths relative to the config directory. Every exported function of the module (or of its default-export object) is added to the JsonMap `$.lib` as `<namespace>_<export>` (e.g., `$.lib.dateUtils_parseDate`).

---

## `templateHelpers` - Template Helper Modules

```json
{
  "templateHelpers": {
    "jira": {
      "path": "./helpers/jira-helpers.js",
      "description": "Jira-specific Handlebars helpers"
    },
    "formatting": { "path": "./helpers/formatting.js" }
  }
}
```

Named object format (`Record<string, { path, description? }>`), paths relative to the config directory. The module's default export is called as `register(handlebars, namespace)`; every helper it registers is renamed to `<namespace>_<name>` (e.g., `{{jira_ticketUrl key}}`).

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

Each value is a template string or a wrapper object `{ "template": "...", "description": "..." }`. A string ending in `.hbs` or `.handlebars` is a file path (relative to the config directory); any other string is the template source.

---

## `search` - Search Behavior

```json
{
  "search": {
    "scoreThresholds": {
      "strong": 0.85,
      "relevant": 0.7,
      "noise": 0.5
    },
    "hybrid": {
      "enabled": true,
      "textWeight": 0.3
    }
  }
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `scoreThresholds.strong` | `number` | none | Minimum score for a strong match (-1 to 1). |
| `scoreThresholds.relevant` | `number` | none | Minimum score for a relevant match (-1 to 1). |
| `scoreThresholds.noise` | `number` | none | Score below which results are noise (-1 to 1). |
| `hybrid.enabled` | `boolean` | `false` | Combine vector search with full-text (BM25) search on `chunk_text`, fused with RRF. |
| `hybrid.textWeight` | `number` | `0.3` | Weight of the text results in the fusion (0 to 1). |

`scoreThresholds` has no defaults: the block is optional, but when present all three values are required. The service does not use them itself: they are published in `GET /config` for clients that grade results (the OpenClaw plugin, for example, tells agents to read them there).

With `hybrid.enabled`, the watcher creates a full-text index on `chunk_text` at startup if it is missing. Searches read the `hybrid` settings on every request, so a reload switches modes; after enabling hybrid search, restart once so the index exists.

---

## `stateDir` - Persistent State

```json
{
  "stateDir": "/var/lib/jeeves-watcher"
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `stateDir` | `string` | `".jeeves-metadata"` | Directory for the watcher's persistent state. Created if missing; a relative path resolves against the working directory. |

Contents:

- `enrichments.sqlite`: the enrichment store (metadata written by `POST /metadata` and `POST /rebuild-metadata`), a SQLite database opened with Node's built-in `node:sqlite` (WAL mode, so `-wal` and `-shm` files sit next to it)
- `issues.json`: open processing issues, as returned by `GET /issues`
- `values.v8`: the values index behind `GET /search/facets` and the rule `values` in `GET /config`

The enrichment store is the only file that cannot be regenerated: back it up (see [Deployment](./deployment.md)). With VCS enabled, `stateDir` must not be equal to, inside, or a parent of any watch root; startup fails otherwise. Keep it out of the watched paths in any case (or add it to `watch.ignored`) so its files are not indexed.

---

## `reindex` - Reindex Behavior

```json
{
  "reindex": {
    "callbackUrl": "http://localhost:8080/webhook/reindex-complete",
    "concurrency": 50
  }
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `callbackUrl` | `string` (URL) | `undefined` | URL to `POST` a JSON summary to when a reindex run completes. |
| `concurrency` | `integer` (≥ 1) | `50` | Items a reindex works on at once: files, source documents submitted to the notify queue, and stored-rule lookups (issue-source discovery, `POST /reindex` with `source`). |

The callback body is `{ scope, filesProcessed, durationMs, errors, sources? }`: `errors` lists the failed file paths, then the failed source references (or the run's error message when the run failed as a whole), and `sources` counts the source outcomes (`indexed`, `unchanged`, `deleted`, `failed`) when the run covered source documents. Delivery is attempted up to 3 times (exponential backoff from 1 s, capped at 4 s); a non-2xx answer counts as a failure. If every attempt fails, `Reindex callback delivery failed; giving up` is logged: the run's result is unaffected and the callback is not re-sent. Dry runs and `path` reindexes of source references send no callback. A failing file never stops a run: it is logged and listed in `errors`, and the remaining files are still processed.

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
| --- | --- | --- | --- |
| `level` | `string` | `"info"` | pino log level: `"trace"`, `"debug"`, `"info"`, `"warn"`, `"error"`, `"fatal"`, or `"silent"` to turn logging off. Any other value stops the service at startup. |
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
| --- | --- | --- | --- |
| `shutdownTimeoutMs` | `number` | `10000` | Max time (ms) to wait for in-flight operations on shutdown (SIGTERM/SIGINT). |

On shutdown, the watcher (v0.20.0+ order):

1. Stops the config watcher
2. Closes the API server, so no new request (notification, reindex, ...) is accepted
3. Stops the remaining producers: VCS (each root commits its pending files), then the filesystem watcher
4. Drains and stops the file event queue, then drains and stops the source notify queue (each drain and each stop bounded by `shutdownTimeoutMs`); stopping drops work the drain did not reach and waits for in-flight runs
5. Flushes the values index
6. Closes the enrichment store, unless a queue step timed out: runs may then still be in flight, so the store is left open (and a warning is logged) rather than closed under them
7. Exits

---

## `maxRetries` / `maxBackoffMs` - Error Resilience

```json
{
  "maxRetries": 10,
  "maxBackoffMs": 60000
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `maxRetries` | `number` | `Infinity` | Maximum consecutive system-level failures before triggering fatal error. |
| `maxBackoffMs` | `number` | `60000` | Maximum backoff delay in milliseconds for system errors. |

---

## `vcs` — Version Control

```json
{
  "vcs": {
    "enabled": true,
    "commitThrottleMs": 30000,
    "maxBatchSize": 1000,
    "branch": "master",
    "commitMessage": {
      "enabled": true,
      "provider": "anthropic",
      "model": "claude-haiku-4-0",
      "apiKey": "${ANTHROPIC_API_KEY}"
    },
    "retention": {
      "maxAgeDays": 30,
      "maxVersions": 100,
      "squashCron": "0 0 * * *"
    },
    "defaultAccessToken": "${GIT_ACCESS_TOKEN}",
    "staleLockThresholdMs": 60000,
    "maxConsecutiveFailures": 5,
    "circuitBreakerCooldownMs": 300000
  }
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `false` | Enable git-backed content versioning. |
| `commitThrottleMs` | `number` | `30000` | Throttle interval (ms) for batching commits (min: 1000). |
| `maxBatchSize` | `number` | `1000` | Max files per commit batch (min: 1). |
| `branch` | `string` | `"master"` | Git branch name for VCS operations. Squash retention and startup recovery target this branch. |
| `author.name` | `string` | `"jeeves-watcher"` | Git commit author name, written to each repository's local git config at startup. |
| `author.email` | `string` | `"watcher@localhost"` | Git commit author email. |
| `commitMessage.enabled` | `boolean` | `true` | Enable AI-generated commit messages. |
| `commitMessage.provider` | `string` | `"anthropic"` | LLM provider. |
| `commitMessage.model` | `string` | `"claude-haiku-4-0"` | Model name. |
| `commitMessage.apiKey` | `string` | `undefined` | API key (`${ENV_VAR}` supported). Falls back to the provider key in the local OpenClaw config; without either, commits use a template message. |
| `retention.maxAgeDays` | `number` | `30` | Squash commits older than this (min: 1). |
| `retention.maxVersions` | `number` | `100` | Keep at most this many commits (min: 1). |
| `retention.squashCron` | `string` | `"0 0 * * *"` | Cron schedule for squash (5-field format). |
| `defaultAccessToken` | `string` | `undefined` | Shared access token for remote push (`${ENV_VAR}` supported). |
| `staleLockThresholdMs` | `number` | `60000` | Age in ms after which an `index.lock` is considered stale and force-removed (min: 5000). |
| `maxConsecutiveFailures` | `number` | `5` | Circuit breaker: trip after this many consecutive commit failures (min: 1). Pending files are retained. |
| `circuitBreakerCooldownMs` | `number` | `300000` | Cooldown in ms before a tripped breaker makes a single recovery attempt (min: 1000). |

Retention defaults (30 days, 100 versions, daily midnight cron) apply automatically when `vcs.enabled` is `true`, even if the `retention` block is omitted.

Per-root overrides (including `remote` and `accessToken`) are configured via `watch.paths` object entries. A per-root `vcs` block takes the schema defaults for omitted keys (notably `enabled: false`), not the root-level values; see [Per-Root Overrides](./version-control.md#per-root-overrides). The root-level `vcs` block is never returned by `GET /config`. See [Version Control (VCS) Guide](./version-control.md) for full details on configuration, API endpoints, squash retention, and remote push.

---

## `sources` - Source Documents

**v0.20.0+**

Named HTTP callbacks for [source documents](./source-documents.md): records that live in another system and are retrieved by reference (`<name>://<id>`).

```json
{
  "sources": {
    "app": {
      "url": "https://app.internal.example/watcher/documents/{id}",
      "headers": { "Authorization": "Bearer ${APP_CALLBACK_TOKEN}" },
      "timeoutMs": 10000,
      "concurrency": 8
    }
  }
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| _key_ | `string` | — | Source name used in references: a lowercase letter, then 1–31 of `[a-z0-9-]`. |
| `url` | `string` | **Required** | Callback URL template containing `{id}`. Each `/`-segment of the id is URL-encoded; slashes are kept. Absolute `http`/`https` only, with `{id}` outside the scheme, host and port. |
| `headers` | `Record<string, string>` | `undefined` | Headers sent with every callback. |
| `timeoutMs` | `number` | `10000` | Callback timeout (ms). |
| `concurrency` | `number` | `8` | Max concurrent callbacks to this source. |

- `url` and `headers` support `${ENV_VAR}`; an unresolved reference stops the service at startup.
- Read at startup only: restart to change.
- Never exposed by `GET /config`.
- Unknown keys under a source (for example `timeout`) are ignored with a warning: logged at startup and on config reload, and returned by `POST /config/validate` as `warnings`.
- Callback responses larger than 10 MiB fail with `source_unavailable` (`response too large`).

See the [Source Documents guide](./source-documents.md#the-callback-contract) for the callback contract.

---

## Environment Variable Substitution

All string fields support `${ENV_VAR}` template syntax:

```json
{
  "embedding": {
    "apiKey": "${GOOGLE_API_KEY}"
  },
  "vectorStore": {
    "url": "https://qdrant.example.com:6333",
    "collectionName": "jeeves_archive",
    "apiKey": "${QDRANT_API_KEY}"
  }
}
```

When the config is loaded (at startup and on every reload), these are replaced with the environment variable values. A reference to a variable that is not set is left as the literal `${...}` text, except for the secret-bearing values `api.apiKey`, `sources.*.url` and `sources.*.headers.*`: there a reference that cannot be resolved stops the service at startup (the error names the config path, never the value). Set templates in inference rules use Handlebars `{{...}}` syntax (e.g. `{{frontmatter.title}}`), which is distinct from the `${...}` environment variable syntax used in config values like `embedding.apiKey`.

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
  "stateDir": "d:/jeeves-watcher/state",
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
      "schema": ["base", { "properties": { "domain": { "set": "meetings" } } }]
    }
  ],
  "search": {
    "scoreThresholds": {
      "strong": 0.85,
      "relevant": 0.7,
      "noise": 0.5
    }
  },
  "logging": {
    "level": "info",
    "file": "./logs/watcher.log"
  }
}
```
