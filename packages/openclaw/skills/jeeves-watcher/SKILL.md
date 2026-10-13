---
name: jeeves-watcher
description: >
  Semantic search across a structured document archive. Use when you need to recall prior context, find documents, answer questions that require searching across indexed domains, enrich document metadata, manage watcher config, or diagnose indexing issues.
---

# jeeves-watcher — Search, Discovery & Administration

## Service Architecture

The watcher is an HTTP API running as a background service (typically NSSM on Windows, systemd on Linux).

**Default port:** 1936 (configurable via `api.port` in watcher config) **Non-default port:** If the watcher runs on a different port, the user must set `plugins.entries.jeeves-watcher-openclaw.config.apiUrl` in `openclaw.json`. The plugin cannot auto-discover a non-default port.

**API key:** If the watcher sets `api.apiKey`, every route except `GET /status` needs `Authorization: Bearer <key>`. The tools send it from `plugins.entries.jeeves-watcher-openclaw.config.apiKey` (or the `JEEVES_WATCHER_API_KEY` env var). A missing or wrong key comes back as `HTTP 401 unauthorized: the watcher API requires an API key. Provide it via plugins.entries.jeeves-watcher-openclaw.config.apiKey or the JEEVES_WATCHER_API_KEY env var.` (or, when a key was sent, `... rejected the API key. Check ... against the service's api.apiKey.`). When calling the API directly, add the header yourself. Never echo the key.

**Tool errors:** Tool error text is prefixed `Error: `. Any other non-2xx response reads `HTTP <status> <code>: <message>`, where `<code>` is the server's machine-readable error code (e.g. `HTTP 400 invalid_request: Validation failed`, `HTTP 503 scan_in_progress: Scan in progress: ...`). Branch on the code, not the message. Structured `details` (Zod issues, per-property validation failures) are in the HTTP response body only; call the API directly when you need them. An unreachable service reads `Service not reachable at <url>.` with a hint to set `apiUrl`. (`watcher_status` and `watcher_service` come from the shared Jeeves core toolset and word their own errors.)

**Health check:** `GET /status` returns `name`, `version`, `uptime`, `status` (`healthy`/`degraded`/`unhealthy`), and a `health` object containing `collection` (`name`, `pointCount`, `dimensions`), `reindex` progress, and `initialScan` progress.

**Mental model:** The `watcher_*` tools are thin HTTP wrappers. Each tool call translates to an HTTP request to the watcher API. When tools are available, use them. When they're not (e.g., different session, plugin not loaded), you can hit the API directly. Replace `<PORT>` below with the configured port (default 1936; check `plugins.entries.jeeves-watcher-openclaw.config.apiUrl` in `openclaw.json` if overridden), and add `-H "Authorization: Bearer <key>"` when the service sets `api.apiKey`:

```
# Health check
curl http://127.0.0.1:<PORT>/status

# Search
curl -X POST http://127.0.0.1:<PORT>/search \
  -H "Content-Type: application/json" \
  -d '{"query": "search text", "limit": 5}'

# Query config
curl http://127.0.0.1:<PORT>/config
```

