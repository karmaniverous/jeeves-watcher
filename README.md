# Jeeves Watcher 🎩

Filesystem watcher that keeps a Qdrant vector store in sync with document changes.

## Overview

`jeeves-watcher` monitors a configured set of directories for file changes, extracts text content, generates embeddings, and maintains a synchronized Qdrant vector store for semantic search. It automatically:

- **Watches** directories for file additions, modifications, and deletions
- **Extracts** text from various formats (Markdown, PDF, DOCX, HTML, JSON, plain text)
- **Chunks** large documents for optimal embedding
- **Embeds** content using configurable providers (Google Gemini, mock for testing)
- **Syncs** to Qdrant for fast semantic search
- **Enriches** metadata via rules and API endpoints
- **Indexes source documents** (v0.20.0+): records that live in another system, retrieved by HTTP callback when the owner notifies the watcher (`POST /documents`)

### Source Documents and the SDK

Besides files, the watcher can index records owned by another application (chat threads, tickets, database rows). The application notifies the watcher with a reference such as `app://chat/thread/<id>` and a designated inference rule; the watcher calls back to a URL configured under `sources`, renders the JSON record with the rule, embeds it and keeps its points in sync. The watcher keeps no copy of the record. See the [Source Documents guide](packages/service/guides/source-documents.md).

