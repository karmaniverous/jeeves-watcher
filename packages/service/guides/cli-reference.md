---
title: CLI Reference
---

# CLI Reference

Complete reference for all `jeeves-watcher` CLI commands.

## Global Options

All commands support these options:

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to configuration file (overrides auto-discovery) |
| `-h, --help` | Show help for a command |
| `-V, --version` | Show version number |

---

## `jeeves-watcher start`

Start the filesystem watcher in foreground mode.

### Usage

```bash
jeeves-watcher start [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to configuration file |

### Examples

```bash
# Start with auto-discovered config
jeeves-watcher start

# Start with explicit config
jeeves-watcher start --config ./my-config.json

# Start from a different directory
cd /path/to/project
jeeves-watcher start
```

### Behavior

1. Loads and validates configuration
2. Connects to Qdrant (creates collection if needed)
3. Compiles inference rules
4. Performs initial filesystem scan
5. Starts file watcher
6. Starts HTTP API server
7. Runs until SIGTERM/SIGINT (Ctrl+C)

**Logs to:** stdout (or file if `logging.file` is set)

### Graceful Shutdown

On SIGTERM/SIGINT:
1. Stops accepting new file events
2. Drains in-flight operations (up to `shutdownTimeoutMs`)
3. Exits with code 0

---

## `jeeves-watcher init`

Initialize a new configuration file.

### Usage

```bash
jeeves-watcher init [options]
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `-o, --output <path>` | `jeeves-watcher.config.json` | Output file path |

### Examples

```bash
# Create default config in current directory
jeeves-watcher init

# Create config with custom name
jeeves-watcher init --output my-config.json

# Create config in a specific directory
jeeves-watcher init --output ./config/watcher.json
```

### Output

Generates a JSON config file with sensible defaults:

```json
{
  "$schema": "node_modules/@karmaniverous/jeeves-watcher/config.schema.json",
  "watch": {
    "paths": ["**/*.{md,markdown,txt,text,json,html,htm,pdf,docx}"],
    "ignored": ["**/node_modules/**", "**/.git/**", "**/.jeeves-watcher/**"]
  },
  "configWatch": {
    "enabled": true,
    "debounceMs": 1000
  },
  "embedding": {
    "provider": "gemini",
    "model": "gemini-embedding-001",
    "dimensions": 3072
  },
  "vectorStore": {
    "url": "http://127.0.0.1:6333",
    "collectionName": "jeeves-watcher"
  },
  "metadataDir": ".jeeves-watcher",
  "api": {
    "host": "127.0.0.1",
    "port": 1936
  },
  "logging": {
    "level": "info"
  }
}
```

---

## `jeeves-watcher validate`

Validate the configuration file.

### Usage

```bash
jeeves-watcher validate [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to configuration file |

### Examples

```bash
# Validate auto-discovered config
jeeves-watcher validate

# Validate specific config
jeeves-watcher validate --config ./my-config.json
```

### Output

**Success:**

```
Config valid
  Watch paths: ./docs/**/*.md, ./notes/**/*.txt
  Embedding: gemini/gemini-embedding-001
  Vector store: http://127.0.0.1:6333 (jeeves-watcher)
  API: 127.0.0.1:1936
```

**Failure:**

```
Config invalid: <error details>
```

Exit codes:
- `0` — Config is valid
- `1` — Config is invalid

---

## `jeeves-watcher status`

Show watcher service status.

### Usage

```bash
jeeves-watcher status [options]
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `-p, --port <port>` | `1936` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

### Examples

```bash
# Check status on default port
jeeves-watcher status

# Check status on custom port
jeeves-watcher status --port 1936

# Check remote instance
jeeves-watcher status --host 192.168.1.100 --port 1936
```

### Output

**Service running:**

```json
{
  "status": "ok",
  "uptime": 86400
}
```

**Service not running:**

```
Could not connect to jeeves-watcher. Is it running?
```

Exit codes:
- `0` — Service is running
- `1` — Service is not running

---

## `jeeves-watcher reindex`

Trigger a full reindex of all watched files.

