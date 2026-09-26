# @karmaniverous/jeeves-watcher-openclaw

[OpenClaw](https://openclaw.ai) plugin for [jeeves-watcher](https://www.npmjs.com/package/@karmaniverous/jeeves-watcher) — semantic search and metadata enrichment tools for your AI agent.

## Prerequisites

A running [jeeves-watcher](https://www.npmjs.com/package/@karmaniverous/jeeves-watcher) service with its REST API accessible.

## Installation

The plugin is a standard OpenClaw plugin with no installer of its own. On a Jeeves box, `jeeves install` (from [`@karmaniverous/jeeves`](https://www.npmjs.com/package/@karmaniverous/jeeves) 0.6+) installs it and writes its config:

```bash
jeeves install watcher --config-root /srv/jeeves/config
```

Or install it directly with the OpenClaw CLI and set the config yourself:

```bash
openclaw plugins install npm:@karmaniverous/jeeves-watcher-openclaw@<version> --pin --accept-capabilities
```

The plugin registers an always-in-context rule set through OpenClaw's `before_prompt_build` hook, so it needs `plugins.entries.jeeves-watcher-openclaw.hooks.allowConversationAccess: true`. `jeeves install` / `jeeves update` grant this automatically (the hook is declared in `package.json` under `jeeves.conversationHooks`).

Restart the OpenClaw gateway to apply changes.

## Configuration

Plugin config lives in `openclaw.json` under `plugins.entries.jeeves-watcher-openclaw.config`:

```json
{
  "apiUrl": "http://127.0.0.1:1936",
  "configRoot": "/srv/jeeves/config"
}
```

- **`apiUrl`**: jeeves-watcher API base URL (default: `http://127.0.0.1:1936`; env fallback `JEEVES_WATCHER_URL`).
- **`configRoot`**: platform config root path, used by `@karmaniverous/jeeves` core to derive `{configRoot}/jeeves-watcher/`. **No default.** Set it in plugin config or via the `JEEVES_CONFIG_ROOT` env var.

`configRoot` is resolved lazily. The plugin always registers, even before its config is written (`openclaw plugins install` activates a plugin before `jeeves install` writes `plugins.entries.<id>.config`). While `configRoot` is unset the plugin logs one warning at registration. Gating is per call: only invocations that actually read `configRoot` are gated. Today that is exactly `watcher_service` with `action: "install"` (it derives the service config path from `configRoot`); it returns an error naming both ways to set it. Other `watcher_service` actions (`uninstall`, `start`, `stop`, `restart`, `status`) address the OS service by name, and every other tool only calls the watcher HTTP API, so they keep working without `configRoot`. Core is initialized on the first gated call after it resolves.

## Architecture

![Plugin Architecture](assets/plugin-architecture.png)

## Jeeves Platform Integration

The plugin builds on [`@karmaniverous/jeeves`](https://www.npmjs.com/package/@karmaniverous/jeeves) 0.6 (the static-content core). It writes **no** workspace files and starts no timers:

- **Always-in-context rules**: the watcher escalation, scan-first and search-first rules and score guidance are injected on every turn via `before_prompt_build` (`registerPromptContext`). They replace the v0.x TOOLS.md `## Watcher` section.
- **Live state**: served by tools (`watcher_status`, `watcher_config`) rather than a refreshed file.
- **Skill**: `jeeves-watcher` ships in the package and is declared in `openclaw.plugin.json` (`skills`).
- **Static platform content** (SOUL.md / AGENTS.md blocks) is rendered only by `jeeves install`.

## Tools

| Tool | Description |
| --- | --- |
| `watcher_status` | Service health, uptime, and collection stats |
| `watcher_search` | Semantic search across indexed documents |
| `watcher_enrich` | Set or update document metadata by file path |
| `watcher_config` | Query the effective runtime config via JSONPath |
| `watcher_walk` | Walk watched filesystem paths with glob intersection |
| `watcher_validate` | Validate a watcher configuration |
| `watcher_config_apply` | Apply a new configuration |
| `watcher_reindex` | Trigger a scoped reindex with blast area plan |
| `watcher_scan` | Filter-only point query with cursor pagination |
| `watcher_issues` | List indexing issues and errors |
| `watcher_service` | Manage watcher background service (install/uninstall/start/stop/restart/status) |
| `watcher_vcs_status` | Version tracking health: enabled state, tracked roots, remote status |
| `watcher_vcs_history` | Query change history by path or glob with optional date range |
| `watcher_vcs_show` | Retrieve file content at a specific version |
| `watcher_vcs_diff` | Show changes between two versions, or between a version and current |
| `watcher_vcs_revert` | Undo changes by restoring files to a specific version |
| `watcher_vcs_exclude` | Exclude or re-include paths from version tracking |
| `watcher_vcs_check` | Check whether a path is excluded from version tracking and why |

## Documentation

Full docs for the jeeves-watcher service and this plugin:

**[docs.karmanivero.us/jeeves-watcher](https://docs.karmanivero.us/jeeves-watcher)**

## License

BSD-3-Clause
