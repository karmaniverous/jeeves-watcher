---
title: Getting Started
---

# Getting Started

This guide walks you through installing and configuring `jeeves-watcher` from scratch.

## Prerequisites

- **Node.js 20+** (Node.js 24+ recommended)
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
jeeves-watcher init
```

This generates `jeeves-watcher.config.json` with sensible defaults and a `$schema` pointer for IDE autocomplete:

```json
{
  "$schema": "node_modules/@karmaniverous/jeeves-watcher/config.schema.json",
  "watch": {
    "paths": ["**/*.{md,markdown,txt,text,json,html,htm,pdf,docx}"],
    "ignored": ["**/node_modules/**", "**/.git/**", "**/.jeeves-watcher/**"]
  },
  "configWatch": {
    "enabled": true
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
    "ignored": [
      "**/node_modules/**",
      "**/.git/**",
      "**/temp/**"
    ]
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

The config references it via template syntax:

```json
{
  "embedding": {
    "provider": "gemini",
    "model": "gemini-embedding-001",
    "apiKey": "${GOOGLE_API_KEY}"
  }
}
```

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

The mock provider generates deterministic embeddings from content hashes.

## Configuration Discovery

If you don't specify `--config`, the watcher searches for a config file in this order:

1. `JEEVES_WATCHER_CONFIG` environment variable
2. `./jeeves-watcher.config.json` (current directory)
3. `~/.jeeves-watcher/config.json` (user home)

Supported formats: JSON, JSON5, YAML (`.yaml` or `.yml` extension).

## Validate Configuration

Check that your configuration is valid:

```bash
jeeves-watcher validate
```

Output:

```
Config valid
  Watch paths: ./docs/**/*.md, ./notes/**/*.{md,txt}
  Embedding: gemini/gemini-embedding-001
  Vector store: http://127.0.0.1:6333 (jeeves-watcher)
  API: 127.0.0.1:3456
```

## Start the Watcher

Run in foreground (for development):

```bash
jeeves-watcher start
```

The watcher will:
1. Connect to Qdrant and ensure the collection exists
2. Scan all watched paths for existing files
3. Index new files or files with changed content
4. Start monitoring for filesystem changes
5. Start the HTTP API server

You should see output like:

```
[info] Qdrant collection ready: jeeves-watcher
[info] Initial scan: 42 files to process
[info] File processed successfully: ./docs/readme.md (chunks: 2)
[info] File processed successfully: ./notes/meeting-2026-02-20.md (chunks: 1)
...
[info] API server listening on http://127.0.0.1:3456
```

## First Search

With the watcher running, try a search:

```bash
jeeves-watcher search "machine learning" --limit 5
```

Or via HTTP:

```bash
curl -X POST http://127.0.0.1:3456/search \
  -H "Content-Type: application/json" \
  -d '{"query": "machine learning", "limit": 5}'
```

## Run as a Service

For production deployment, install as a system service. See [Deployment Guide](./deployment.md) for detailed instructions.

**Windows (NSSM):**

```bash
jeeves-watcher service install
```

**Linux (systemd):**

```bash
jeeves-watcher service install
```

Both commands print installation instructions — follow them to set up the service.

## Next Steps

- [Configuration Reference](./configuration.md) — Full config options
- [Inference Rules](./inference-rules.md) — Automatic metadata enrichment
- [API Reference](./api-reference.md) — HTTP endpoints
- [CLI Reference](./cli-reference.md) — All CLI commands
- [Deployment Guide](./deployment.md) — Production setup
