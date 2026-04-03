---
name: jeeves-watcher
description: >
  Semantic search across a structured document archive. Use when you need to
  recall prior context, find documents, answer questions that require searching
  across indexed domains, enrich document metadata, manage watcher config, or
  diagnose indexing issues.
---

# jeeves-watcher — Search, Discovery & Administration

## Service Architecture

The watcher is an HTTP API running as a background service (typically NSSM on Windows, systemd on Linux).

**Default port:** 1936 (configurable via `api.port` in watcher config)
**Non-default port:** If the watcher runs on a different port, the user must set `plugins.entries.jeeves-watcher.config.apiUrl` in `openclaw.json`. The plugin cannot auto-discover a non-default port.

**Health check:** `GET /status` returns `name`, `version`, `uptime`, `status` (`healthy`/`degraded`/`unhealthy`), and a `health` object containing `collection` (point count, dimensions), `reindex` status, and `initialScan` progress.

**Mental model:** The `watcher_*` tools are thin HTTP wrappers. Each tool call translates to an HTTP request to the watcher API. When tools are available, use them. When they're not (e.g., different session, plugin not loaded), you can hit the API directly. Replace `<PORT>` below with the configured port (default 1936; check `plugins.entries.jeeves-watcher.config.apiUrl` in `openclaw.json` if overridden):

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
|----------|--------|---------|
| `/status` | GET | Health check, uptime, collection stats |
| `/search` | POST | Semantic search (main query interface) |
| `/config` | GET | Full resolved config; optional `?path=<jsonpath>` filter |
| `/config/validate` | POST | Validate candidate config |
| `/config/apply` | POST | Apply config changes |
| `/reindex` | POST | Trigger reindex |
| `/metadata` | POST | Enrich document metadata |
| `/scan` | POST | Filter-only point query (no embeddings) |
| `/walk` | POST | Filesystem walk with glob intersection |
| `/issues` | GET | Runtime embedding failures |
| `/rules/register` | POST | Register virtual inference rules (auto-triggers rules reindex) |
| `/rules/unregister` | DELETE | Remove virtual rules by source |
| `/rules/unregister/:source` | DELETE | Remove virtual rules by source (parameterized) |
| `/rules/reapply` | POST | Re-apply rules to points |
| `/points/delete` | POST | Delete points matching a Qdrant filter |
| `/render` | POST | Render a template for a document |
| `/search/facets` | GET | Get search facet values |
| `/rebuild-metadata` | POST | Rebuild enrichment metadata from Qdrant |
| `/config/schema` | GET | Get config JSON schema |
| `/config/match` | POST | Match config paths against rules |

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
- **Running `scope: "full"` reindex.** This re-embeds the entire index. Use `scope: "rules"` for inference rule changes (zero embedding cost — only metadata reapplication).
- **Any bulk file operation** (mass copy, mass move, template-based file generation) under watched paths.

**The right instinct when blocked:** If a filesystem operation fails because a service has a lock, the correct response is to stop the service, do the operation, and restart — NOT to find a creative workaround. Creative workarounds in the presence of a live watcher are how you accidentally trigger re-embedding of tens of thousands of files.

**Cost context:** A single file embedding costs a Gemini API call. 1,000 unnecessary embeddings is a noticeable cost. 100,000 unnecessary embeddings (e.g., copying an entire domain directory to a new path) is a billing event worth flagging.

## Plugin Installation

```
npx @karmaniverous/jeeves-watcher-openclaw install
```

This copies the plugin to OpenClaw's extensions directory and patches `openclaw.json` to register it. 

**Important:** Add `"jeeves-watcher-openclaw"` to the `tools.allow` array in `openclaw.json` so the agent can use the plugin's tools.

Restart the gateway to load the plugin.

To remove:
```
npx @karmaniverous/jeeves-watcher-openclaw uninstall
```

## Quick Start (Existing Deployment)

If the watcher service is already running and healthy:

1. **Search** — use `watcher_search` with a natural language query and optional metadata filters
2. **Read source** — use `read` (standard file read) with `file_path` from search results for full document content

## Bootstrap (First-Time Setup)

When the plugin loads and the watcher service is NOT yet set up, drive the entire setup proactively. The user should be able to install the plugin with nothing else in place and the bootstrap process gets them to a working system.

**The agent drives this process.** Don't hand the user CLI commands and wait. Check each prerequisite, explain what's needed, execute what you can, and prompt the user only for decisions that require human judgment.

### Step 1: Check Node.js

Verify Node.js is installed and version ≥ 22:
```bash
node --version
```

