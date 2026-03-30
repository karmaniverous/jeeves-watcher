---
title: CLI Reference
---

# CLI Reference

Complete reference for all `jeeves-watcher` CLI commands.

The CLI is built via `createServiceCli` from `@karmaniverous/jeeves` core, providing standard commands (`start`, `status`, `config`, `init`, `service`), plus domain-specific commands registered by the watcher descriptor.

---

## Standard Commands (from core)

### `jeeves-watcher start`

Start the filesystem watcher in foreground mode.

```bash
jeeves-watcher start -c <config-path>
```

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to configuration file (required) |

**Behavior:** Loads config, connects to Qdrant, performs initial filesystem scan, starts the HTTP API server. Runs until SIGTERM/SIGINT.

---

### `jeeves-watcher status`

Probe service health and version.

```bash
jeeves-watcher status [-p <port>]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-p, --port <port>` | `1936` | API port |

**Output:** JSON response from `GET /status` with `name`, `version`, `uptime`, `status`, and `health` (containing `collection`, `reindex`, `initialScan`).

---

### `jeeves-watcher config`

Query the effective runtime config via JSONPath.

```bash
jeeves-watcher config [jsonpath] [-p <port>]
```

| Argument | Description |
|----------|-------------|
| `[jsonpath]` | Optional JSONPath expression to filter results |

| Option | Default | Description |
|--------|---------|-------------|
| `-p, --port <port>` | `1936` | API port |

**Examples:**
```bash
# Full config
jeeves-watcher config

# List rule names
jeeves-watcher config '$.inferenceRules[*].name'
```

---

### `jeeves-watcher config validate`

Validate a config file against the Zod schema.

```bash
jeeves-watcher config validate -c <config-path>
```

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to config file to validate (required) |

---

### `jeeves-watcher config apply`

Apply a config patch to the running service.

```bash
jeeves-watcher config apply [-p <port>] [-f <file>] [--replace]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-p, --port <port>` | `1936` | API port |
| `-f, --file <path>` | stdin | Config patch file (JSON) |
| `--replace` | `false` | Replace entire config instead of merging |

---

### `jeeves-watcher init`

Generate a default configuration file.

```bash
jeeves-watcher init [-o <path>]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-o, --output <path>` | Component config dir | Output directory |

---

### `jeeves-watcher service`

System service management (Windows: NSSM, Linux: systemd).

| Subcommand | Description |
|------------|-------------|
| `install` | Install as a system service |
| `uninstall` | Uninstall the system service |
| `start` | Start the system service |
| `stop` | Stop the system service |
| `restart` | Restart the system service |
| `status` | Query system service state |

All subcommands accept `-n, --name <name>` (default: `jeeves-watcher`).
`install` also accepts `-c, --config <path>`.

---

## Domain-Specific Commands

### `jeeves-watcher search`

Search the vector store.

```bash
jeeves-watcher search <query> [-l <limit>] [-p <port>] [-H <host>]
```

| Argument | Description |
|----------|-------------|
| `<query>` | Natural language search query (required) |

| Option | Default | Description |
|--------|---------|-------------|
| `-l, --limit <limit>` | `10` | Maximum results |
| `-p, --port <port>` | `1936` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

---

### `jeeves-watcher enrich`

Enrich document metadata.

```bash
jeeves-watcher enrich <path> [-k <key=value>...] [-j <json>] [-p <port>] [-H <host>]
```

| Argument | Description |
|----------|-------------|
| `<path>` | File path to enrich (required) |

| Option | Default | Description |
|--------|---------|-------------|
| `-k, --key <key=value...>` | `[]` | Key-value pairs (repeatable) |
| `-j, --json <json>` | — | Metadata as JSON string |
| `-p, --port <port>` | `1936` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

At least one of `--key` or `--json` is required.

---

### `jeeves-watcher scan`

Filter-only point query (no embedding cost).

```bash
jeeves-watcher scan [-f <filter>] [-l <limit>] [-c <cursor>] [--fields <f1,f2>] [--count-only] [-p <port>] [-H <host>]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-f, --filter <filter>` | `{}` | Qdrant filter (JSON string) |
| `-l, --limit <limit>` | `100` | Page size (max 1000) |
| `-c, --cursor <cursor>` | — | Cursor from previous response |
| `--fields <fields>` | — | Payload fields to return (comma-separated) |
| `--count-only` | `false` | Return count only |
| `-p, --port <port>` | `1936` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

---

### `jeeves-watcher reindex`

Trigger a scoped reindex operation.

```bash
jeeves-watcher reindex [-s <scope>] [-t <path>...] [-p <port>] [-H <host>]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-s, --scope <scope>` | `rules` | Scope: `issues`, `rules`, `full`, `path`, `prune` |
| `-t, --path <paths...>` | — | Target paths (required for `path` scope) |
| `-p, --port <port>` | `1936` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

**Scopes:**
- `rules` — Re-apply inference rules (no re-embedding)
- `full` — Re-extract + re-embed everything
- `issues` — Re-process only files with failures
- `path` — Re-embed specific file(s) or directory
- `prune` — Delete orphaned points

---

### `jeeves-watcher rebuild-metadata`

Rebuild enrichment store from Qdrant payloads.

```bash
jeeves-watcher rebuild-metadata [-p <port>] [-H <host>]
```

---

### `jeeves-watcher issues`

List current processing issues.

```bash
jeeves-watcher issues [-p <port>] [-H <host>]
```

---

### `jeeves-watcher helpers`

List loaded map and template helpers with descriptions.

```bash
jeeves-watcher helpers [-p <port>] [-H <host>]
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (invalid config, connection failure, etc.) |

---

## Next Steps

- [API Reference](./api-reference.md) — HTTP equivalents for CLI commands
- [Configuration Reference](./configuration.md) — All config options
- [Deployment Guide](./deployment.md) — Production setup
