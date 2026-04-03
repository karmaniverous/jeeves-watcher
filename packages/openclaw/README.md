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

Set the plugin config in `openclaw.json` under `plugins.entries.jeeves-watcher-openclaw.config`:

```json
{
  "apiUrl": "http://127.0.0.1:1936",
  "configRoot": "j:/config"
}
```

- **`apiUrl`** — jeeves-watcher API base URL (default: `http://127.0.0.1:1936`)
- **`configRoot`** — platform config root path, used by `@karmaniverous/jeeves` core to derive `{configRoot}/jeeves-watcher/` for component config (default: `j:/config`)

## Architecture

![Plugin Architecture](assets/plugin-architecture.png)

## Jeeves Platform Integration

This plugin integrates with [`@karmaniverous/jeeves`](https://www.npmjs.com/package/@karmaniverous/jeeves) to manage workspace content:

- **TOOLS.md** — writes a `## Watcher` section with a live menu of indexed content, score thresholds, and escalation rules (refreshes every 71 seconds)
- **SOUL.md / AGENTS.md** — maintains shared platform content via managed sections
- **Service commands** — exposes `stop`, `uninstall`, and `status` for the watcher service
- **Plugin commands** — exposes `uninstall` for the plugin itself

## Tools

| Tool | Description |
|------|-------------|
| `watcher_status` | Service health, uptime, and collection stats |
| `watcher_search` | Semantic search across indexed documents |
| `watcher_enrich` | Enrich document metadata via rules engine |
| `watcher_config` | Query the effective runtime config via JSONPath |
| `watcher_walk` | Walk watched filesystem paths with glob intersection |
| `watcher_validate` | Validate a watcher configuration |
| `watcher_config_apply` | Apply a new configuration |
| `watcher_reindex` | Trigger a scoped reindex with blast area plan |
| `watcher_scan` | Filter-only point query with cursor pagination |
| `watcher_issues` | List indexing issues and errors |
| `watcher_service` | Manage watcher background service (install/uninstall/start/stop/restart/status) |

## Documentation

Full docs for the jeeves-watcher service and this plugin:

**[docs.karmanivero.us/jeeves-watcher](https://docs.karmanivero.us/jeeves-watcher)**

## License

BSD-3-Clause
