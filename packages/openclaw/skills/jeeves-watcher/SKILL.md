---
name: jeeves-watcher
description: >
  Semantic search across a structured document archive. Use when you need to
  recall prior context, find documents, answer questions that require searching
  across domains (email, Slack, Jira, codebase, meetings, projects), enrich
  document metadata, manage watcher config, or diagnose indexing issues.
  Also use when bootstrapping the watcher service or configuring the plugin.
---

# jeeves-watcher — Bootstrap, Configuration & Operation

This skill covers everything needed to go from zero to a fully operational jeeves-watcher deployment: installing prerequisites, configuring the service, installing the OpenClaw plugin, and using it day-to-day.

---

## Part 1: Bootstrap — Installing the Watcher Service

### Prerequisites

| Component | Purpose | Install |
|-----------|---------|---------|
| **Node.js** ≥ 20 | Runtime for the watcher service | [nodejs.org](https://nodejs.org) |
| **Qdrant** | Vector database for embeddings | [qdrant.tech](https://qdrant.tech/documentation/guides/installation/) |
| **Google Cloud API key** | Gemini embedding API access | [Google AI Studio](https://aistudio.google.com/apikey) |

**Qdrant options:**
- **Docker (recommended):** `docker run -p 6333:6333 -v qdrant_storage:/qdrant/storage qdrant/qdrant`
- **Binary:** Download from [qdrant.tech/documentation/guides/installation/](https://qdrant.tech/documentation/guides/installation/)
- **Windows service:** Install via NSSM (see Service Management below)

Verify Qdrant is running: `curl http://localhost:6333/healthz` should return `ok`.

### Install the Watcher

```bash
npm install -g @karmaniverous/jeeves-watcher
```

Verify: `jeeves-watcher --version`

### Create a Config File

The watcher needs a JSON config file. Create one at a stable location (e.g., `~/jeeves-watcher.config.json` or a dedicated config directory).

**Minimal starter config:**

```json
{
  "description": "My document archive",
  "watch": {
    "paths": [
      "/path/to/documents/**/*.{md,txt,json}"
    ],
    "ignored": [
      "**/node_modules/**",
      "**/.git/**"
    ],
    "debounceMs": 2000,
    "stabilityThresholdMs": 500
  },
  "embedding": {
    "provider": "gemini",
    "model": "gemini-embedding-001",
    "dimensions": 3072,
    "apiKey": "${GOOGLE_API_KEY}",
    "chunkSize": 1000,
    "chunkOverlap": 200,
    "rateLimitPerMinute": 1000,
    "concurrency": 5
  },
  "vectorStore": {
    "url": "http://localhost:6333",
    "collectionName": "my_archive"
  },
  "api": {
    "port": 3458
  },
  "logging": {
    "level": "info"
  }
}
```

**Environment variables:** The `${GOOGLE_API_KEY}` syntax is substituted at runtime. Set the env var before starting the service, or replace with a literal key.

### Config Schema Reference

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `description` | string | No | Organizational strategy description (surfaced in search orientation) |
| `watch` | object | **Yes** | Filesystem watch config |
| `watch.paths` | string[] | **Yes** | Glob patterns for directories/files to watch |
| `watch.ignored` | string[] | No | Glob patterns to exclude |
| `watch.debounceMs` | number | No | Debounce interval (default: 2000) |
| `watch.stabilityThresholdMs` | number | No | File stability threshold (default: 500) |
| `embedding` | object | **Yes** | Embedding provider config |
| `embedding.provider` | string | **Yes** | `"gemini"` |
| `embedding.model` | string | **Yes** | `"gemini-embedding-001"` |
| `embedding.dimensions` | number | **Yes** | `3072` (supports Matryoshka truncation to 1536/768) |
| `embedding.apiKey` | string | **Yes** | Google API key (supports `${ENV_VAR}` syntax) |
| `embedding.chunkSize` | number | No | Tokens per chunk (default: 1000) |
| `embedding.chunkOverlap` | number | No | Overlap between chunks (default: 200) |
| `embedding.rateLimitPerMinute` | number | No | API rate limit (default: 1000) |
| `embedding.concurrency` | number | No | Parallel embedding calls (default: 5) |
| `vectorStore` | object | **Yes** | Qdrant connection config |
| `vectorStore.url` | string | **Yes** | Qdrant URL (e.g., `http://localhost:6333`) |
| `vectorStore.collectionName` | string | **Yes** | Qdrant collection name |
| `vectorStore.apiKey` | string | No | Qdrant API key (if using Qdrant Cloud) |
| `api` | object | No | API server config |
| `api.host` | string | No | Bind address (default: `127.0.0.1`) |
| `api.port` | number | No | HTTP port (default: 3458) |
| `logging` | object | No | Logging config |
| `logging.level` | string | No | `"debug"`, `"info"`, `"warn"`, `"error"` (default: `"info"`) |
| `logging.file` | string | No | File path for pino file transport |
| `logging.pretty` | boolean | No | Pretty-print logs (default: false, use for dev) |
| `configWatch` | object | No | Auto-reload on config file changes |
| `configWatch.enabled` | boolean | No | Enable config watching (default: false) |
| `configWatch.debounceMs` | number | No | Debounce for config changes (default: 10000) |
| `configWatch.reindex` | string | No | `"issues"` or `"full"` — what to reindex on config change |
| `schemas` | object | No | Named schema definitions (reusable across rules) |
| `inferenceRules` | array | No | Inference rule definitions (inline objects or file paths) |
| `maps` | object | No | Named JsonMap transforms |
| `templates` | object | No | Named Handlebars templates |
| `mapHelpers` | object | No | Custom JsonMap library functions |
| `templateHelpers` | object | No | Custom Handlebars helpers |
| `metadataDir` | string | No | Directory for `.meta.json` sidecars |
| `stateDir` | string | No | Directory for issues.json + values.json |
| `search` | object | No | Search config |
| `search.scoreThresholds` | object | No | `{ strong, relevant, noise }` — score interpretation boundaries |
| `search.hybrid` | object | No | `{ enabled: true }` — enable BM25 + vector fusion |
| `reindex` | object | No | Reindex config (callbackUrl) |
| `shutdownTimeoutMs` | number | No | Graceful shutdown timeout (default: 30000) |

### Inference Rules

Rules tell the watcher how to classify and extract metadata from files. Without rules, files are still indexed and searchable — they just won't have structured metadata.

**Inline rule example:**
```json
{
  "inferenceRules": [
    {
      "name": "project-docs",
      "description": "Project documentation files",
      "match": {
        "type": "object",
        "properties": {
          "file": {
            "type": "object",
            "properties": {
              "path": { "type": "string", "glob": "/projects/**/*.md" }
            }
          }
        }
      },
      "schema": [
        {
          "type": "object",
          "properties": {
            "domain": { "type": "string", "set": "projects" }
          }
        }
      ]
    }
  ]
}
```

**File reference rules:** For cleaner configs, rules can be file paths resolved relative to the config file's directory:
```json
{
  "inferenceRules": [
    "rules/email-archive.json",
    "rules/slack-message.json"
  ]
}
```

**Key concepts:**
- `match` uses JSON Schema with a custom `glob` keyword for picomatch path matching
- `schema` is an array of schema objects (composed in order) using `set` for value derivation
- `set` supports Handlebars interpolation: `"set": "{{file.dir}}"` extracts from the file context
- Multiple rules can match the same file — **last-match-wins** for conflicting fields
- All matched rule names are recorded in `payload.matched_rules`

### Start the Service

**Development / testing:**
```bash
GOOGLE_API_KEY=your-key jeeves-watcher start -c /path/to/config.json
```

**First run:** The watcher creates the Qdrant collection (if missing), builds a BM25 text index (if hybrid search enabled), and begins watching. Initial indexing of existing files happens immediately.

### Service Management

**Windows (NSSM):**
```bash
# Install as Windows service
jeeves-watcher service install -c /path/to/config.json

# Manage
nssm start jeeves-watcher
nssm stop jeeves-watcher
nssm restart jeeves-watcher
nssm status jeeves-watcher
```

Set `GOOGLE_API_KEY` as a system environment variable, or use NSSM's `AppEnvironmentExtra` to inject it.

NSSM redirects stdout/stderr to log files. Configure with:
```bash
nssm set jeeves-watcher AppStdout /path/to/watcher-stdout.log
nssm set jeeves-watcher AppStderr /path/to/watcher-stderr.log
```

**Linux (systemd):**
```ini
[Unit]
Description=jeeves-watcher
After=network.target

[Service]
Type=simple
Environment=GOOGLE_API_KEY=your-key
ExecStart=/usr/local/bin/jeeves-watcher start -c /path/to/config.json
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable jeeves-watcher
sudo systemctl start jeeves-watcher
```

### Verify the Service

```bash
curl http://127.0.0.1:3458/status
```

Should return:
```json
{
  "status": "ok",
  "uptime": 42.5,
  "collection": {
    "name": "my_archive",
    "pointCount": 1234,
    "dimensions": 3072
  }
}
```

---

## Part 2: Installing & Configuring the Plugin

### Install the Plugin

```bash
npx @karmaniverous/jeeves-watcher-openclaw install
```

This:
1. Copies the plugin to `~/.openclaw/extensions/jeeves-watcher-openclaw/`
2. Patches `openclaw.json`:
   - Adds `jeeves-watcher-openclaw` to `plugins.entries` (enabled)
   - Sets `plugins.slots.memory` to `jeeves-watcher-openclaw` (claims memory slot)
   - Adds to allowlists if they exist

**Then restart the OpenClaw gateway** to load the plugin.

**Uninstall:** `npx @karmaniverous/jeeves-watcher-openclaw uninstall` (then restart gateway)

**Note:** `openclaw plugins update` does NOT work for this plugin — use the CLI installer for updates too.

### Plugin Config

Plugin configuration lives in `openclaw.json` under `plugins.entries.jeeves-watcher-openclaw.config`:

```json
{
  "plugins": {
    "entries": {
      "jeeves-watcher-openclaw": {
        "enabled": true,
        "config": {
          "apiUrl": "http://127.0.0.1:3458"
        }
      }
    }
  }
}
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `apiUrl` | string | `http://127.0.0.1:3458` | Watcher API URL. **Must match** the watcher's `api.port`. |
| `schemas` | object | (none) | Optional schema bridging (see below) |

**If the watcher runs on a non-default port**, you must set `apiUrl` to match. The plugin cannot auto-discover the port.

### Memory Slot Architecture

The plugin declares `kind: "memory"` in its manifest. When installed:
- OpenClaw auto-disables the built-in `memory-core` plugin
- `memory_search` and `memory_get` are now powered by the watcher's vector store
- The agent's existing memory behavior works unchanged — same tool names, same parameters

**How it works internally:**
1. On first `memory_search` call, the plugin registers **virtual inference rules** with the watcher
2. Virtual rules set **private namespaced properties** on workspace memory files: `_jeeves_watcher_openclaw_source_` and `_jeeves_watcher_openclaw_kind_`
3. `memory_search` filters on these private properties — completely decoupled from the watcher's config vocabulary
4. Private properties have no `uiHint`, so they're invisible to external UIs

**Virtual rules are transient:** They survive config reloads but not watcher restarts. The plugin re-registers automatically on the next `memory_search` call after a restart.

### Schema Bridging (Optional)

By default, memory points are private to the plugin. If you want memory files to also appear in the watcher's broader search UI (e.g., jeeves-server) with standard metadata like `domains` or `kind`, add a `schemas` key to the plugin config:

```json
{
  "plugins": {
    "entries": {
      "jeeves-watcher-openclaw": {
        "enabled": true,
        "config": {
          "apiUrl": "http://127.0.0.1:3459",
          "schemas": {
            "openclaw-memory-longterm": {
              "type": "object",
              "properties": {
                "domains": {
                  "type": "array",
                  "items": { "type": "string" },
                  "set": ["memory"]
                }
              }
            },
            "openclaw-memory-daily": [
              {
                "type": "object",
                "properties": {
                  "domains": {
                    "type": "array",
                    "items": { "type": "string" },
                    "set": ["memory"]
                  }
                }
              },
              {
                "type": "object",
                "properties": {
                  "kind": { "type": "string", "set": "daily-log" }
                }
              }
            ]
          }
        }
      }
    }
  }
}
```

**`schemas`** maps virtual rule names to additional schemas appended after the plugin's internal schema:
- `openclaw-memory-longterm` — matches `{workspace}/MEMORY.md`
- `openclaw-memory-daily` — matches `{workspace}/memory/**/*.md`

Schema values follow standard watcher conventions:
- Inline JSON Schema object
- File reference string (resolved relative to watcher config directory)
- Named schema reference (from watcher config's `schemas` section)
- Array of the above (composed in order)

---

## Part 3: Operation

### Service Architecture

The watcher is an HTTP API. Default port: 3458.

**Health check:** `GET /status` — returns uptime, point count, dimensions, reindex status.

**Key endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/status` | GET | Health check + collection stats |
| `/search` | POST | Semantic search |
| `/config/query` | POST | JSONPath query over merged virtual document |
| `/config/validate` | POST | Validate candidate config |
| `/config/apply` | POST | Apply config changes |
| `/config-reindex` | POST | Trigger reindex |
| `/metadata` | POST | Enrich document metadata |
| `/issues` | GET | Runtime embedding failures |
| `/rules/register` | POST | Register virtual inference rules |
| `/rules/unregister` | DELETE | Remove virtual rules by source |
| `/rules/reapply` | POST | Re-derive metadata for files matching globs |
| `/points/delete` | POST | Delete points matching a Qdrant filter |

**Direct API access:** When plugin tools aren't available (different session, plugin not loaded), hit the API directly:
```bash
curl http://127.0.0.1:3458/status
curl -X POST http://127.0.0.1:3458/search -H "Content-Type: application/json" -d '{"query": "search text"}'
```

### Tools

#### `memory_search`
Semantically search MEMORY.md and memory/*.md files. Powered by the watcher's vector store with Gemini 3072-dim embeddings.
- `query` (string, required) — search query text
- `maxResults` (number, optional) — maximum results to return
- `minScore` (number, optional) — minimum similarity score threshold

Returns: `[{ path, from, to, snippet, score }]` where `from`/`to` are 1-indexed line numbers.

#### `memory_get`
Read content from MEMORY.md or memory/*.md files with optional line range.
- `path` (string, required) — path to the memory file
- `from` (number, optional) — line number to start reading from (1-indexed)
- `lines` (number, optional) — number of lines to read

Path validation: only files within the workspace's MEMORY.md and memory/**/*.md are accessible.

#### `watcher_search`
Semantic search over all indexed documents.
- `query` (string, required) — natural language search query
- `limit` (number, optional) — max results (default: 10)
- `offset` (number, optional) — skip N results for pagination
- `filter` (object, optional) — Qdrant filter for metadata filtering

#### `watcher_enrich`
Set or update metadata on a document.
- `path` (string, required) — file path of the document
- `metadata` (object, required) — key-value metadata to merge

Metadata is validated against the file's matched rule schemas.

#### `watcher_status`
Service health check. Returns uptime, collection stats, reindex status.

#### `watcher_query`
Query the merged virtual document via JSONPath.
- `path` (string, required) — JSONPath expression
- `resolve` (string[], optional) — `["files"]`, `["globals"]`, or `["files","globals"]`

#### `watcher_validate`
Validate config and optionally test file paths.
- `config` (object, optional) — candidate config (partial or full). Omit to validate current config.
- `testPaths` (string[], optional) — file paths to test against config

#### `watcher_config_apply`
Apply config changes atomically.
- `config` (object, required) — full or partial config to apply

Validates, writes to disk, triggers configured reindex behavior.

#### `watcher_reindex`
Trigger a reindex.
- `scope` (string, optional) — `"rules"` (default) or `"full"`

Rules scope re-applies inference rules without re-embedding. Full scope re-processes all files.

#### `watcher_issues`
Get runtime embedding failures. Returns `{ filePath: IssueRecord }`.

### Orientation Pattern (Once Per Session)

Query the deployment's organizational context on first use:

**1. Top-level context:**
```
watcher_query: path="$.['description','search']"
```

**2. Available record types:**
```
watcher_query: path="$.inferenceRules[*].['name','description']"
```

### Qdrant Filter Syntax

Filters use Qdrant's native JSON format in the `filter` parameter of `watcher_search`.

**Match exact value:**
```json
{ "must": [{ "key": "domain", "match": { "value": "email" } }] }
```

**Full-text match:**
```json
{ "must": [{ "key": "chunk_text", "match": { "text": "authentication" } }] }
```

**Combine (AND):**
```json
{ "must": [
  { "key": "domain", "match": { "value": "jira" } },
  { "key": "status", "match": { "value": "In Progress" } }
]}
```

**Exclude (NOT):**
```json
{ "must_not": [{ "key": "domain", "match": { "value": "repos" } }] }
```

**Any of (OR):**
```json
{ "should": [
  { "key": "domain", "match": { "value": "email" } },
  { "key": "domain", "match": { "value": "slack" } }
]}
```

### uiHint → Filter Mapping

| `uiHint` | Qdrant filter | Notes |
|----------|--------------|-------|
| `text` | `match: { text: "<value>" }` | Substring/keyword match |
| `select` | `match: { value: "<value>" }` | Exact match; use `enum` or runtime values |
| `multiselect` | `match: { value: "<value>" }` | Any-element match on array field |
| `date` | `range: { gte: <unix_ts>, lt: <unix_ts> }` | Either bound optional |
| `number` | `range: { gte: <n>, lte: <n> }` | Either bound optional |
| `check` | `match: { value: true }` | Boolean |
| *(absent)* | Do not filter | Internal field, not for search |

### Search Result Shape

| Field | Description |
|-------|-------------|
| `payload.file_path` | Source file path |
| `payload.chunk_text` | Matched text chunk |
| `payload.chunk_index` / `total_chunks` | Position within document |
| `payload.content_hash` | SHA-256 of full document |
| `payload.matched_rules` | Rule names that produced metadata |
| `payload.line_start` / `line_end` | 1-indexed line numbers (when available) |

Additional fields depend on the deployment's inference rules. Use `watcher_query` to discover them.

### Query Planning

1. Orient (once per session) — discover rules and score thresholds
2. Identify relevant rule(s) for your query
3. Retrieve schema: `watcher_query: path="$.inferenceRules[?(@.name=='rule-name')].schema" resolve=["files","globals"]`
4. For fields without `enum`, check runtime values: `watcher_query: path="$.inferenceRules[?(@.name=='rule-name')].values.fieldName"`
5. Construct filter using uiHint mapping
6. Search with query + filter

### Config Authoring

**Workflow:**
1. Build config (partial or full)
2. Validate: `watcher_validate` with optional `testPaths`
3. Apply: `watcher_config_apply` — validates, writes, triggers reindex
4. Monitor: `watcher_issues` for failures

**When to reindex:**
- **Rules scope:** Changed matching patterns, set expressions, schema mappings (no re-embedding)
- **Full scope:** Changed embedding config, added watch paths, broad restructuring (re-embeds everything)

**Config gotchas:**
- `set` not `attributes` for metadata derivation
- Maps must be **bare string** file paths, not `{path, description}` objects
- `mapHelpers` and `templateHelpers` use `{path, description}` objects (this is correct)
- Match paths use `properties.file.properties.path` with `glob`

---

## Part 4: Troubleshooting

### Service Unreachable

1. Check service status: `nssm status jeeves-watcher` (Windows) or `systemctl status jeeves-watcher` (Linux)
2. Verify port: check `api.port` in watcher config matches `apiUrl` in plugin config
3. Check logs for startup errors
4. Verify Qdrant is running: `curl http://localhost:6333/healthz`

### memory_search Returns No Results

1. Check watcher is reachable: `watcher_status`
2. Virtual rules may not be registered yet — run any `memory_search` query to trigger lazy init
3. Check if workspace files are in a watched path (`watch.paths` in watcher config)
4. Check if files are ignored (`watch.ignored`)
5. After watcher restart, virtual rules are lost — next `memory_search` re-registers them automatically, but files need reapply (also automatic)

### Stale or Missing Metadata

After changing inference rules or virtual rule schemas:
- **Rules reindex:** `watcher_reindex: scope="rules"` — re-applies rules without re-embedding
- **Full reindex:** `watcher_reindex: scope="full"` — re-processes everything (slow, re-embeds)

### Embedding Failures

- `watcher_issues` shows files that failed and why
- Common: rate limiting (reduce `embedding.concurrency`), API key invalid, file encoding issues
- Issues are self-healing: resolved on successful re-process

### ECONNRESET on Qdrant Writes

Root cause: Gemini embedding latency (avg 2.4s, p99 ~8s) causes Qdrant client's pooled TCP connections to go stale. The watcher creates fresh connections per write operation to avoid this. If you see ECONNRESET errors, ensure you're on watcher v0.6.5+ which includes the connection resilience fix.

### Virtual Rules Not Taking Effect

1. Virtual rules are in-memory only — lost on watcher restart
2. Plugin re-registers on next `memory_search` call
3. After registration, the plugin calls `/rules/reapply` to update already-indexed files
4. If files still lack metadata, trigger a manual reapply or rules reindex

### CLI Fallbacks

When the API is down:
```bash
jeeves-watcher status                     # Check if service is running
jeeves-watcher validate -c config.json    # Validate config from CLI
nssm restart jeeves-watcher               # Restart (Windows)
```

---

## References

- [Qdrant filtering docs](https://qdrant.tech/documentation/concepts/filtering/)
- [JSONPath Plus syntax](https://www.npmjs.com/package/jsonpath-plus)
- [Gemini embedding API](https://ai.google.dev/gemini-api/docs/embeddings)