**Key endpoints:**

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/status` | GET | Health check, uptime, collection stats |
| `/search` | POST | Semantic search (main query interface) |
| `/config` | GET | Public resolved config (allow-listed keys plus `issues`); optional `?path=<jsonpath>` filter |
| `/config/validate` | POST | Validate candidate config |
| `/config/apply` | POST | Apply config changes |
| `/reindex` | POST | Trigger reindex |
| `/metadata` | POST | Enrich document metadata (file path or source reference) |
| `/scan` | POST | Filter-only point query (no embeddings) |
| `/walk` | POST | Watched-file listing with glob intersection |
| `/issues` | GET | Runtime processing failures (file paths and source references) |
| `/documents` | POST | Notify changed source documents (`{ source, rule }`) |
| `/documents/delete` | POST | Delete source documents by reference or filter |
| `/rules/register` | POST | Register virtual inference rules (auto-triggers rules reindex) |
| `/rules/unregister` | DELETE | Remove virtual rules by source (`{ source }` body) |
| `/rules/unregister/:source` | DELETE | Remove virtual rules by source (parameterized) |
| `/rules/reapply` | POST | Re-apply rules to indexed files matching `globs` |
| `/points/delete` | POST | Delete points matching a Qdrant filter |
| `/render` | POST | Render a document (file path or source reference) through its rule |
| `/search/facets` | GET | Get search facet values |
| `/rebuild-metadata` | POST | Rebuild the enrichment store from Qdrant file point payloads |
| `/config/schema` | GET | Get config JSON schema |
| `/config/match` | POST | Test file paths against inference rules and watch scope |
| `/vcs/*` | GET/POST | Version tracking (`status`, `history`, `show`, `diff`, `check-exclusion`, `revert`, `exclude`) |

**If the watcher is unreachable:** Check the service status (`nssm status jeeves-watcher` on Windows), check the configured port in the watcher config file, and check logs for startup errors.

## Theory of Operation

You have access to a **semantic archive** of your human's working world. Documents, messages, tickets, notes, code, and other artifacts are indexed, chunked, embedded, and searchable. This is your long-term recall for anything beyond the current conversation.

**When to reach for the watcher:**

- **Someone asks about something that happened.** A meeting, a decision, a conversation, a ticket, a message. You weren't there, but the archive was. Search it.
- **You need context you don't have.** Before asking the human "what's the status of X?", search for X. The answer is probably already indexed.
- **You're working on something and need background.** Prior discussions, related records, relevant documents. Search by topic, filter by domain.
- **You need to verify something.** Don't guess from stale memory. Search for the current state.
- **You want to connect dots across domains.** The same topic might appear in multiple domains. A single semantic search surfaces all of them.

**When NOT to use it:**

- You already have the information in the current conversation
- The question is about general knowledge, not the human's specific context
- The watcher is unreachable (fall back to filesystem browsing)

**The principle:** Memory-core is your curated highlights. The watcher archive is your perfect recall. Use memory first for speed and signal, but never let its narrow scope be the ceiling of what you can remember.

## ⚠️ Embedding Cost — Hard Behavioral Gate

**The watcher embeds every file it sees.** Embedding is the most expensive operation in the pipeline — each file triggers a Gemini API call. The index may contain hundreds of thousands of points. Any action that causes the watcher to process a large number of files has real, potentially significant cost.

**STOP and ask for a human decision before:**

- **Renaming, moving, or reorganizing watched directories.** The watcher has **move detection** enabled by default (`watch.moveDetection.enabled: true`). When a file is moved, chokidar emits unlink + add events; the `MoveCorrelator` buffers the unlink, matches it with the add via content hash, and processes it as a zero-embedding move (point ID remap, metadata re-inference, enrichment migration). **No re-embedding cost for moves.** However, if a rename is blocked (e.g., by a file lock from the watcher or another service), **do NOT work around it by creating new directories and copying/moving files**. That creates duplicate embeddings at the new paths while the old paths still exist. Instead: stop the blocking service, perform the rename, restart.
- **Changing `watch.paths` to add large directory trees.** Adding a new watch root triggers initial indexing of every matching file under it.
- **Running `scope: "full"` reindex.** Every watched file is re-extracted (a file whose text to embed changed, or that was never indexed, is re-embedded) and every indexed source document is retrieved through its callback and always re-embedded. Use `scope: "rules"` for inference rule changes (no file re-embedding; only metadata reapplication).
- **Any bulk file operation** (mass copy, mass move, template-based file generation) under watched paths.

**The right instinct when blocked:** If a filesystem operation fails because a service has a lock, the correct response is to stop the service, do the operation, and restart — NOT to find a creative workaround. Creative workarounds in the presence of a live watcher are how you accidentally trigger re-embedding of tens of thousands of files.

**Cost context:** A single file embedding costs a Gemini API call. 1,000 unnecessary embeddings is a noticeable cost. 100,000 unnecessary embeddings (e.g., copying an entire domain directory to a new path) is a billing event worth flagging.

## Plugin Installation

The plugin is a standard OpenClaw plugin. On a Jeeves box, `jeeves install watcher --config-root <path>` installs it and writes its config; otherwise use `openclaw plugins install npm:@karmaniverous/jeeves-watcher-openclaw@<version> --pin --accept-capabilities` and set `plugins.entries.jeeves-watcher-openclaw.config` yourself. Restart the gateway to load it.

`configRoot` has no default. Only `watcher_service` with `action: "install"` needs it; other `watcher_service` actions and all HTTP API tools work without it. If `watcher_service install` returns "configRoot not configured", set `configRoot` in the plugin config or the `JEEVES_CONFIG_ROOT` env var.

## Quick Start (Existing Deployment)

If the watcher service is already running and healthy:

1. **Search** — use `watcher_search` with a natural language query and optional metadata filters
2. **Read source** — use `read` (standard file read) with `file_path` from search results for full document content. Source documents (points carrying `source`, such as `app://chat/thread/42`, and no `file_path`) are not files: their content comes from the source's callback (`POST /render` with `{ "source": "<ref>" }`).

## Bootstrap (First-Time Setup)

When the plugin loads and the watcher service is NOT yet set up, drive the entire setup proactively. The user should be able to install the plugin with nothing else in place and the bootstrap process gets them to a working system.

**The agent drives this process.** Don't hand the user CLI commands and wait. Check each prerequisite, explain what's needed, execute what you can, and prompt the user only for decisions that require human judgment.

### Step 1: Check Node.js

Verify Node.js is installed and version ≥ 22.13:

```bash
node --version
```

If missing or too old, guide the user to install Node.js 22.13+ from https://nodejs.org or via their package manager.

### Step 2: Install Qdrant

Check if Qdrant is already running:

```bash
curl -s http://localhost:6333/healthz
```

If not running, install it. **Prefer native installation** (especially on cloud instances where Docker may not be available):

**Linux (recommended for servers):**

```bash
# Download and install binary
curl -L https://github.com/qdrant/qdrant/releases/latest/download/qdrant-x86_64-unknown-linux-musl.tar.gz -o /tmp/qdrant.tar.gz
sudo tar xzf /tmp/qdrant.tar.gz -C /usr/local/bin/

# Create qdrant user and directories
sudo useradd -r -s /bin/false qdrant
sudo mkdir -p /var/lib/qdrant/storage /var/lib/qdrant/snapshots /etc/qdrant
sudo chown -R qdrant:qdrant /var/lib/qdrant

# Create config
sudo tee /etc/qdrant/config.yaml > /dev/null <<EOF
storage:
  storage_path: /var/lib/qdrant/storage
  snapshots_path: /var/lib/qdrant/snapshots
service:
  host: 0.0.0.0
  http_port: 6333
  grpc_port: 6334
EOF

# Create systemd service
sudo tee /etc/systemd/system/qdrant.service > /dev/null <<EOF
[Unit]
Description=Qdrant Vector Database
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/qdrant --config-path /etc/qdrant/config.yaml
WorkingDirectory=/var/lib/qdrant
Restart=always
User=qdrant

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now qdrant
```

**Windows:**

```powershell
# Download from GitHub releases page
# https://github.com/qdrant/qdrant/releases
# Extract and run, or register as NSSM service:
nssm install Qdrant <path-to-qdrant.exe>
nssm start Qdrant
```

**Docker (fallback, if available):**

```bash
docker run -d -p 6333:6333 -v qdrant_data:/qdrant/storage qdrant/qdrant
```

After installation, verify:

```bash
curl -s http://localhost:6333/healthz
```

### Step 3: Install Watcher Service

Install the watcher CLI globally:

```bash
npm install -g @karmaniverous/jeeves-watcher
```

Verify:

```bash
jeeves-watcher --version
```

### Step 4: Set Up Embedding Provider

The watcher uses Google Gemini for embeddings by default (`gemini-embedding-001`, 3072 dimensions).

Check for an existing API key:

```bash
echo $GOOGLE_API_KEY    # Linux/Mac
echo %GOOGLE_API_KEY%   # Windows cmd
$env:GOOGLE_API_KEY     # PowerShell
```

If not set, guide the user:

1. Go to https://aistudio.google.com/apikey
2. Create an API key (free tier supports 1,000 embedding requests/minute)
3. Set it as a persistent environment variable:
   - **Linux:** Add `export GOOGLE_API_KEY=<key>` to `~/.bashrc` or `~/.profile`
   - **Windows:** `setx GOOGLE_API_KEY "<key>"` (new shell sessions only) or set via System Properties → Environment Variables
   - **macOS:** Add to `~/.zshrc` or use `launchctl setenv`

Verify the key works by testing a Gemini API call:

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=$GOOGLE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"models/gemini-embedding-001","content":{"parts":[{"text":"test"}]}}'
```

A successful response contains an `embedding.values` array.

### Step 5: Author Initial Config

Ask the user these questions:

- **What directories should the watcher index?** (e.g., `~/documents`, `~/projects`, a workspace path)
- **What types of files matter?** (helps determine file extensions for watch globs)
- **Are there directories to exclude?** (node_modules, .git, build outputs, etc.)

Then generate a starter config file. Example minimal config:

```json
{
  "description": "Personal knowledge base indexing",
  "api": { "port": 1936 },
  "watch": {
    "paths": ["/home/user/documents/**/*.{md,txt,json,pdf,html,docx}"],
    "ignored": ["**/node_modules/**", "**/.git/**", "**/dist/**"]
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
    "collectionName": "jeeves_archive"
  },
  "search": {
    "scoreThresholds": { "strong": 0.75, "relevant": 0.5, "noise": 0.25 },
    "hybrid": { "enabled": true }
  },
  "logging": { "level": "info" },
  "inferenceRules": []
}
```

Write the config to a sensible location (e.g., `~/.config/jeeves-watcher.config.json` on Linux, or alongside the user's workspace). Validate it against the config schema (offline; no running service needed) with:

```bash
jeeves-watcher config validate -c <config-path>
```

### Step 6: Register and Start as a Service

**The watcher should run as a persistent service, not a foreground process.**

**Linux (systemd):**

```bash
sudo tee /etc/systemd/system/jeeves-watcher.service > /dev/null <<EOF
[Unit]
Description=Jeeves Watcher - Filesystem Indexing Service
After=network.target qdrant.service

