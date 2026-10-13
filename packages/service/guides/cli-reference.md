---
title: CLI Reference
---

# CLI Reference

Complete reference for all `jeeves-watcher` CLI commands.

The CLI is built via `createServiceCli` from `@karmaniverous/jeeves` core, providing standard commands (`start`, `status`, `config`, `init`, `service`), plus domain-specific commands registered by the watcher descriptor. The watcher replaces the actions of `config` and `config apply` so they send the API key and report errors like the other API commands.

Commands that call the API address `127.0.0.1:1936` by default (the service's default `api.host` and `api.port`).

---

## Standard Commands (from core)

### `jeeves-watcher start`

Start the filesystem watcher in foreground mode.

```bash
jeeves-watcher start -c <config-path> [-w <path>] [--config-root <path>]
```

| Option                   | Default    | Description                      |
| ------------------------ | ---------- | -------------------------------- |
| `-c, --config <path>`    | (required) | Path to the configuration file   |
| `-w, --workspace <path>` | `.`        | Jeeves workspace root path       |
| `--config-root <path>`   | `./config` | Jeeves platform config root path |

**Behavior:** Loads and validates the config file (JSON, YAML or JavaScript; `${ENV_VAR}` references are substituted), creates the embedding provider, connects to Qdrant and creates the collection if missing, starts the HTTP API server, then starts the filesystem watcher, whose initial scan indexes new and changed files. Runs until SIGTERM/SIGINT, then shuts down gracefully (see `shutdownTimeoutMs`).

Non-fatal config warnings (unknown keys under `sources.<name>`, rule schema properties named like reserved system fields) are printed to the console at startup as `[jeeves-watcher] <path>: <message>`.

---

### `jeeves-watcher status`

Probe service health and version.

```bash
jeeves-watcher status [-p <port>]
```

| Option              | Default | Description |
| ------------------- | ------- | ----------- |
| `-p, --port <port>` | `1936`  | API port    |

Always addresses `127.0.0.1`.

**Output:** JSON response from `GET /status` with `name`, `version`, `uptime`, `status`, and `health` (containing `collection`, `reindex` and `initialScan`). When the service cannot be reached (or answers with an error), prints `Service unreachable: <message>` and exits with code `1`.

---

### `jeeves-watcher config`

Query the effective runtime config via JSONPath.

```bash
jeeves-watcher config [jsonpath] [-p <port>]
```

| Argument     | Description                                    |
| ------------ | ---------------------------------------------- |
| `[jsonpath]` | Optional JSONPath expression to filter results |

| Option | Default | Description |
| --- | --- | --- |
| `-p, --port <port>` | `1936` | API port |
| `--api-key <key>` | env | API bearer key (see [Authentication](#authentication)) |

Always addresses `127.0.0.1` (there is no `--host` option).

**Output:** the JSON response of `GET /config` (`{ "result": [...], "count": <n> }`). On failure prints `Config query failed: <message>` (for example `Config query failed: HTTP 400 invalid_request: ...`; see [Output and Errors](#output-and-errors)) and exits with code `1`.

**Examples:**

```bash
# Full config
jeeves-watcher config

# List rule names
jeeves-watcher config '$.inferenceRules[*].name'
```

---

### `jeeves-watcher config validate`

Validate a config file against the Zod schema. Makes no API call.

```bash
jeeves-watcher config validate -c <config-path>
```

| Option                | Description                                |
| --------------------- | ------------------------------------------ |
| `-c, --config <path>` | Path to config file to validate (required) |

The file is parsed as JSON and checked against the config schema only: `${ENV_VAR}` references are not substituted, rule and schema file references are not loaded, and rule schemas are not merged. Prints `Config is valid.`, or `Validation failed: <message>` and exits with code `1`. For the deeper checks (merged rule schemas, helper files, reserved field warnings, test paths) use [`POST /config/validate`](./api-reference.md#post-configvalidate) on a running service.

---

### `jeeves-watcher config apply`

Apply a config patch to the running service (`POST /config/apply` on `127.0.0.1`).

```bash
jeeves-watcher config apply [-p <port>] [-f <file>] [--replace]
```

| Option | Default | Description |
| --- | --- | --- |
| `-p, --port <port>` | `1936` | API port |
| `-f, --file <path>` | stdin | Config patch file (JSON) |
| `--replace` | `false` | Replace entire config instead of merging |
| `--api-key <key>` | env | API bearer key (see [Authentication](#authentication)) |

Without `-f`, the patch is read from stdin. The patch must be a JSON object; empty input means `{}`. It is sent as `{ "patch": <patch> }`, plus `"replace": true` with `--replace`. An unreadable file, invalid JSON or a non-object patch prints a one-line `Config apply failed: ...` (for example `cannot read patch file patch.json (ENOENT)`, `patch is not valid JSON (...)`, `patch must be a JSON object`) and exits with code `1`; nothing is sent to the service.

**Output:** the JSON response of [`POST /config/apply`](./api-reference.md#post-configapply). An HTTP error prints `Config apply failed: HTTP <status> <code>: <message>` (see [Output and Errors](#output-and-errors)) and exits with code `1`.

```bash
echo '{ "configWatch": { "reindex": "rules" } }' | jeeves-watcher config apply
jeeves-watcher config apply -f patch.json
```

---

### `jeeves-watcher init`

Generate a default configuration file. Makes no API call.

```bash
jeeves-watcher init -o <dir>
```

| Option               | Description      |
| -------------------- | ---------------- |
| `-o, --output <dir>` | Output directory |

Creates `<dir>` if needed and writes `<dir>/config.json` from the default template (see [Getting Started](./getting-started.md#initialize-configuration)), printing `Config written to <path>`. An existing file is left untouched (`Config already exists at <path>`).

Pass `-o`: without it the command tries to use the platform component config directory, which `init` does not resolve, and fails with `jeeves-core: init() must be called first`.

---

### `jeeves-watcher service`

System service management (Windows: NSSM, Linux: systemd, macOS: launchd). Makes no API call.

| Subcommand  | Description                  |
| ----------- | ---------------------------- |
| `install`   | Install as a system service  |
| `uninstall` | Uninstall the system service |
| `start`     | Start the system service     |
| `stop`      | Stop the system service      |
| `restart`   | Restart the system service   |
| `status`    | Query system service state   |

All subcommands accept `-n, --name <name>` (default: `jeeves-watcher`). `install` also accepts `-c, --config <path>`: the installed service runs the watcher's `start -c <path>`. Pass it; without it, `install` fails for the same reason as `init` without `-o`.

- **Windows:** registers the service with `nssm` (must be on `PATH`); output goes to `<home>/<name>.log`.
- **Linux:** writes a systemd user unit `~/.config/systemd/user/<name>.service`. When a system unit of that name already exists, `install` does nothing and the other subcommands manage the system unit.
- **macOS:** writes a launchd agent `~/Library/LaunchAgents/<name>.plist`.

Each subcommand prints a one-line result (for example `Service "jeeves-watcher" installed.`; `status` prints `Service "<name>": <state>`). A failure prints `<Action> failed: <message>` and exits with code `1`.

---

## Authentication

When the service sets `api.apiKey`, every API route except `GET /status` needs `Authorization: Bearer <key>` (see [Authentication](./api-reference.md#authentication)). Every command that calls a protected route (`config`, `config apply` and every domain-specific command below) sends it, resolving the key in this order:

1. `--api-key <key>`
2. the `JEEVES_WATCHER_API_KEY` environment variable

With neither set, no `Authorization` header is sent (the right choice when the service has no key). These commands do not read the watcher config file, so `api.apiKey` there is not used. Prefer the environment variable: a `--api-key` value is visible in the process list and shell history. The key is never printed. A `401` exits with code `1` and a message saying how to supply (or check) the key.

`status` needs no key and takes no `--api-key` option. `config validate`, `init` and `service` make no API calls.

```bash
export JEEVES_WATCHER_API_KEY=...
jeeves-watcher search "password reset"
```

---

## Domain-Specific Commands

All commands in this section accept `--api-key <key>` (see [Authentication](#authentication)) in addition to the options listed.

### Output and Errors

Every domain-specific command prints the JSON response body, pretty-printed, on stdout (`helpers` prints text). Errors go to stderr and set exit code `1`:

- An HTTP error prints `HTTP <status> <code>: <message>`, where `<code>` is the server's error code (for example `HTTP 400 invalid_request: Exactly one of path or source is required when scope is "path"`). Responses from older servers or proxies without a canonical body fall back to the body's `code` or `error`, else `http_<status>`.
- A `401` prints guidance instead: `HTTP 401 unauthorized: the watcher API requires an API key. Provide it via ...` when no key was sent, or `... rejected the API key. Check ... against the service's api.apiKey.` when one was.
- A connection failure prints the underlying error message (for example `fetch failed`).

### `jeeves-watcher search`

Search the vector store (`POST /search`).

```bash
jeeves-watcher search <query> [-l <limit>] [-p <port>] [-H <host>]
```

| Argument  | Description                              |
| --------- | ---------------------------------------- |
| `<query>` | Natural language search query (required) |

| Option                | Default     | Description     |
| --------------------- | ----------- | --------------- |
| `-l, --limit <limit>` | `10`        | Maximum results |
| `-p, --port <port>`   | `1936`      | API port        |
| `-H, --host <host>`   | `127.0.0.1` | API host        |

---

### `jeeves-watcher enrich`

Enrich a file's metadata (`POST /metadata` with `{ path, metadata }`). Source documents cannot be enriched from the CLI; use the API.

```bash
jeeves-watcher enrich <path> [-k <key=value>...] [-j <json>] [-p <port>] [-H <host>]
```

| Argument | Description                    |
| -------- | ------------------------------ |
| `<path>` | File path to enrich (required) |

| Option                     | Default     | Description                  |
| -------------------------- | ----------- | ---------------------------- |
| `-k, --key <key=value...>` | `[]`        | Key-value pairs (repeatable) |
| `-j, --json <json>`        | —           | Metadata as JSON string      |
| `-p, --port <port>`        | `1936`      | API port                     |
| `-H, --host <host>`        | `127.0.0.1` | API host                     |

At least one of `--key` or `--json` is required. `--key` values are strings and are applied after `--json` (they win on conflict). Invalid input prints `Invalid JSON: <json>`, `Invalid key-value pair: <pair>` or `No metadata provided. Use --key or --json.` and exits with code `1` without calling the API.

---

### `jeeves-watcher scan`

Filter-only point query (`POST /scan`, no embedding cost).

```bash
jeeves-watcher scan [-f <filter>] [-l <limit>] [-c <cursor>] [--fields <f1,f2>] [--count-only] [-p <port>] [-H <host>]
```

| Option | Default | Description |
| --- | --- | --- |
| `-f, --filter <filter>` | `{}` | Qdrant filter (JSON string) |
| `-l, --limit <limit>` | `100` | Page size (max 1000) |
| `-c, --cursor <cursor>` | — | Cursor from previous response |
| `--fields <fields>` | — | Payload fields to return (comma-separated) |
| `--count-only` | `false` | Return count only |
| `-p, --port <port>` | `1936` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

---

### `jeeves-watcher reindex`

Trigger a scoped reindex operation (`POST /reindex`).

```bash
jeeves-watcher reindex [-s <scope>] [-t <path>...] [-p <port>] [-H <host>]
```

| Option | Default | Description |
| --- | --- | --- |
| `-s, --scope <scope>` | `rules` | Scope: `issues`, `full`, `rules`, `path`, `prune` |
| `-t, --path <paths...>` | — | Target file paths or globs: required for `path`, optional for `rules` (narrows it to matching files) |
| `-p, --port <port>` | `1936` | API port |
| `-H, --host <host>` | `127.0.0.1` | API host |

**Scopes:**

- `rules` — Re-apply inference rules (no re-embedding)
- `full` — Re-extract every watched file (files whose embedded text is unchanged are skipped by content hash) and re-embed every indexed source document; clears the values index first
- `issues` — Re-process only documents with failures (files, and source references with open issues)
- `path` — Re-process specific file(s) or directory (content hash still applies)
- `prune` — Delete orphaned points

The CLI default scope is `rules`; the API's default (when `scope` is omitted) is `issues`. An unknown scope prints `Invalid scope "<scope>". Must be one of: issues, full, rules, path, prune` and exits with code `1` without calling the API. The CLI sends one path as a string and several as an array; it has no option for source references or `dryRun` (use [`POST /reindex`](./api-reference.md#post-reindex)). The command prints the `{ status, scope, plan }` response as soon as the reindex starts (`plan` is omitted for a live prune).

---

### `jeeves-watcher rebuild-metadata`

Rebuild the enrichment store from file point payloads, minus the reserved system fields (`POST /rebuild-metadata`). Prints `{ "ok": true }`.

```bash
jeeves-watcher rebuild-metadata [-p <port>] [-H <host>]
```

---

### `jeeves-watcher issues`

List current processing issues (`GET /issues`).

```bash
jeeves-watcher issues [-p <port>] [-H <host>]
```

---

### `jeeves-watcher helpers`

List loaded map and template helpers with descriptions (read through `GET /config`). Prints a `JsonMap lib functions:` and a `Handlebars helpers:` section, or `No helpers configured.`

```bash
jeeves-watcher helpers [-p <port>] [-H <host>]
```

---

## Exit Codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Error (invalid config, connection failure, HTTP error, invalid arguments) |

---

## Next Steps

- [API Reference](./api-reference.md) — HTTP equivalents for CLI commands
- [Configuration Reference](./configuration.md) — All config options
- [Deployment Guide](./deployment.md) — Production setup