If missing or too old, guide the user to install Node.js 22+ from https://nodejs.org or via their package manager.

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
    "paths": [
      "/home/user/documents/**/*.{md,txt,json,pdf,html,docx}"
    ],
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

Write the config to a sensible location (e.g., `~/.config/jeeves-watcher.config.json` on Linux, or alongside the user's workspace). Validate with:
```bash
jeeves-watcher validate -c <config-path>
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
jeeves-watcher service install
# Or manually:
nssm install jeeves-watcher "$(which jeeves-watcher)" start -c <config-path>
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

If the point count is 0 after a minute, check `watcher_issues` for embedding failures.

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

### `watcher_search`
Semantic search over indexed documents.
- `query` (string, required) — natural language search query
- `limit` (number, optional) — max results, default 10
- `offset` (number, optional) — skip N results for pagination
- `filter` (object, optional) — Qdrant filter for metadata filtering

### `watcher_enrich`
Set or update metadata on a document.
- `path` (string, required) — file path of the document
- `metadata` (object, required) — key-value metadata to merge

### `watcher_status`
Service health check. Returns `name`, `version`, `uptime`, `status`, and `health` object with collection stats, reindex status, and initial scan progress.

After a service restart, the `health.initialScan` field shows scan progress:
- `active: true` — filesystem walk in progress; `filesMatched` and `filesEnqueued` grow until chokidar completes
- `active: false` with `completedAt`/`durationMs` — scan finished

Use this to determine if the service is still initializing after a restart.

### `watcher_config`
Query the effective runtime config via JSONPath. Returns the full resolved merged document when no path is provided.
- `path` (string, optional) — JSONPath expression

### `watcher_validate`
Validate config and optionally test file paths.
- `config` (object, optional) — candidate config (partial or full). Omit to validate current config.
- `testPaths` (string[], optional) — file paths to test against the config

Partial configs merge with current config by rule name. If `config` is omitted, tests against the running config.

### `watcher_config_apply`
Apply config changes atomically.
- `config` (object, required) — full or partial config to apply

Validates, writes to disk, and triggers configured reindex behavior. Returns validation errors if invalid. Config changes take full effect without service restart — including new/removed watch paths (filesystem watcher is rebuilt), inference rule changes, move detection settings, and gitignore filter updates.

### `watcher_reindex`
Trigger a reindex operation. All scopes return a `plan` object showing blast area before execution begins.

**Parameters:**
- `scope` (string, optional) — Reindex scope. Default: `"rules"`. One of:
  - `"rules"` — Re-apply inference rules to all watched files. No re-embedding. Lightweight.
  - `"full"` — Re-extract text, re-embed, and re-apply rules for all watched files. Expensive.
  - `"issues"` — Re-process only files that previously failed embedding (from `watcher_issues`).
  - `"path"` — Re-embed a specific file or all files under a directory. Requires `path` parameter.
  - `"prune"` — Delete Qdrant points for files no longer in watch scope (removed paths, gitignored files, stale data). No re-embedding. Pure cleanup.
- `path` (string, required when scope is `"path"`) — Target file or directory path.
- `dryRun` (boolean, optional) — When `true`, compute and return the blast area plan without executing. Returns synchronously.

**Response (normal):**
```json
{ "status": "started", "scope": "rules", "plan": { "total": 148000, "toProcess": 148000, "toDelete": 0, "byRoot": { "j:/domains": 95000, "j:/config": 3000 } } }
```

**Response (dryRun):**
```json
{ "status": "dry_run", "scope": "prune", "plan": { "total": 562000, "toProcess": 0, "toDelete": 2300, "byRoot": { "j:/jeeves/node_modules": 1800, "j:/jeeves/.bridge": 500 } } }
```

**Plan fields:**
- `total` — Total points (prune) or files (other scopes) examined.
- `toProcess` — Items to embed/re-apply rules (0 for prune).
- `toDelete` — Points to delete (prune only, 0 for others).
- `byRoot` — Counts grouped by watch root prefix. Shows where the impact concentrates.

**Guidance:**
- Use `dryRun: true` before any large-blast operation to preview impact.
- `prune` is safe — it only deletes orphaned points, never re-embeds. Use after changing watch paths, fixing gitignore, or cleaning up stale data.
- `prune` is NOT triggered by config-watch auto-reindex (too dangerous for auto-trigger).


### `watcher_scan`
Filter-only point query without vector search. Use for structural queries where the question has no semantic dimension.
- `filter` (object, required) — Qdrant filter object. Required to prevent accidental full-collection scans.
- `limit` (number, optional) — page size, default 100, max 1000
- `cursor` (string, optional) — opaque cursor from previous response for pagination
- `fields` (string[], optional) — payload fields to return (projection)
- `countOnly` (boolean, optional) — if true, return `{ count }` instead of points

**Response (normal):**
```json
{
  "points": [{ "id": "uuid", "payload": { ... } }],
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
- Cursor-based pagination (not offset-based)
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
Manage the watcher background service (install, uninstall, start, stop, restart, check status).
- `action` (string, required) — one of: `install`, `uninstall`, `start`, `stop`, `restart`, `status`

Returns the service manager's response. On Windows uses NSSM, on Linux uses systemd.

### `watcher_issues`
Get runtime embedding failures. Returns `{ filePath: IssueRecord }` showing files that failed and why.

### `watcher_walk`
Walk watched filesystem paths with glob intersection. Returns matching file paths from all configured watch roots.
- `globs` (string[], required) — glob patterns to intersect with watch paths

**Response:**
```json
{
  "paths": ["j:/domains/foo/.meta/meta.json", "j:/domains/bar/.meta/meta.json"],
  "matchedCount": 2,
  "scannedRoots": ["j:/domains", "j:/config"]
}
```

**Use cases:**
- Discover files matching a pattern across all watched directories (e.g., `["**/.meta/meta.json"]`)
- Enumerate files before rule registration to understand scope
- Find files that aren't yet indexed (no Qdrant dependency — works even before first embedding)

**Key differences from `watcher_scan`:**
- Walks the actual filesystem, not the Qdrant index
- No embedding or indexing required — works immediately after service start
- Returns file paths only (no metadata, no vectors)
- Applies `watch.ignored` and gitignore filtering automatically

## Query Planning: Scan vs Search

**Decision rule:** If the query has no semantic/natural-language dimension, use `watcher_scan`. If you need meaning-based similarity, use `watcher_search`.

| Use `watcher_scan` | Use `watcher_search` |
|---------------------|----------------------|
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
{ "must": [{ "key": "file_path", "match": { "text": "j:/domains/jira" } }] }
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
|-------|------|-------------|
| `id` | string | Qdrant point ID |
| `score` | number | Similarity score (0-1, higher = more relevant) |
| `payload.file_path` | string | Source file path |
| `payload.chunk_text` | string | The matched text chunk |
| `payload.chunk_index` | number | Chunk position within the file |
| `payload.total_chunks` | number | Total chunks for this file |
| `payload.content_hash` | string | Hash of the full document content |
| `payload.matched_rules` | string[] | Names of inference rules that matched |

Additional metadata fields depend on the deployment's inference rules (e.g., `domain`, `status`, `author`). Use `watcher_config` to discover available fields.

## Query Planning (Per Search Task)

Identify relevant rule(s) from the orientation model, then retrieve their schemas:

**Retrieve complete schema for a rule:**
```
watcher_config: path="$.inferenceRules[?(@.name=='jira-issue')].schema"
              resolve=["files","globals"]
```

Returns the fully merged schema with properties, types, `set` provenance, `uiHint`, `enum`, etc.

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
|----------|--------------|-------|
| `text` | `{ "key": "<field>", "match": { "text": "<value>" } }` | Substring/keyword match |
| `select` | `{ "key": "<field>", "match": { "value": "<enum_value>" } }` | Exact match; use `enum` values from schema or runtime values index |
| `multiselect` | `{ "key": "<field>", "match": { "value": "<enum_value>" } }` | Any-element match on array field; use `enum` or runtime values index |
| `date` | `{ "key": "<field>", "range": { "gte": <unix_ts>, "lt": <unix_ts> } }` | Range filter against integer fields holding Unix timestamps (seconds). Source dates should be normalized in config via `{{toUnix ...}}` in `set` expressions. | for open-ended ranges (e.g., "after January" → `gte` only) |
| `number` | `{ "key": "<field>", "range": { "gte": <n>, "lte": <n> } }` | Either bound optional for open-ended ranges |
| `check` | `{ "key": "<field>", "match": { "value": true } }` | Boolean match |
| *(absent)* | Do not use in filters | Internal bookkeeping field, not intended for search |

**Fallback:** If a `select`/`multiselect` field has neither `enum` in schema nor values in the index, treat it as `text` (substring match instead of exact match).

---

## Qdrant Filter Combinators

Compose individual field conditions into complex queries using three combinators:

| Combinator | Semantics | Use case |
|-----------|-----------|----------|
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
  "must_not": [
    { "key": "status", "match": { "value": "Done" } }
  ]
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
Multiple results with the same `file_path` are chunks of one document. Read the full file for complete context.

### Schema Lookup
Use `matched_rules` on results to look up applicable schemas for metadata interpretation:
```
watcher_config: path="$.inferenceRules[?(@.name=='jira-issue')].schema"
              resolve=["files","globals"]
```

### Full Context
Search gives you chunks; use `read` with `file_path` for the complete document.

---

## Path Testing

When uncertain whether a file is indexed, use the path test endpoint:
```
watcher_config: path="$.inferenceRules[?(@.name=='<rule>')].match"
```

Or check if a specific path would match:
- Returns matching rule names and watch scope status
- Empty `rules` array means no inference rules match
- `watched: false` means the path falls outside watch paths or is excluded by ignore patterns

---

## Config Authoring

### Rule Structure
Each inference rule has:
- `name` (required) — unique identifier
- `description` (required) — human-readable purpose
- `match` — JSON Schema with picomatch glob for path matching
- `schema` — array of named schema references and/or inline schema objects with `set` templates
- `map` (optional) — named JsonMap transform
- `template` (optional) — named Handlebars template

### Config Workflow
1. Edit config (or build partial config object)
2. Validate: `watcher_validate` with optional `testPaths` for dry-run preview
3. Apply: `watcher_config_apply` — validates, writes, triggers reindex
4. Monitor: `watcher_issues` for runtime embedding failures

### Reindex Concurrency

Reindex operations process files concurrently using `reindex.concurrency` (default 50). This applies to full reindex, rules reindex, issues reindex, and the `POST /reindex` endpoint. The watcher's incremental file processing (chokidar) uses a separate `embedding.concurrency` setting.

Progress is reported via `watcher_status` (`reindex.filesProcessed` / `reindex.totalFiles`).

### When to Reindex
- **Rules scope** (`"rules"`): Changed rule matching patterns, set expressions, schema mappings. No re-embedding needed.
- **Full scope** (`"full"`): Changed embedding config, added watch paths, broad schema restructuring. Re-embeds everything.
- **Issues scope** (`"issues"`): After fixing the root cause of embedding failures (permissions, encoding, file format). Re-processes only failed files.
- **Path scope** (`"path"`): Edited files in a specific directory and want to force re-embedding without a full reindex. Or a single file's embedding looks wrong.
- **Prune scope** (`"prune"`): After changing `watch.paths`, adding gitignore rules, or discovering stale/orphaned points (e.g., indexed `node_modules`). Deletes points for out-of-scope files. Always `dryRun: true` first to preview.

---

## Diagnostics

### Escalation Path
1. `watcher_status` — is the service healthy? Is a reindex running? Is the initial scan still active?
2. `watcher_issues` — what files are failing and why?
3. `watcher_config` with `$.issues` — same data via JSONPath
4. Check logs at the configured log path

### Error Categories
- `type_collision` — metadata field type mismatch during extraction (includes `property`, `rules[]`, `types[]`)
- `interpolation` / `interpolation_error` — template/set expression failed to resolve (includes `property`, `rule`)
- `read_failure` — file couldn't be read (permissions, encoding)
- `embedding` — embedding API error

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
Retrieve extracted text from neighboring files in the same directory. Useful for contextual embedding — e.g., injecting surrounding email messages into a thread member's embedding for better semantic search.

**Parameters:**
- `filePath` (string) — the current file path (typically `$file_path`)
- `options` (object, optional):
  - `before` (number, default 3) — number of preceding siblings to include
  - `after` (number, default 1) — number of following siblings to include
  - `sort` (`"name"` | `"mtime"`, default `"name"`) — sort order for determining neighbor position

**Returns:** `string[]` — extracted text from sibling files, in sort order. Files that fail extraction are silently skipped.

**Example** (in a JsonMap `$set` expression):
```json
{ "context": { "$fn": "fetchSiblings", "$args": ["$file_path", { "before": 2, "after": 1 }] } }
```

---

## Enrichment

Use `watcher_enrich` to tag documents after analysis (e.g., `reviewed: true`, project labels).

**Enrichments are durable.** Stored in a SQLite database (`<stateDir>/enrichments.sqlite`), enrichments survive full reindexes. When the watcher re-processes a file, enrichments are merged with inference rule output using composable semantics: scalar fields overwrite, array fields union+deduplicate.

**Metadata is validated against the file's matched rule schemas.** Validation errors return structured messages:
```json
{
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
- `jeeves-watcher status` — check if the service is running
- `jeeves-watcher validate` — validate config from CLI
- Restart via NSSM (Windows) or systemctl (Linux)

---

## References

- [JSONPath Plus documentation](https://www.npmjs.com/package/jsonpath-plus) for JSONPath syntax
- [Qdrant filtering documentation](https://qdrant.tech/documentation/concepts/filtering/) for advanced query patterns and search response format