[`@karmaniverous/jeeves-watcher-sdk`](packages/sdk/README.md) is a typed TypeScript client for the application-facing API (search, scan, render, metadata, reindex, issues, document notify/delete). When the API is exposed beyond localhost, protect it with `api.apiKey` ([Authentication](packages/service/guides/api-reference.md#authentication)).

### Architecture

![System Architecture](packages/service/assets/system-architecture.png)

For detailed architecture documentation, see [packages/service/guides/architecture.md](packages/service/guides/architecture.md).

## Prerequisites

- **Node.js** >=22.13
- **Qdrant** must be running and reachable before starting jeeves-watcher. The Qdrant collection is created automatically on first startup — no manual collection creation required.

## Quick Start

### Installation

```bash
npm install -g @karmaniverous/jeeves-watcher
```

### Initialize Configuration

Create a new configuration file in your project:

```bash
jeeves-watcher init -o ./config
```

`-o` names the output directory; this writes `./config/config.json` with sensible defaults (an existing file is left untouched). The template sets `embedding.dimensions` to `768`; with Gemini (`gemini-embedding-001` returns 3072-dimensional vectors) change it to `3072` before the first start.

### Configure

Edit `./config/config.json` to specify:

- **Watch paths**: Directories to monitor
- **Embedding provider**: Google Gemini or mock (for testing)
- **Qdrant connection**: URL and collection name
- **Inference rules**: Automatic metadata enrichment based on file patterns

Example minimal configuration:

```json
{
  "watch": {
    "paths": ["./docs"],
    "ignored": ["**/node_modules/**", "**/.git/**"]
  },
  "embedding": {
    "provider": "gemini",
    "model": "gemini-embedding-001",
    "apiKey": "${GOOGLE_API_KEY}"
  },
  "vectorStore": {
    "url": "http://localhost:6333",
    "collectionName": "my_docs"
  }
}
```

### Start Watching

```bash
jeeves-watcher start -c ./config/config.json
```

The watcher will:

1. Index all existing files in watched directories
2. Monitor for changes
3. Update Qdrant automatically

## CLI Commands

| Command | Description |
| --- | --- |
| `jeeves-watcher start -c <path>` | Start the filesystem watcher (foreground) |
| `jeeves-watcher init -o <dir>` | Write a default `config.json` into `<dir>` (pass `-o`: without it the command fails) |
| `jeeves-watcher status` | Probe service health and version (`GET /status`) |
| `jeeves-watcher reindex` | Trigger a scoped reindex (default `rules`) |
| `jeeves-watcher rebuild-metadata` | Rebuild the enrichment store from Qdrant payloads |
| `jeeves-watcher search <query>` | Search the vector store |
| `jeeves-watcher enrich <path>` | Enrich document metadata with key-value pairs |
| `jeeves-watcher config validate -c <path>` | Validate a config file against the schema |
| `jeeves-watcher service <action>` | Manage the watcher as a system service (`install`, `uninstall`, `start`, `stop`, `restart`, `status`) |
| `jeeves-watcher scan` | Scan the vector store with filter-only queries |
| `jeeves-watcher config [jsonpath]` | Query the effective config via JSONPath |
| `jeeves-watcher issues` | Show indexing issues and errors |
| `jeeves-watcher helpers` | Show loaded map and template helpers |
| `jeeves-watcher config apply [-f <file>] [--replace]` | Merge a config patch (file or stdin) into the running service's config, validate, write and reload |

The API commands (`search`, `enrich`, `scan`, `reindex`, `rebuild-metadata`, `issues`, `helpers`, `config`, `config apply`) accept `--api-key` (default: the `JEEVES_WATCHER_API_KEY` environment variable); their HTTP errors print `HTTP <status> <code>: <message>` (a `401` prints key guidance instead). See the [CLI Reference](packages/service/guides/cli-reference.md).

## Configuration

### Environment Variable Substitution

Config strings support `${VAR_NAME}` syntax for environment variable injection:

```json
{
  "embedding": {
    "apiKey": "${GOOGLE_API_KEY}"
  }
}
```

If `GOOGLE_API_KEY` is set in the environment, the value is substituted at config load time. Set templates in inference rules use Handlebars `{{...}}` syntax (e.g. `{{frontmatter.title}}`), which is distinct from the `${...}` environment variable syntax used in config values like `embedding.apiKey`.

### Watch Paths

```json
{
  "watch": {
    "paths": ["./docs", "./notes"],
    "ignored": ["**/node_modules/**", "**/*.tmp"]
  }
}
```

- **`paths`**: Array of glob patterns or directories to watch
- **`ignored`**: Array of patterns to exclude
- **`respectGitignore`**: (default: `true`) Skip processing files ignored by `.gitignore` in git repositories. Nested `.gitignore` files are respected within their subtree.
- **`moveDetection`**: (optional) Correlate unlink+add events as file moves to avoid re-embedding. `enabled` (default: `true`), `bufferMs` (default: `2000`) — how long to buffer unlink events before treating as deletes.

### Embedding Provider

#### Google Gemini

```json
{
  "embedding": {
    "provider": "gemini",
    "model": "gemini-embedding-001",
    "apiKey": "${GOOGLE_API_KEY}"
  }
}
```

### Vector Store

```json
{
  "vectorStore": {
    "url": "http://localhost:6333",
    "collectionName": "my_collection"
  }
}
```

### Inference Rules

Automatically enrich metadata based on file patterns using declarative JSON Schemas:

```json
{
  "schemas": {
    "base": {
      "type": "object",
      "properties": {
        "domain": {
          "type": "string",
          "description": "Content domain"
        }
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
            "type": "object",
            "properties": {
              "path": { "type": "string", "glob": "**/meetings/**" }
            }
          }
        }
      },
      "schema": [
        "base",
        {
          "properties": {
            "domain": { "set": "meetings" },
            "category": { "type": "string", "set": "notes" }
          }
        }
      ]
    }
  ]
}
```

Inference rules use `schema` arrays that reference global named schemas. Type coercion automatically converts string interpolation results to declared types (integer, number, boolean, array, object). See [Inference Rules Guide](packages/service/guides/inference-rules.md) for details.

### Chunking

Chunking settings are configured under `embedding`:

```json
{
  "embedding": {
    "chunkSize": 1000,
    "chunkOverlap": 200
  }
}
```

### Enrichment Store

Enrichment metadata (from `POST /metadata` or `watcher_enrich`) is stored in a SQLite database at `<stateDir>/enrichments.sqlite`, using Node's built-in `node:sqlite` module (no native addon). Enrichments survive full reindexes. Composable merge: scalar fields overwrite, array fields union+deduplicate with inference rule output.

```json
{
  "stateDir": ".jeeves-metadata"
}
```

## API Endpoints

The watcher provides a REST API (default port: 1936):

| Endpoint | Method | Description |
| --- | --- | --- |
| `/status` | GET | Health check, uptime, collection (name, point count, dimensions), reindex and initial-scan state |
| `/search` | POST | Semantic search (`{ query: string, limit?: number, offset?: number, filter?: object }`; unknown keys are rejected) |
| `/render` | POST | Render a document through inference rules (`{ path }` or `{ source }`) (v0.8.0+) |
| `/search/facets` | GET | Schema-derived search facet definitions with live values (v0.8.0+) |
| `/metadata` | POST | Update document metadata with schema validation (`{ path \| source, metadata: object }`) |
| `/documents` | POST | Notify changed source documents (`{ documents: [{ source, rule }] }`); `202`, or per-document results with `?wait=true` (v0.20.0+) |
| `/documents/delete` | POST | Delete source documents (`{ sources }` (at most 1000) or `{ filter }`; never deletes file points) (v0.20.0+) |
| `/reindex` | POST | Scoped reindex with blast area plan (`issues`, `rules`, `full`, `path`, `prune` + `dryRun`). `path` accepts `string \| string[]`; scope `path` also accepts `source` references. |
| `/rebuild-metadata` | POST | Rebuild the enrichment store from Qdrant payloads (file points only; system fields are not copied) |
| `/config` | GET | Merged config document (public keys only: never `api`, `sources`, `embedding` or `vectorStore`) with rule values, helpers and issues; optional `?path=<jsonpath>` filter. Rules include `source` attribution. |
| `/config/schema` | GET | JSON Schema of merged virtual document (v0.5.0+) |
| `/walk` | POST | Filesystem walk with glob intersection (`{ globs: string[] }`). Returns `{ paths, matchedCount, scannedRoots }`. |
| `/config/match` | POST | Test paths against inference rules (`{ paths: string[] }`) (v0.5.0+) |
| `/issues` | GET | Current embedding failures and processing errors (v0.5.0+) |
| `/rules/register` | POST | Register virtual inference rules from an external source |
| `/rules/unregister` | DELETE | Remove all virtual rules from a source (`{ source }`) |
| `/rules/unregister/:source` | DELETE | Remove all virtual rules from a named source |
| `/scan` | POST | Filter-only point query with cursor pagination (`{ filter, limit?, cursor?, fields?, countOnly? }`) |
| `/config/validate` | POST | Validate a configuration without applying (`{ config?, testPaths? }`) |
| `/config/apply` | POST | Merge a patch, validate, write, and reload configuration (`{ patch, replace? }`; `config` is an alias of `patch`). The echoed config is redacted like `GET /config`. |
| `/rules/reapply` | POST | Re-apply inference rules to files matching globs (`{ globs }`) |
| `/points/delete` | POST | Delete points matching a Qdrant filter (`{ filter }`) |
| `/vcs/*` | GET/POST | Version control: `status`, `history`, `show`, `diff`, `check-exclusion`, `revert`, `exclude` (see the [Version Control guide](packages/service/guides/version-control.md)) |

Errors carry `{ error, code, message?, details? }`; the HTTP status follows from `code`, with one exception: a `prune` reindex without a vector store answers `400 not_available` (see [Error Handling](packages/service/guides/api-reference.md#error-handling)).

### Example: Search

```bash
curl -X POST http://localhost:1936/search \
  -H "Content-Type: application/json" \
  -d '{"query": "machine learning algorithms", "limit": 5}'
```

### Example: Search With Filter

```bash
curl -X POST http://localhost:1936/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "error handling",
    "limit": 10,
    "filter": {
      "must": [{ "key": "domain", "match": { "value": "backend" } }]
    }
  }'
```

### Example: Update Metadata

```bash
curl -X POST http://localhost:1936/metadata \
  -H "Content-Type: application/json" \
  -d '{
    "path": "/path/to/document.md",
    "metadata": {
      "priority": "high",
      "category": "research"
    }
  }'
```

## OpenClaw Plugin

This repo includes an OpenClaw plugin (`packages/openclaw`) that exposes the jeeves-watcher API as native agent tools:

| Tool | Description |
| --- | --- |
| `watcher_status` | Service health, version and uptime |
| `watcher_service` | Manage the system service (install, uninstall, start, stop, restart, status) |
| `watcher_search` | Semantic search across indexed documents |
| `watcher_enrich` | Set or update document metadata |
| `watcher_config` | Query the effective runtime config via JSONPath |
| `watcher_walk` | List watched files matching globs |
| `watcher_validate` | Validate a candidate config, optionally testing file paths |
| `watcher_config_apply` | Apply a config patch (response config redacted) |
| `watcher_reindex` | Trigger a scoped reindex with blast area plan |
| `watcher_scan` | Filter-only point query with cursor pagination |
| `watcher_issues` | List processing issues (file paths and source references) |
| `watcher_vcs_status` | Version tracking state for every root |
| `watcher_vcs_history` | Change history by path or glob, optional date range |
| `watcher_vcs_show` | File content at a specific version |
| `watcher_vcs_diff` | Changes between two versions, or a version and current |
| `watcher_vcs_revert` | Restore files from a historical version |
| `watcher_vcs_exclude` | Exclude or re-include paths from version tracking |
| `watcher_vcs_check` | Whether a path is excluded from version tracking, and why |

The plugin is a standard OpenClaw plugin on [`@karmaniverous/jeeves`](https://www.npmjs.com/package/@karmaniverous/jeeves) 0.6 core, installed by `jeeves install`. It writes no workspace files; its always-in-context watcher rules are injected via the `before_prompt_build` hook. See the [OpenClaw Integration Guide](packages/openclaw/guides/openclaw-integration.md) for details.

Plugin configuration supports `apiUrl` (defaults to `http://127.0.0.1:1936`), an optional `apiKey` (sent as a bearer token when the service sets `api.apiKey`; env fallback `JEEVES_WATCHER_API_KEY`) and `configRoot` (no default: set it in plugin config or via `JEEVES_CONFIG_ROOT`; resolved lazily, so the plugin registers before it is set).

## Supported File Formats

- **Markdown** (`.md`, `.markdown`) — with YAML frontmatter support
- **PDF** (`.pdf`) — text extraction
- **DOCX** (`.docx`) — Microsoft Word documents
- **HTML** (`.html`, `.htm`) — content extraction (scripts/styles removed)
- **JSON** (`.json`) — with smart text field detection
- **Plain Text** (`.txt`, `.text`)

Any other extension is read as plain text.

## License

BSD-3-Clause

---

Built for you with ❤️ on Bali by [Jason Williscroft](https://github.com/karmaniverous) & [Jeeves](https://github.com/jgs-jeeves).
