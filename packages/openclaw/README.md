# @karmaniverous/jeeves-watcher-openclaw

[OpenClaw](https://openclaw.ai) plugin for [jeeves-watcher](https://www.npmjs.com/package/@karmaniverous/jeeves-watcher) — semantic search and metadata enrichment tools for your AI agent.

## Prerequisites

A running [jeeves-watcher](https://www.npmjs.com/package/@karmaniverous/jeeves-watcher) service with its REST API accessible.

## Installation

### Standard (OpenClaw CLI)

```bash
openclaw plugins install @karmaniverous/jeeves-watcher-openclaw
```

### Self-Installer (Windows workaround)

OpenClaw's `plugins install` command has a known [`spawn EINVAL`](https://github.com/openclaw/openclaw/issues/9224) bug on Windows. This package includes a self-installer that bypasses the issue:

```bash
npx @karmaniverous/jeeves-watcher-openclaw install
```

This copies the plugin into OpenClaw's extensions directory and patches the config. To remove:

```bash
npx @karmaniverous/jeeves-watcher-openclaw uninstall
```

**Non-default installations:** Set `OPENCLAW_CONFIG` (path to `openclaw.json`) or `OPENCLAW_HOME` (path to `.openclaw` directory) if OpenClaw is not installed at the default location.

After install or uninstall, restart the OpenClaw gateway to apply changes.

## Configuration

Set the `apiUrl` in the plugin configuration to point at your jeeves-watcher service:

```json
{
  "apiUrl": "http://localhost:3000"
}
```

## Tools

| Tool | Description |
|------|-------------|
| `watcher_status` | Service health, uptime, and collection stats |
| `watcher_search` | Semantic search across indexed documents |
| `watcher_enrich` | Enrich document metadata via rules engine |
| `watcher_query` | Raw Qdrant query with filters |
| `watcher_validate` | Validate a watcher configuration |
| `watcher_config_apply` | Apply a new configuration |
| `watcher_reindex` | Trigger a full reindex |
| `watcher_issues` | List indexing issues and errors |

## Documentation

Full docs for the jeeves-watcher service and this plugin:

**[docs.karmanivero.us/jeeves-watcher](https://docs.karmanivero.us/jeeves-watcher)**

## License

BSD-3-Clause
