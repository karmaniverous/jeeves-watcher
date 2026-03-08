# @karmaniverous/jeeves-watcher

Filesystem watcher that keeps a Qdrant vector store in sync with document changes.

## Overview

`jeeves-watcher` monitors a configured set of directories for file changes, extracts text content, generates embeddings, and maintains a synchronized Qdrant vector store for semantic search. It automatically:

- **Watches** directories for file additions, modifications, and deletions
- **Extracts** text from various formats (Markdown, PDF, DOCX, HTML, JSON, plain text)
- **Chunks** large documents for optimal embedding
- **Embeds** content using configurable providers (Google Gemini, mock for testing)
- **Syncs** to Qdrant for fast semantic search
- **Enriches** metadata via rules and API endpoints

### Architecture

![System Architecture](packages/service/assets/system-architecture.png)

For detailed architecture documentation, see [packages/service/guides/architecture.md](packages/service/guides/architecture.md).

## Quick Start

### Installation

```bash
npm install -g @karmaniverous/jeeves-watcher
```

### Initialize Configuration

Create a new configuration file in your project:

```bash
jeeves-watcher init
```

This generates a `jeeves-watcher.config.json` file with sensible defaults.

### Configure

Edit `jeeves-watcher.config.json` to specify:

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
jeeves-watcher start
```

The watcher will:

1. Index all existing files in watched directories
2. Monitor for changes
3. Update Qdrant automatically

## CLI Commands

| Command | Description |
| --- | --- |
| `jeeves-watcher start` | Start the filesystem watcher (foreground) |
| `jeeves-watcher init` | Initialize a new configuration file |
| `jeeves-watcher status` | Show watcher status |
| `jeeves-watcher reindex` | Reindex all watched files |
| `jeeves-watcher rebuild-metadata` | Rebuild metadata files from Qdrant payloads |
| `jeeves-watcher search <query>` | Search the vector store |
| `jeeves-watcher enrich <path>` | Enrich document metadata with key-value pairs |
| `jeeves-watcher validate` | Validate the configuration |
| `jeeves-watcher service` | Manage the watcher as a system service |
| `jeeves-watcher scan` | Scan the vector store with filter-only queries |
| `jeeves-watcher query` | Query merged config document via JSONPath |
| `jeeves-watcher issues` | Show indexing issues and errors |
| `jeeves-watcher helpers` | Show loaded map and template helpers |
| `jeeves-watcher config-apply` | Validate, write, and reload configuration from file |
| `jeeves-watcher config-reindex` | Reindex after configuration changes (rules only or full) |

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

**New in v0.5.0:** Inference rules now use `schema` arrays that reference global named schemas. Type coercion automatically converts string interpolation results to declared types (integer, number, boolean, array, object). See [Inference Rules Guide](packages/service/guides/inference-rules.md) for details.

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

### Metadata Storage

```json
{
  "metadataDir": ".jeeves-watcher"
}
```

Metadata is stored as JSON files alongside watched documents.

## API Endpoints

The watcher provides a REST API (default port: 1936):

| Endpoint | Method | Description |
| --- | --- | --- |
| `/status` | GET | Health check, uptime, and collection stats |
| `/search` | POST | Semantic search (`{ query: string, limit?: number, filter?: object }`) |
| `/render` | POST | Render a file through inference rules (`{ path: string }`) (v0.8.0+) |
| `/search/facets` | GET | Schema-derived search facet definitions with live values (v0.8.0+) |
| `/metadata` | POST | Update document metadata with schema validation (`{ path: string, metadata: object }`) |
| `/reindex` | POST | Reindex all watched files |
| `/rebuild-metadata` | POST | Rebuild metadata files from Qdrant |
| `/config-reindex` | POST | Reindex after config changes (`{ scope?: "rules" \| "full" }`) |
| `/config/schema` | GET | JSON Schema of merged virtual document (v0.5.0+) |
| `/config/query` | POST | JSONPath query over config (`{ path: string, resolve?: string[] }`) (v0.5.0+) |
| `/config/match` | POST | Test paths against inference rules (`{ paths: string[] }`) (v0.5.0+) |
| `/issues` | GET | Current embedding failures and processing errors (v0.5.0+) |
| `/rules/register` | POST | Register virtual inference rules from an external source |
| `/rules/unregister` | DELETE | Remove all virtual rules from a source (`{ source }`) |
| `/rules/unregister/:source` | DELETE | Remove all virtual rules from a named source |
| `/scan` | POST | Filter-only point query with cursor pagination (`{ filter, limit?, cursor?, fields?, countOnly? }`) |
| `/config/validate` | POST | Validate a configuration without applying (`{ config?, testPaths? }`) |
| `/config/apply` | POST | Validate, write, and reload configuration (`{ config }`) |
| `/rules/reapply` | POST | Re-apply inference rules to files matching globs (`{ globs }`) |
| `/points/delete` | POST | Delete points matching a Qdrant filter (`{ filter }`) |

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

| Tool                   | Description                                    |
| ---------------------- | ---------------------------------------------- |
| `watcher_status`       | Service health, uptime, and collection stats   |
| `watcher_search`       | Semantic search across indexed documents       |
| `watcher_enrich`       | Set or update document metadata                |
| `watcher_query`        | Query the merged virtual document via JSONPath |
| `watcher_validate`     | Validate a watcher configuration               |
| `watcher_config_apply` | Apply a new configuration                      |
| `watcher_reindex`      | Trigger a reindex                              |
| `watcher_scan`         | Filter-only point query with cursor pagination |
| `watcher_issues`       | List indexing issues and errors                |

The plugin also writes a dynamic `## Watcher` section to `TOOLS.md` on disk, providing agents with a live menu of indexed content and escalation rules. See the [OpenClaw Integration Guide](packages/openclaw/guides/openclaw-integration.md) for details.

Plugin configuration supports `apiUrl` (defaults to `http://127.0.0.1:1936`).

## Supported File Formats

- **Markdown** (`.md`, `.markdown`) — with YAML frontmatter support
- **PDF** (`.pdf`) — text extraction
- **DOCX** (`.docx`) — Microsoft Word documents
- **HTML** (`.html`, `.htm`) — content extraction (scripts/styles removed)
- **JSON** (`.json`) — with smart text field detection
- **Plain Text** (`.txt`, `.text`)

## License

BSD-3-Clause