[Service]
Type=simple
ExecStart=$(which jeeves-watcher) start -c <config-path>
WorkingDirectory=%h
Restart=always
Environment=GOOGLE_API_KEY=<key>
User=$USER

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now jeeves-watcher
```

**Windows (NSSM):**

```powershell
jeeves-watcher service install -c <config-path>
# Or manually:
nssm install jeeves-watcher (Get-Command jeeves-watcher).Source start -c <config-path>
nssm set jeeves-watcher AppEnvironmentExtra GOOGLE_API_KEY=<key>
nssm start jeeves-watcher
```

Verify the service started:

```bash
curl -s http://127.0.0.1:1936/status
```

### Step 7: Verify Health

Call `watcher_status` (or `curl http://127.0.0.1:1936/status`). Confirm:

- Service is running
- Qdrant collection exists with expected dimensions (3072)
- Point count is increasing (initial indexing in progress)

If the point count is 0 after a minute, check `watcher_issues` for processing failures.

### Step 8: Orientation

Once health is confirmed and initial indexing has started:

1. Query `$.['description','search']` for the deployment's organizational strategy and score thresholds.
2. Query `$.inferenceRules[*].['name','description']` for available record types.
3. Report to the user: how many points indexed so far, which domains are available, estimated time to complete initial indexing (based on file count and embedding rate).

### On Subsequent Sessions

On sessions after bootstrap is complete:

1. Call `watcher_status` silently.
2. Run the orientation queries silently.
3. Only report if something changed (service down, point count dropped significantly, new domains appeared).

**Key principle:** The agent drives discovery. The user shouldn't have to explain their archive to you — the archive explains itself through its config.

## Tools

