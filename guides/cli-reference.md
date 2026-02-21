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
  "watch": {
    "paths": ["**/*.{md,markdown,txt,text,json,html,htm,pdf,docx}"],
    "ignored": ["**/node_modules/**", "**/.git/**", "**/.jeeves-watcher/**"]
  },
  "embedding": {
    "provider": "gemini",
    "model": "gemini-embedding-001"
  },
  "vectorStore": {
    "url": "http://127.0.0.1:6333",
    "collectionName": "jeeves-watcher"
  },
  "metadataDir": ".jeeves-watcher",
  "api": {
    "host": "127.0.0.1",
    "port": 3456
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
  API: 127.0.0.1:3456
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
| `-p, --port <port>` | `3456` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

### Examples

```bash
# Check status on default port
jeeves-watcher status

# Check status on custom port
jeeves-watcher status --port 3456

# Check remote instance
jeeves-watcher status --host 192.168.1.100 --port 3456
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
| `-p, --port <port>` | `3456` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

### Examples

```bash
# Reindex on default port
jeeves-watcher reindex

# Reindex on custom port
jeeves-watcher reindex --port 3456
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
| `-p, --port <port>` | `3456` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

### Examples

```bash
# Rebuild metadata on default port
jeeves-watcher rebuild-metadata

# Rebuild on custom port
jeeves-watcher rebuild-metadata --port 3456
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
| `-p, --port <port>` | `3456` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

### Examples

```bash
# Basic search
jeeves-watcher search "machine learning algorithms"

# Search with limit
jeeves-watcher search "billing integration" --limit 5

# Search on custom port
jeeves-watcher search "project status" --port 3456
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

## `jeeves-watcher config-reindex`

Reindex after configuration changes.

### Usage

```bash
jeeves-watcher config-reindex [options]
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `-s, --scope <scope>` | `rules` | Reindex scope: `rules` (metadata-only) or `full` (re-embed) |
| `-p, --port <port>` | `3456` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

### Examples

```bash
# Metadata-only reindex (after editing inference rules)
jeeves-watcher config-reindex

# Full reindex (after changing embedding provider)
jeeves-watcher config-reindex --scope full
```

### Behavior

Sends `POST /config-reindex` to the API. See [API Reference](./api-reference.md#post-config-reindex) for details.

**Scope: `rules`**
- Re-applies inference rules to all files
- Updates Qdrant payloads (no re-embedding)

**Scope: `full`**
- Re-extracts, re-embeds, re-upserts all files

### Output

**Success:**

```json
{
  "status": "started",
  "scope": "rules"
}
```

---

## `jeeves-watcher enrich`

*(Not yet implemented — planned for future release)*

Enrich document metadata from the CLI.

### Planned Usage

```bash
jeeves-watcher enrich <path> --title "..." --labels "a,b" --author "..."
```

**Workaround:** Use `POST /metadata` via `curl`:

```bash
curl -X POST http://localhost:3456/metadata \
  -H "Content-Type: application/json" \
  -d '{"path": "d:/file.md", "metadata": {"title": "..."}}'
```

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

## Configuration Discovery

When `--config` is not provided, the CLI searches in this order:

1. `JEEVES_WATCHER_CONFIG` environment variable
2. `./jeeves-watcher.config.json` (current directory)
3. `~/.jeeves-watcher/config.json` (user home)

**Supported formats:** JSON, JSON5, YAML (`.yaml` or `.yml` extension)

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
