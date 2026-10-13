---
title: Getting Started
---

# Getting Started

This guide walks you through installing and configuring `jeeves-watcher` from scratch.

## Prerequisites

- **Node.js 22.13+** (Node.js 24+ recommended; enrichment storage uses the built-in `node:sqlite` module, so no native build tools are needed)
- **Qdrant** running locally or accessible via network
  - Installation: See [Deployment Guide](./deployment.md#qdrant-setup)
  - Default URL: `http://localhost:6333`

## Installation

Install globally via npm:

```bash
npm install -g @karmaniverous/jeeves-watcher
```

Or add to a project:

```bash
npm install --save-dev @karmaniverous/jeeves-watcher
```

## Initialize Configuration

Create a new configuration file:

```bash
jeeves-watcher init -o ./jeeves-watcher
```

This creates the directory if needed and writes `./jeeves-watcher/config.json` (an existing file is left untouched). The file has sensible defaults and a `$schema` pointer for IDE autocomplete:

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
    "dimensions": 768
  },
  "vectorStore": {
    "url": "http://127.0.0.1:6333",
    "collectionName": "jeeves-watcher"
  },
  "stateDir": ".jeeves-metadata",
  "api": {
    "host": "127.0.0.1",
    "port": 1936,
    "cacheTtlMs": 30000
  },
  "logging": {
    "level": "info"
  }
}
```

`stateDir` holds the watcher's persistent state: the issues file, the values index and the enrichment store (`enrichments.sqlite`). Relative `stateDir` and watch globs resolve against the watcher's working directory. Watch globs match dot-directories too, and the template's `watch.ignored` does not cover the default `stateDir`: when the watch globs reach the working directory, add `"**/.jeeves-metadata/**"` to `watch.ignored` (or move `stateDir` outside the watched paths) so state files such as `issues.json` are not indexed. `embedding.dimensions` must match the existing Qdrant collection, if there is one.

> **Set `dimensions` to `3072` for Gemini.** The template's `768` does not match `gemini-embedding-001`, which returns 3072-dimensional vectors (the watcher does not request a smaller output size), so with the template value every embedding fails with `Gemini embedding returned invalid dimensions`. Change it before the first start, so the collection is created with the right size.

## Configure Watch Paths

Edit the `watch.paths` array to specify which directories to monitor. Use glob patterns for flexible matching:

```json
{
  "watch": {
    "paths": [
      "./docs/**/*.md",
      "./notes/**/*.{md,txt}",
      "./projects/**/*.{md,json,pdf}"
    ],
    "ignored": ["**/node_modules/**", "**/.git/**", "**/temp/**"]
  }
}
```

**Glob syntax:**

- `**` — matches any number of directories
- `*` — matches any characters within a filename
- `{md,txt}` — brace expansion for multiple extensions

## Set Up Embedding Provider

### Google Gemini (Default)

Set your API key as an environment variable:

```bash
# Windows (PowerShell)
$env:GOOGLE_API_KEY = "your-api-key-here"

# Linux/macOS
export GOOGLE_API_KEY="your-api-key-here"
```

The Gemini provider requires `embedding.apiKey`. Add it to the config as an environment variable reference:

```json
{
  "embedding": {
    "provider": "gemini",
    "model": "gemini-embedding-001",
    "apiKey": "${GOOGLE_API_KEY}"
  }
}
```

**Note:** Set templates in inference rules use Handlebars `{{...}}` syntax (e.g. `{{frontmatter.title}}`), which is distinct from the `${...}` environment variable syntax used in config values like `embedding.apiKey`.

Or hardcode the key (not recommended for committed configs):

```json
{
  "embedding": {
    "apiKey": "AIza..."
  }
}
```

### Mock Provider (Testing)

For testing without API costs, use the mock provider:

```json
{
  "embedding": {
    "provider": "mock",
    "dimensions": 3072
  }
}
```

The mock provider generates deterministic embeddings from content hashes, of any size. Keep `dimensions` equal to the collection's vector size.

## Config File Location

The CLI always takes the config path explicitly: `start`, `config validate` and `service install` all use `-c <path>`. The file may be JSON, YAML or JavaScript when loaded by `start`; `config validate` reads JSON only.

Only programmatic use without a path (`startFromConfig()` or `loadConfig()` with no argument) searches for a config: it first moves a legacy `jeeves-watcher.config.json` in the working directory to `jeeves-watcher/config.json` and loads that, otherwise [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig) searches the working directory (not its parents) for a `jeeves-watcher` property in `package.json`, `.jeeves-watcherrc` (JSON or YAML), `.jeeves-watcherrc.{json,yaml,yml,js,ts,cjs,mjs}`, the same files without the leading dot under `.config/` (for example `.config/jeeves-watcherrc.json`), or `jeeves-watcher.config.{js,ts,cjs,mjs}`.

## Validate Configuration

Check that your configuration file matches the schema:

```bash
jeeves-watcher config validate -c ./jeeves-watcher/config.json
```

Output:

```
Config is valid.
```

On failure it prints `Validation failed: <message>` and exits with code `1`. This is a schema check only: `${ENV_VAR}` references are not substituted and rule schemas are not merged. Once the watcher is running, [`POST /config/validate`](./api-reference.md#post-configvalidate) runs the full checks.

## Start the Watcher

Run in foreground (for development):

```bash
jeeves-watcher start -c ./jeeves-watcher/config.json
```

The watcher will:

1. Load and validate the config (warnings, such as a rule property named like a reserved system field, are printed as `[jeeves-watcher] <path>: <message>`)
2. Connect to Qdrant and create the collection if it does not exist
3. Start the HTTP API server
4. Start the filesystem watcher, whose initial scan indexes new files and files with changed content
5. Keep monitoring for filesystem changes (and, with `configWatch.enabled`, for config file changes)

Logs are JSON lines (pino) on stdout, or in `logging.file` when set. Look for messages such as `jeeves-watcher started`, `File processed successfully` (with `filePath` and `chunks`) and `Initial scan complete`.

## First Search

With the watcher running, try a search:

```bash
jeeves-watcher search "machine learning" --limit 5
```

Or via HTTP:

```bash
curl -X POST http://127.0.0.1:1936/search \
  -H "Content-Type: application/json" \
  -d '{"query": "machine learning", "limit": 5}'
```

## Run as a Service

For production deployment, install as a system service. See [Deployment Guide](./deployment.md) for detailed instructions.

```bash
jeeves-watcher service install -c /path/to/jeeves-watcher/config.json
jeeves-watcher service start
```

`install` registers a service named `jeeves-watcher` (change it with `-n`) that runs `start -c <path>`: an NSSM service on Windows (`nssm` must be on `PATH`), a systemd user unit on Linux, a launchd agent on macOS. Pass an absolute config path. See the `jeeves-watcher service` section of the [CLI Reference](./cli-reference.md#standard-commands-from-core) for every subcommand.

## Enable Version Tracking

To track file history with git-backed versioning, add the `vcs` block to your config:

```json
{
  "vcs": {
    "enabled": true
  }
}
```

The watcher will initialize a git repository in each watch root and automatically commit file changes in throttled batches. No other setup is required, but git must be installed and on `PATH`.

See the [Version Control (VCS) Guide](./version-control.md) for full details on configuration, remote push, squash retention, and reversion.

## Next Steps

- [Configuration Reference](./configuration.md) — Full config options
- [Inference Rules](./inference-rules.md) — Automatic metadata enrichment
- [API Reference](./api-reference.md) — HTTP endpoints
- [CLI Reference](./cli-reference.md) — All CLI commands
- [Deployment Guide](./deployment.md) — Production setup