The plugin registers 18 tools: `watcher_status`, `watcher_config`, `watcher_config_apply`, `watcher_service`, `watcher_search`, `watcher_enrich`, `watcher_validate`, `watcher_reindex`, `watcher_scan`, `watcher_issues`, `watcher_walk`, and the seven `watcher_vcs_*` tools (see [Version Tracking](#version-tracking)).

### `watcher_search`

Semantic search over indexed documents (`POST /search`).

- `query` (string, required) — natural language search query (non-empty)
- `limit` (number, optional) — max results (positive integer), default 10
- `offset` (number, optional) — skip N results for pagination (non-negative integer)
- `filter` (object, optional) — Qdrant filter for metadata filtering

Returns an array of `{ id, score, payload }` ordered by score (see [Search Result Shape](#search-result-shape)). A filter Qdrant rejects is `400 invalid_request`; an exhausted embedding budget is `503 embedding_unavailable`.

### `watcher_enrich`

Set or update metadata on a document (`POST /metadata`).

- `path` (string, required) — file path of the document (absolute or watched path)
- `metadata` (object, required) — key-value metadata to merge

Returns `{ ok: true, matched_rules }`. The tool addresses files only; to enrich a source document, call `POST /metadata` directly with `{ "source": "<name>://<id>", "metadata": { ... } }` (exactly one of `path` or `source`).

### `watcher_status`

Service health check (`GET /status`, never needs the API key). Returns `name`, `version`, `uptime`, `status`, and a `health` object: `collection` (`name`, `pointCount`, `dimensions`), `reindex` (`active`; while active also `scope`, `startedAt`, `filesProcessed`, `totalFiles`), and `initialScan`.

After a service restart, the `health.initialScan` field shows scan progress:

- `active: true` — filesystem walk in progress; `filesMatched` and `filesEnqueued` grow until chokidar completes
- `active: false` with `completedAt`/`durationMs` — scan finished

Use this to determine if the service is still initializing after a restart.

### `watcher_config`

Query the effective runtime config via JSONPath (`GET /config`). Returns the full resolved merged document when no path is provided.

- `path` (string, optional) — JSONPath expression

The document holds only the allow-listed keys `description`, `watch`, `configWatch`, `search`, `schemas`, `inferenceRules`, `mapHelpers`, `templateHelpers`, `maps`, `templates`, plus `issues` (the current issues). `api`, `sources`, `embedding`, `vectorStore` (and their keys) are never included. Each rule carries `source` (`config`, or the registering source of a virtual rule) and `values` (the runtime values index). File references (`map`, `maps`, `templates`) and named schema references are always resolved. An invalid JSONPath is `400 invalid_request`.

### `watcher_validate`

Validate config and optionally test file paths (`POST /config/validate`).

- `config` (object, optional) — candidate config (partial or full). Omit to validate current config.
- `testPaths` (string[], optional) — file paths to test against the config

Partial configs are merged into the running config shallowly: each top-level key replaces the running value, except `inferenceRules`, which merge by rule name. This differs from `watcher_config_apply` (deep merge), so pass a whole top-level object (e.g. all of `watch`) when validating a change inside it. Returns `{ valid: false, errors: [{ path, message }] }`, or `{ valid: true, warnings?, testResults? }`, where each test result is `{ path, matchedRules, metadata, error? }` (`error: "File not found"` when the path cannot be read). Validation problems come back in a `200` body, so this is the place to see them in full.

### `watcher_config_apply`

Apply config changes (`POST /config/apply`, sent as `{ patch: config }`).

- `config` (object, required) — full or partial config to apply

Partial configs are deep-merged into the config file the service runs from (objects recursively, arrays replaced, `inferenceRules` by rule name), so `{}` or a single key is valid. The merged result is validated and written to disk, then the `configWatch.reindex` scope (default `issues`) runs; that reindex covers files only. With `configWatch.enabled` (default `true`) the service picks up the written file without a restart, including new/removed watch paths (the filesystem watcher is rebuilt), inference rule changes, move detection settings, and gitignore filter updates.

Returns `{ applied: true, config }`. `config` is redacted through the same allow-list as `GET /config`: `api`, `sources` and provider keys are never echoed. When the file was written but the post-write apply step failed, the body also carries `warning` (a string describing the failure). An invalid merged config is a tool error reading `HTTP 400 invalid_request: Config validation failed` (the Zod `issues` are only in the HTTP body), so run `watcher_validate` first. A config file the service cannot read or write is a generic `HTTP 500 internal_error`, with the cause in the service log.

### `watcher_reindex`

Trigger a reindex operation (`POST /reindex`). Non-prune scopes return a `plan` object showing the blast area; the live run reuses the same targets. A live prune (non-dry-run) returns immediately without a plan.

**Parameters:**

- `scope` (string, optional) — Reindex scope. The tool sends `"rules"` when omitted (the HTTP API's own default is `"issues"`). One of:
  - `"rules"` — Re-apply inference rules to every watched file (no re-embedding; changed values written, keys the rules no longer project removed). With `path`, only files matching those globs. Without `path`, every indexed source document is also retrieved through its callback and its stored rule re-applied: unchanged content gets a metadata-only update, and a document is re-embedded only if its rendered text changed.
  - `"full"` — Re-extract and re-process every watched file (a file is re-embedded when the text to embed changed or it was never indexed), and retrieve and always re-embed every indexed source document. Clears the runtime values index first.
  - `"issues"` — Re-process the documents in `watcher_issues`: failed files, and failed source references (with their stored rule, or the `rule` recorded on the issue when the document was never indexed).
  - `"path"` — Re-process a specific file or all files under a directory. Requires `path`. Each target must be watched and not gitignored (`403 path_not_watched`) and must exist (`404 not_found`). Files only.
  - `"prune"` — Delete Qdrant points for files no longer in watch scope (removed paths, gitignored files, deleted files). No re-embedding. Pure cleanup. Never selects source points (`source` set, no `file_path`).
- `path` (string | string[], optional) — Target file(s) or directories for `"path"` (required there), or globs narrowing `"rules"`. Ignored by other scopes.
- `dryRun` (boolean, optional) — When `true`, compute and return the plan without executing.

The tool has no `source` parameter. To re-process specific source references, call `POST /reindex` directly with `{ "scope": "path", "source": ["<name>://<id>", ...] }` (at most 1000): they are enqueued on the notify queue, are not tracked by `GET /status`, and send no completion callback. A reindex triggered by a config change (`watcher_config_apply`, config-file reload, rule registration) covers files only.

**Response (normal):**

```json
{
  "status": "started",
  "scope": "rules",
  "plan": {
    "total": 148000,
    "toProcess": 148000,
    "toDelete": 0,
    "byRoot": { "/data": 95000, "/srv/config": 3000 }
  }
}
```

**Response (dryRun):**

```json
{
  "status": "dry_run",
  "scope": "prune",
  "plan": {
    "total": 562000,
    "toProcess": 0,
    "toDelete": 2300,
    "byRoot": { "/srv/app/node_modules": 1800, "/srv/app/.cache": 500 }
  }
}
```

**Plan fields:**

- `total` — Points scrolled (prune), or files plus source documents covered (other scopes).
- `toProcess` — Files plus source documents to process (0 for prune).
- `toDelete` — Points to delete (prune only, 0 for others).
- `byRoot` — Files grouped by watch root (for prune: orphaned files), plus one entry per source name for source documents. Shows where the impact concentrates.
- `incomplete` — `true` when the prune scroll failed part-way and the plan is partial.

**Progress:** a live run (every scope except `path` with `source`) is tracked in `watcher_status` under `health.reindex` (`filesProcessed` / `totalFiles`, counting files plus source documents). A failing file or source document is logged and recorded; the rest of the run continues.

**Guidance:**

- Use `dryRun: true` before any large-blast operation to preview impact.
- `prune` is safe — it only deletes orphaned file points, never re-embeds. Use after changing watch paths, fixing gitignore, or cleaning up stale data.
- `prune` is NOT triggered by config-watch auto-reindex (too dangerous for auto-trigger).

### `watcher_scan`

Filter-only point query without vector search (`POST /scan`). Use for structural queries where the question has no semantic dimension.

- `filter` (object, required) — Qdrant filter object. Required to prevent accidental full-collection scans.
- `limit` (number, optional) — page size (integer 1 to 1000), default 100
- `cursor` (string, optional) — opaque cursor from previous response for pagination
- `fields` (string[], optional) — payload fields to return (projection)
- `countOnly` (boolean, optional) — if true, return `{ count }` instead of points

**Response (normal):**

```json
{
  "points": [
    {
      "id": "uuid",
      "payload": { "file_path": "/data/tickets/PROJ-123.json" }
    }
  ],
  "cursor": "opaque-string-or-null"
}
```

**Response (countOnly):**

```json
{ "count": 1234 }
```

**Key differences from `watcher_search`:**

- No `query` parameter — does NOT use embeddings
- No `score` field — results are unranked filter matches
- Cursor-based pagination (not offset-based); `cursor` is `null` on the last page
- Zero cost per call beyond Qdrant's filtered scroll

**Pagination pattern:**

```
let cursor = undefined;
do {
  const result = await watcher_scan({ filter, limit: 100, cursor });
  // process result.points
  cursor = result.cursor;
} while (cursor);
```

### `watcher_service`

Manage the watcher background service (install, uninstall, start, stop, restart, check status). No HTTP call.

- `action` (string, required) — one of: `install`, `uninstall`, `start`, `stop`, `restart`, `status`

Returns the service manager's response. On Windows uses NSSM, on Linux systemd, on macOS launchd. Only `install` needs `configRoot` (see [Plugin Installation](#plugin-installation)).

### `watcher_issues`

Get runtime processing failures (`GET /issues`). Returns `{ count, issues: { [key]: IssueRecord[] } }`: `count` is the number of documents with issues, and each key is a file path or a source reference (`<name>://<id>`). Each `IssueRecord` has `type` (one of the [issue codes](#error-categories)), `message`, `timestamp`, and optionally `operation`, `property`, `rule`, `rules`, `types`, `details`.

### `watcher_walk`

List watched files matching globs (`POST /walk`). Returns matching file paths from the watcher's in-memory list of watched files across all configured watch roots.

- `globs` (string[], required) — glob patterns to intersect with watch paths (non-empty; matched case-insensitively, dotfiles included)

**Response:**

```json
{
  "paths": ["/data/foo/.meta/meta.json", "/data/bar/.meta/meta.json"],
  "matchedCount": 2,
  "scannedRoots": ["/data", "/srv/config"]
}
```

**Use cases:**

- Discover files matching a pattern across all watched directories (e.g., `["**/.meta/meta.json"]`)
- Enumerate files before rule registration to understand scope
- Find files that aren't yet indexed (no Qdrant dependency)

**Key differences from `watcher_scan`:**

- Lists the files the filesystem watcher tracks, not the Qdrant index
- No embedding or indexing required, but the initial filesystem scan must be complete: until then the tool returns `HTTP 503 scan_in_progress` (check `health.initialScan` in `watcher_status`)
- Returns file paths only (no metadata, no vectors)
- Applies `watch.ignored` and gitignore filtering automatically

## Query Planning: Scan vs Search

**Decision rule:** If the query has no semantic/natural-language dimension, use `watcher_scan`. If you need meaning-based similarity, use `watcher_search`.

| Use `watcher_scan` | Use `watcher_search` |
| --- | --- |
| "List all files in domain X" | "Find documents about authentication" |
| "Files modified after timestamp T" | "What discusses rate limiting?" |
| "Enumerate paths under prefix P" | "Prior conversations about deployment" |
| "Count files matching a condition" | "Related tickets to this issue" |
| "Staleness detection / delta computation" | "What happened in last week's meetings?" |

**Scan-specific filter examples:**

**Domain enumeration:**

```json
{ "must": [{ "key": "domains", "match": { "value": "email" } }] }
```

**Modified after timestamp:**

```json
{ "must": [{ "key": "modified_at", "range": { "gte": 1772800000 } }] }
```

**Path prefix matching:**

```json
{ "must": [{ "key": "file_path", "match": { "text": "/data/tickets" } }] }
```

**Count files in a domain (no point data transferred):**

```
watcher_scan: filter={"must":[{"key":"domains","match":{"value":"github"}}]}, countOnly=true
```

---

## Qdrant Filter Syntax

Filters use Qdrant's native JSON filter format, passed as the `filter` parameter to `watcher_search`.

### Basic Patterns

**Match exact value:**

```json
{ "must": [{ "key": "domain", "match": { "value": "email" } }] }
```

**Match text (full-text search within field):**

```json
{ "must": [{ "key": "chunk_text", "match": { "text": "authentication" } }] }
```

**Combine conditions (AND):**

```json
{
  "must": [
    { "key": "domain", "match": { "value": "jira" } },
    { "key": "status", "match": { "value": "In Progress" } }
  ]
}
```

**Exclude (NOT):**

```json
{
  "must_not": [{ "key": "domain", "match": { "value": "repos" } }]
}
```

**Any of (OR):**

```json
{
  "should": [
    { "key": "domain", "match": { "value": "email" } },
    { "key": "domain", "match": { "value": "slack" } }
  ]
}
```

**Nested (combine AND + NOT):**

```json
{
  "must": [{ "key": "domain", "match": { "value": "jira" } }],
  "must_not": [{ "key": "status", "match": { "value": "Done" } }]
}
```

### Key Differences

- `match.value` — exact match (case-sensitive, for keyword fields like `domain`, `status`)
- `match.text` — full-text match (for text fields like `chunk_text`)

## Search Result Shape

Each result from `watcher_search` contains:

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Qdrant point ID |
| `score` | number | Similarity (or hybrid fused) score; higher = more relevant |
| `payload.file_path` | string | Normalized file path (file points only) |
| `payload.source` | string | Source reference `<name>://<id>` (source points only) |
| `payload.source_rule` | string | Designated rule of a source document (source points only) |
| `payload.chunk_text` | string | The matched text chunk |
| `payload.chunk_index` | number | Zero-based chunk position within the document |
| `payload.total_chunks` | number | Total chunks for this document |
| `payload.line_start` | number | 1-indexed line where the chunk starts |
| `payload.line_end` | number | 1-indexed line where the chunk ends |
| `payload.created_at` | number | Creation timestamp (unix seconds) |
| `payload.modified_at` | number | Modification timestamp (unix seconds) |
| `payload.content_hash` | string | SHA-256 hash of the embedded text |
| `payload.matched_rules` | string[] | Names of inference rules that matched |

`file_path` is not always present: a source point (a document indexed through a source callback) carries a non-empty `source` and no `file_path`. A file point may also carry a `source` written by its own rules; it is still a file point. Additional metadata fields depend on the deployment's inference rules (e.g., `domain`, `status`, `author`). Use `watcher_config` to discover available fields.

## Query Planning (Per Search Task)

Identify relevant rule(s) from the orientation model, then retrieve their schemas:

**Retrieve complete schema for a rule:**

```
watcher_config: path="$.inferenceRules[?(@.name=='jira-issue')].schema"
```

Returns the rule's schema array with named schema references and file references already resolved: properties, types, `set` expressions, `uiHint`, `enum`, etc.

**For select/multiselect fields without `enum` in schema:**

```
watcher_config: path="$.inferenceRules[?(@.name=='jira-issue')].values.status"
```

Retrieves valid filter values from the runtime values index (distinct values accumulated during embedding).

**When search results span multiple rules** (indicated by `matched_rules` on results): query each unique rule's schema separately and merge mentally. Most result sets share the same rule combination, so this is typically one or two queries, not one per result.

---

## uiHint → Filter Mapping

Use `uiHint` to determine filter construction strategy. **This table is explicit, not intuited:**

| `uiHint` | Qdrant filter | Notes |
| --- | --- | --- |
| `text` | `{ "key": "<field>", "match": { "text": "<value>" } }` | Substring/keyword match |
| `select` | `{ "key": "<field>", "match": { "value": "<enum_value>" } }` | Exact match; use `enum` values from schema or runtime values index |
| `multiselect` | `{ "key": "<field>", "match": { "value": "<enum_value>" } }` | Any-element match on array field; use `enum` or runtime values index |
| `date` | `{ "key": "<field>", "range": { "gte": <unix_ts>, "lt": <unix_ts> } }` | Range filter against integer fields holding Unix timestamps (seconds). Source dates should be normalized in config via `{{toUnix ...}}` in `set` expressions. Either bound optional for open-ended ranges (e.g., "after January" → `gte` only) |
| `number` | `{ "key": "<field>", "range": { "gte": <n>, "lte": <n> } }` | Either bound optional for open-ended ranges |
| `check` | `{ "key": "<field>", "match": { "value": true } }` | Boolean match |
| _(absent)_ | Do not use in filters | Internal bookkeeping field, not intended for search |

**Fallback:** If a `select`/`multiselect` field has neither `enum` in schema nor values in the index, treat it as `text` (substring match instead of exact match).

---

## Qdrant Filter Combinators

Compose individual field conditions into complex queries using three combinators:

| Combinator | Semantics | Use case |
| --- | --- | --- |
| `must` | AND — all conditions required | Intersecting constraints (domain + date range + assignee) |
| `should` | OR — at least one must match | Alternative values, fuzzy criteria ("assigned to X or Y") |
| `must_not` | Exclusion — any match triggers exclude | Filtering out noise (exclude Done, exclude codebase domain) |

**Combinators nest arbitrarily for complex boolean logic:**

```json
{
  "must": [
    { "key": "domain", "match": { "value": "jira" } },
    { "key": "created", "range": { "gte": 1735689600 } }
  ],
  "should": [
    { "key": "assignee", "match": { "value": "Jane Doe" } },
    { "key": "assignee", "match": { "value": null } }
  ],
  "must_not": [{ "key": "status", "match": { "value": "Done" } }]
}
```

A consuming UI will necessarily compose simple single-field filters. The assistant can compose deeply complex queries combining multiple fields, nested boolean logic, and open-ended ranges to precisely target what it needs.

---

## Search Execution

**Plain semantic search is valid and often sufficient.** Not every query needs metadata filters. When the user's question is broad or exploratory, a natural language query with no filter object is the right starting point. Add filters to narrow, not as a default.

**Result limit guidance:**

- Default: 10 results
- Broad discovery / exploratory: 20–30, apply score threshold cutoff from config
- Targeted retrieval with tight filters: 5
- Cross-domain sweep: 15–20, no domain filter, use score to separate signal from noise

---

## Post-Processing Guidance

### Score Interpretation

Use `scoreThresholds` from config (queried during orientation). Values are deployment-specific, constrained to [-1, 1]:

- `strong` — minimum score for a strong match. **Action:** High confidence. Use these results directly.
- `relevant` — minimum score for relevance. **Action:** Likely useful but verify context before relying on them.
- `noise` — maximum score below which results are noise. **Action:** Discard. If all results fall below this threshold, broaden your query or try different terms.

### Chunk Grouping

Multiple results with the same `file_path` (or, for source documents, the same `source`) are chunks of one document. Read the full file for complete context.

### Schema Lookup

Use `matched_rules` on results to look up applicable schemas for metadata interpretation:

```
watcher_config: path="$.inferenceRules[?(@.name=='jira-issue')].schema"
```

### Full Context

Search gives you chunks; use `read` with `file_path` for the complete document. A source document has no file: render it with `POST /render` and `{ "source": "<ref>" }`, which retrieves it through its callback.

---

## Path Testing

When uncertain whether a file would be indexed, test it against the rules. `watcher_validate` with `testPaths` (and no `config`) runs the current rules against each path and returns `{ path, matchedRules, metadata }` per path (`error: "File not found"` when the file cannot be read):

```
watcher_validate: testPaths=["/data/tickets/PROJ-123.json"]
```

Or call `POST /config/match` directly with `{ "paths": [...] }`. It returns `{ matches: [{ rules, watched }] }`, one entry per path, without reading the files:

- `rules` lists the matching rule names; an empty array means no inference rules match
- `watched: false` means the path falls outside watch paths or is excluded by ignore patterns

---

## Config Authoring

### Rule Structure

Each inference rule has:

- `name` (required) — unique identifier
- `description` (required) — human-readable purpose
- `match` (required) — JSON Schema matched against file attributes (e.g. a picomatch `glob` on `file.path`)
- `schema` (optional) — array of named schema references and/or inline schema objects with `set` templates
- `map` (optional) — JsonMap transform (inline, named map, or `.json` file path)
- `template` (optional) — Handlebars template (inline, named template, or `.hbs`/`.handlebars` file path)
- `render` (optional) — declarative frontmatter + Markdown renderer (mutually exclusive with `template`)
- `renderAs` (optional) — output extension (1-10 lowercase alphanumerics); requires `template` or `render`

### Config Workflow

1. Edit config (or build partial config object)
2. Validate: `watcher_validate` with optional `testPaths` for dry-run preview
3. Apply: `watcher_config_apply` — validates, writes, triggers the `configWatch.reindex` reindex
4. Monitor: `watcher_issues` for runtime processing failures

### Reindex Concurrency

Reindex operations process files and source documents concurrently using `reindex.concurrency` (default 50). This applies to every scope, to issue-source discovery, and to the stored-rule lookups of `POST /reindex` with `source`. The watcher's incremental processing (file events and source notifications) uses a separate `embedding.concurrency` setting.

Progress is reported via `watcher_status` (`health.reindex.filesProcessed` / `health.reindex.totalFiles`, counting files plus source documents).

### When to Reindex

- **Rules scope** (`"rules"`): Changed rule matching patterns, set expressions, schema mappings. No file re-embedding needed.
- **Full scope** (`"full"`): Added watch paths, broad schema restructuring, or source documents whose vectors must be rebuilt. Re-extracts every file (re-embedding the ones whose text to embed changed) and re-embeds every source document.
- **Issues scope** (`"issues"`): After fixing the root cause of processing failures (permissions, encoding, file format, a source outage). Re-processes only the failed files and source documents.
- **Path scope** (`"path"`): Edited files in a specific directory, or a single file looks stale, and you want them re-processed without a full reindex. A file whose text to embed is unchanged is not re-embedded.
- **Prune scope** (`"prune"`): After changing `watch.paths`, adding gitignore rules, or discovering stale/orphaned points (e.g., indexed `node_modules`). Deletes points for out-of-scope or deleted files. Always `dryRun: true` first to preview.

---

## Diagnostics

### Escalation Path

1. `watcher_status` — is the service healthy? Is a reindex running? Is the initial scan still active?
2. `watcher_issues` — which documents are failing and why?
3. `watcher_config` with `$.issues` — the same issue records via JSONPath
4. Check logs at the configured log path

### Error Categories

Every issue record's `type` is one of these codes:

- `type_collision` — conflicting metadata types across rules (includes `property`, `rules[]`, `types[]`)
- `interpolation_error` — template or `set` expression rendering failed (includes `property`, `rule`; `details` holds per-step failures)
- `extraction_error` — reading, rule application or chunking failed
- `embedding_error` — the embedding provider failed
- `upsert_error` — the vector store write failed
- `match_failed` — a source document's designated rule did not match (`details` holds the AJV errors)
- `rule_missing` — a source document's designated rule was not found
- `no_content` — nothing to embed
- `source_unavailable` — the source callback failed
- `unsupported_content_type` — the source callback returned a non-JSON body

Source-document issues always carry `rule` (the designated rule of the failed run).

**Issues are self-healing:** resolved on successful re-process. The issues file always represents the current set of unresolved problems: a live todo list.

---

## Helper Management

Helpers use namespace prefixing: config key becomes prefix. A helper named `slack` exports `slack_extractParticipants`.

Enumerate loaded helpers:

```
$.mapHelpers              — JsonMap helper namespaces with exports
$.templateHelpers         — Handlebars helper namespaces with exports
```

### Built-in JsonMap Helpers

The following helpers are available in every JsonMap `lib` context without any helper config:

#### `fetchSiblings(filePath, options?)`

Retrieve extracted text from neighboring files in the same directory with the same extension. Useful for contextual embedding — e.g., injecting surrounding email messages into a thread member's embedding for better semantic search.

**Parameters:**

- `filePath` (string) — the current file path (in a rule's `map`, `$.input.file.path`)
- `options` (object, optional; JsonMap `params` are path strings, so a call from a config `map` uses the defaults):
  - `before` (number, default 3) — number of preceding siblings to include
  - `after` (number, default 1) — number of following siblings to include
  - `sort` (`"name"` | `"mtime"`, default `"name"`) — sort order for determining neighbor position

**Returns:** `string[]` — extracted text from sibling files, in sort order. Files that fail extraction are silently skipped. For a source document (a source rule's `map`) there is no file reader, so it returns `[]`.

**Example** (in a rule's `map`):

```json
{
  "context": {
    "$": { "method": "$.lib.fetchSiblings", "params": "$.input.file.path" }
  }
}
```

---

## Enrichment

Use `watcher_enrich` to tag documents after analysis (e.g., `reviewed: true`, project labels).

**Enrichments are durable.** Stored in a SQLite database (`<stateDir>/enrichments.sqlite`, default `stateDir` `.jeeves-metadata`), enrichments survive full reindexes. Enriching a file that is not indexed yet stores the enrichment, which applies once the file is indexed. When the watcher re-processes a file, enrichments are merged with inference rule output using composable semantics: scalar fields overwrite, array fields union+deduplicate.

**Metadata is validated against the file's matched rule schemas** (for a source document, its designated rule's schema). Only declared property types are checked; unknown properties and `null` values pass. The tool reports a failure as `HTTP 400 invalid_request: Validation failed`; the structured `details` are in the HTTP response body:

```json
{
  "code": "invalid_request",
  "error": "Validation failed",
  "details": [
    {
      "property": "priority",
      "expected": "string",
      "received": "number",
      "rule": "jira-issue",
      "message": "Property 'priority' is declared as string in jira-issue schema, received number"
    }
  ]
}
```

---

## Version Tracking

The watcher includes built-in history and undo for your watched files. When enabled, every change to a watched file is automatically versioned. You can view the history of any file or folder, see exactly what changed between versions, retrieve old versions, and undo changes — all through the `watcher_vcs_*` tools.

### Tools

| Tool | Purpose |
| --- | --- |
| `watcher_vcs_status` | Check version tracking health: enabled state, tracked roots, remote sync status |
| `watcher_vcs_history` | View change history for a file or folder, with optional date range and limit |
| `watcher_vcs_show` | Retrieve the content of a file at a specific past version |
| `watcher_vcs_diff` | Show what changed between two versions, or between a past version and now |
| `watcher_vcs_revert` | Undo changes by restoring files to a specific past version |
| `watcher_vcs_exclude` | Exclude (or re-include) paths from version tracking |
| `watcher_vcs_check` | Check whether a path is excluded from version tracking and why |

### Usage Patterns

**View recent changes to a file:**

```
watcher_vcs_history: glob="/data/tickets/PROJ-123.json", limit=10
```

**See what changed between two versions:**

```
watcher_vcs_diff: glob="/data/tickets/PROJ-123.json", commit="abc1234"
```

**Restore a file to a previous version:**

```
watcher_vcs_revert: glob="/data/tickets/PROJ-123.json", commit="abc1234"
```

**View old content without restoring:**

```
watcher_vcs_show: path="/data/tickets/PROJ-123.json", commit="abc1234"
```

**Exclude files that don't need versioning** (e.g., Jira issues that are read-only syncs):

```
watcher_vcs_exclude: glob="/data/tickets/**/*.json"
```

**Check if a file is excluded and why:**

```
watcher_vcs_check: path="/data/tickets/PROJ-123.json"
```

### Enabling Version Tracking

Version tracking is controlled by the `vcs.enabled` config setting. When set to `true`, the watcher automatically versions all watched files. No additional setup is required — just enable it and history starts accumulating.

Squash retention activates by default when VCS is enabled, even without explicit `retention` config. The defaults are: 30 days max age, 100 versions max, and a daily midnight cron schedule (`0 0 * * *`). These defaults prevent unbounded commit history growth.

### Excluding Paths

Not all watched files need version history. For example, if Jira issues are synced read-only, there's nothing to "undo." Use `watcher_vcs_exclude` to stop tracking specific paths.

Exclusions are placed as close to the target as possible: if you exclude `/data/tickets/**/*.json`, the exclusion rule is written inside the `/data/tickets/` directory, not at the root. This keeps exclusions local and easy to reason about. Re-include a path by calling `watcher_vcs_exclude` with `remove: true`.

### Score Interpretation

VCS tools do not use vector search. There are no relevance scores to interpret — results are exact history lookups, diffs, and file retrievals.

---

## Error Handling

If the watcher is unreachable:

- Inform the user that semantic search is temporarily unavailable
- Fall back to direct `read` for known file paths
- Do not retry silently in a loop

If tools are unavailable (plugin not loaded in this session):

- The watcher API is still accessible via direct HTTP calls
- Use `exec` to call the endpoints listed in Service Architecture
- Default: `http://127.0.0.1:1936`

**CLI Fallbacks:**

- `jeeves-watcher status [-p <port>]` — check if the service is running (`GET /status`)
- `jeeves-watcher config validate -c <path>` — validate a config file against the schema (offline)
- Restart via NSSM (Windows) or systemctl (Linux)

---

## References

- [JSONPath Plus documentation](https://www.npmjs.com/package/jsonpath-plus) for JSONPath syntax
- [Qdrant filtering documentation](https://qdrant.tech/documentation/concepts/filtering/) for advanced query patterns and search response format