### Usage

```bash
jeeves-watcher reindex [options]
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `-p, --port <port>` | `1936` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

### Examples

```bash
# Reindex on default port
jeeves-watcher reindex

# Reindex on custom port
jeeves-watcher reindex --port 1936
```

### Behavior

Sends `POST /reindex` to the API. See [API Reference](./api-reference.md#post-reindex) for details.

### Output

**Success:**

```json
{
  "ok": true,
  "filesIndexed": 1234
}
```

**Failure:**

```
<error message>
```

---

## `jeeves-watcher rebuild-metadata`

Rebuild metadata store from Qdrant payloads.

### Usage

```bash
jeeves-watcher rebuild-metadata [options]
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `-p, --port <port>` | `1936` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

### Examples

```bash
# Rebuild metadata on default port
jeeves-watcher rebuild-metadata

# Rebuild on custom port
jeeves-watcher rebuild-metadata --port 1936
```

### Behavior

Sends `POST /rebuild-metadata` to the API. See [API Reference](./api-reference.md#post-rebuild-metadata) for details.

### Output

**Success:**

```json
{
  "ok": true
}
```

---

## `jeeves-watcher search`

Search the vector store from the CLI.

### Usage

```bash
jeeves-watcher search <query> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `<query>` | Natural language search query (required) |

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `-l, --limit <limit>` | `10` | Maximum results to return |
| `-p, --port <port>` | `1936` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

### Examples

```bash
# Basic search
jeeves-watcher search "machine learning algorithms"

# Search with limit
jeeves-watcher search "billing integration" --limit 5

# Search on custom port
jeeves-watcher search "project status" --port 1936
```

### Output

**Success:**

```json
[
  {
    "id": "uuid-chunk-0",
    "score": 0.91,
    "payload": {
      "file_path": "d:/projects/ml/readme.md",
      "title": "ML Overview",
      "chunk_text": "Machine learning is..."
    }
  }
]
```

**No results:**

```json
[]
```

---

## `jeeves-watcher scan`

Scan the vector store with filter-only queries (no embedding).

### Usage

```bash
jeeves-watcher scan [options]
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `-f, --filter <filter>` | `{}` | Qdrant filter (JSON string) |
| `-l, --limit <limit>` | `100` | Max results per page |
| `-c, --cursor <cursor>` | — | Cursor from previous response |
| `--fields <fields>` | — | Payload fields to return (comma-separated) |
| `--count-only` | — | Return count only |
| `-p, --port <port>` | `1936` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

### Examples

```bash
# Count email documents
jeeves-watcher scan --filter '{"must":[{"key":"domain","match":{"value":"email"}}]}' --count-only

# List first page of slack messages (file_path only)
jeeves-watcher scan --filter '{"must":[{"key":"domain","match":{"value":"slack"}}]}' --fields file_path,domain --limit 50

# Continue with cursor from previous response
jeeves-watcher scan --filter '{"must":[{"key":"domain","match":{"value":"slack"}}]}' --cursor "next-abc123"
```

### Behavior

Sends `POST /scan` to the API. See [API Reference](./api-reference.md#post-scan) for details.

---

## `jeeves-watcher config-reindex`

Trigger a scoped reindex operation.

### Usage

```bash
jeeves-watcher config-reindex [options]
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `-s, --scope <scope>` | `issues` | Reindex scope: `issues`, `rules`, `full`, `path`, or `prune` |
| `--path <path>` | — | Target file or directory (required when scope is `path`) |
| `--dry-run` | `false` | Compute blast area plan without executing |
| `-p, --port <port>` | `1936` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

### Examples

```bash
# Re-process files with embedding failures (default)
jeeves-watcher config-reindex

# Re-apply inference rules (no re-embedding)
jeeves-watcher config-reindex --scope rules

# Full reindex (after changing embedding provider)
jeeves-watcher config-reindex --scope full

# Re-embed a specific directory
jeeves-watcher config-reindex --scope path --path j:/domains/projects

# Delete orphaned points
jeeves-watcher config-reindex --scope prune

# Preview blast area without executing
jeeves-watcher config-reindex --scope prune --dry-run
```

### Behavior

Sends `POST /config-reindex` to the API. See [API Reference](./api-reference.md#post-config-reindex) for details.

**Scopes:**
- **`issues`** — Re-process only files with embedding failures
- **`rules`** — Re-apply inference rules, update Qdrant payloads (no re-embedding)
- **`full`** — Re-extract, re-embed, re-upsert all files
- **`path`** — Re-embed a specific file or directory
- **`prune`** — Delete Qdrant points for files no longer in watch scope

### Output

**Success:**

```json
{
  "status": "started",
  "scope": "rules",
  "plan": { "total": 148000, "toProcess": 148000, "toDelete": 0, "byRoot": { ... } }
}
```

**Dry run:**

```json
{
  "status": "dry_run",
  "scope": "prune",
  "plan": { "total": 562000, "toProcess": 0, "toDelete": 2300, "byRoot": { ... } }
}
```

---

## `jeeves-watcher enrich`

Enrich document metadata from the CLI (sends `POST /metadata` to the API).

### Usage

```bash
jeeves-watcher enrich <path> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `<path>` | File path to enrich (required) |

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `-k, --key <key=value...>` | `[]` | Metadata key-value pairs (repeatable) |
| `-j, --json <json>` | — | Metadata as JSON string |
| `-p, --port <port>` | `1936` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

### Examples

```bash
# Set metadata via key-value pairs
jeeves-watcher enrich ./docs/readme.md --key title="Project Overview" --key priority=high

# Set metadata via JSON
jeeves-watcher enrich ./docs/readme.md --json '{"title": "Project Overview", "labels": ["important"]}'

# Combine both (JSON is applied first, then key-value pairs override)
jeeves-watcher enrich ./docs/readme.md --json '{"category": "docs"}' --key priority=high
```

### Behavior

Sends `POST /metadata` with `{ path, metadata }` to the running watcher API. At least one of `--key` or `--json` must be provided.

---

## `jeeves-watcher service`

Manage the watcher as a system service (Windows: NSSM, Linux: systemd).

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `install` | Print service installation instructions |
| `uninstall` | Print service uninstall instructions |

---

### `jeeves-watcher service install`

Print installation instructions for a system service.

#### Usage

```bash
jeeves-watcher service install [options]
```

#### Options

| Option | Default | Description |
|--------|---------|-------------|
| `-c, --config <path>` | Auto-discovered | Path to configuration file |
| `-n, --name <name>` | `jeeves-watcher` | Service name |

#### Examples

**Windows (NSSM):**

```bash
jeeves-watcher service install
```

Output:

```
NSSM install (example):
  nssm install jeeves-watcher node "%CD%\node_modules\@karmaniverous\jeeves-watcher\dist\cli\jeeves-watcher\index.js" start
  nssm set jeeves-watcher AppDirectory "%CD%"
  nssm set jeeves-watcher Start SERVICE_AUTO_START
  nssm start jeeves-watcher
```

**Linux (systemd):**

```bash
jeeves-watcher service install
```

Output:

```
# systemd unit file
# ~/.config/systemd/user/jeeves-watcher.service

[Unit]
Description=Jeeves Watcher
After=network.target

[Service]
Type=simple
WorkingDirectory=%h
ExecStart=/usr/bin/env jeeves-watcher start
Restart=on-failure

[Install]
WantedBy=default.target

# install
  systemctl --user daemon-reload
  systemctl --user enable --now jeeves-watcher.service
```

**With custom config:**

```bash
jeeves-watcher service install --config ./my-config.json
```

---

### `jeeves-watcher service uninstall`

Print uninstall instructions for a system service.

#### Usage

```bash
jeeves-watcher service uninstall [options]
```

#### Options

| Option | Default | Description |
|--------|---------|-------------|
| `-n, --name <name>` | `jeeves-watcher` | Service name |

#### Examples

**Windows (NSSM):**

```bash
jeeves-watcher service uninstall
```

Output:

```
NSSM uninstall (example):
  nssm stop jeeves-watcher
  nssm remove jeeves-watcher confirm
```

**Linux (systemd):**

```bash
jeeves-watcher service uninstall
```

Output:

```
# systemd uninstall
  systemctl --user disable --now jeeves-watcher.service
# remove ~/.config/systemd/user/jeeves-watcher.service
  systemctl --user daemon-reload
```

---

## `jeeves-watcher query`

Query the merged configuration document using JSONPath.

### Usage

```bash
jeeves-watcher query '<jsonpath>' [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `<jsonpath>` | JSONPath expression (required) |

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--resolve <scopes>` | all | Comma-separated resolution scopes: `files`, `globals` |
| `-p, --port <port>` | `1936` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

### Examples

```bash
# List all rule names
jeeves-watcher query '$.inferenceRules[*].name'

# Query with specific resolution scopes
jeeves-watcher query '$.values' --resolve files,globals
```

### Behavior

Sends `POST /config/query` to the API. See [API Reference](./api-reference.md#post-configquery) for details.

---

## `jeeves-watcher issues`

Show runtime embedding failures and processing errors.

### Usage

```bash
jeeves-watcher issues [options]
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `-p, --port <port>` | `1936` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

### Behavior

Sends `GET /issues` to the API. See [API Reference](./api-reference.md#get-issues) for details.

---

## `jeeves-watcher helpers`

Show a formatted reference of all loaded map and template helpers.

### Usage

```bash
jeeves-watcher helpers [options]
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `-p, --port <port>` | `1936` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

---

## `jeeves-watcher config-apply`

Atomically validate, write, and reload configuration from a file.

### Usage

```bash
jeeves-watcher config-apply --file <path> [options]
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `-f, --file <path>` | **Required** | Path to config JSON file to apply |
| `-p, --port <port>` | `1936` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

### Examples

```bash
# Apply config changes from file
jeeves-watcher config-apply --file ./updated-config.json
```

### Behavior

Sends `POST /config/apply` to the API. See [API Reference](./api-reference.md#post-configapply) for details.

---

## Configuration Discovery

When `--config` is not provided, the CLI uses [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig) to search for configuration (from current directory upward):

- `jeeves-watcher` property in `package.json`
- `.jeeves-watcherrc` (JSON or YAML)
- `.jeeves-watcherrc.json`, `.jeeves-watcherrc.yaml`, `.jeeves-watcherrc.yml`
- `.jeeves-watcherrc.js`, `.jeeves-watcherrc.ts`, `.jeeves-watcherrc.cjs`
- `jeeves-watcher.config.js`, `jeeves-watcher.config.ts`, `jeeves-watcher.config.cjs`

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (invalid config, connection failure, etc.) |

---

## Examples: Common Workflows

### Initial Setup

```bash
# 1. Initialize config
jeeves-watcher init

# 2. Edit config (set watch paths, embedding provider, etc.)
vim jeeves-watcher.config.json

# 3. Validate config
jeeves-watcher validate

# 4. Start watcher
jeeves-watcher start
```

### Search and Inspect

```bash
# Search for documents
jeeves-watcher search "architecture discussion" --limit 5

# Check service status
jeeves-watcher status

# View logs (if logging.file is set)
tail -f ./logs/watcher.log
```

### After Config Changes

```bash
# Edit inference rules
vim jeeves-watcher.config.json

# Reindex metadata (no re-embedding)
jeeves-watcher config-reindex --scope rules

# Or manually restart (auto-reindex on startup)
# (stop with Ctrl+C, then restart)
jeeves-watcher start
```

### Production Deployment

```bash
# Install as service (follow printed instructions)
jeeves-watcher service install --config /path/to/config.json

# Verify service is running
jeeves-watcher status

# Check logs
tail -f /var/log/jeeves-watcher.log
```

---

## Next Steps

- [API Reference](./api-reference.md) — HTTP equivalents for CLI commands
- [Configuration Reference](./configuration.md) — All config options
- [Deployment Guide](./deployment.md) — Production setup
