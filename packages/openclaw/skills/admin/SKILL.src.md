---
name: jeeves-watcher-admin
description: >
  Instance management for a jeeves-watcher deployment. Use when you need to
  author or validate config, trigger reindexing, diagnose embedding failures,
  or manage helper registrations.
---

# jeeves-watcher — Instance Administration

## Tools

### `watcher_validate`
Validate config and optionally test file paths.
- `config` (object, optional) — candidate config (partial or full). Omit to validate current config.
- `testPaths` (string[], optional) — file paths to test against the config

Partial configs merge with current config by rule name. If `config` is omitted, tests against the running config.

### `watcher_config_apply`
Apply config changes atomically.
- `config` (object, required) — full or partial config to apply

Validates, writes to disk, and triggers configured reindex behavior. Returns validation errors if invalid.

### `watcher_reindex`
Trigger a reindex.
- `scope` (string, optional) — `"rules"` (default) or `"full"`

Rules scope re-applies inference rules without re-embedding (lightweight). Full scope re-processes all files.

### `watcher_issues`
Get runtime embedding failures. Returns `{ filePath: IssueRecord }` showing files that failed and why.

### `watcher_query`
Query config and runtime state via JSONPath (same tool as consumer skill).

### `watcher_status`
Service health check including reindex progress.

{{> qdrant-filters.md}}

{{> search-results.md}}

{{> jsonpath-patterns.md}}

## Config Authoring

### Rule Structure
Each inference rule has:
- `name` (required) — unique identifier
- `description` (optional) — human-readable purpose
- `match` — JSON Schema with picomatch glob for path matching
- `set` — metadata fields to set on match
- `map` (optional) — named JsonMap transform
- `template` (optional) — named Handlebars template

### Config Workflow
1. Edit config (or build partial config object)
2. Validate: `watcher_validate` with optional `testPaths` for dry-run preview
3. Apply: `watcher_config_apply` — validates, writes, triggers reindex
4. Monitor: `watcher_issues` for runtime embedding failures

### When to Reindex
- **Rules scope** (`"rules"`): Changed rule matching patterns, set expressions, schema mappings. No re-embedding needed.
- **Full scope** (`"full"`): Changed embedding config, added watch paths, broad schema restructuring. Re-embeds everything.

## Diagnostics

### Escalation Path
1. `watcher_status` — is the service healthy? Is a reindex running?
2. `watcher_issues` — what files are failing and why?
3. `watcher_query` with `$.issues` — same data via JSONPath
4. Check logs at the configured log path

### Error Categories
- `type_collision` — metadata field type mismatch during extraction
- `interpolation` — template/set expression failed to resolve
- `read_failure` — file couldn't be read (permissions, encoding)
- `embedding` — embedding API error

## Helper Management

Helpers use namespace prefixing: config key becomes prefix. A helper named `slack` exports `slack_extractParticipants`.

Enumerate loaded helpers:
```
$.mapHelpers              — JsonMap helper namespaces with exports
$.templateHelpers         — Handlebars helper namespaces with exports
```

## CLI Fallbacks

If the watcher API is down:
- `jeeves-watcher status` — check if the service is running
- `jeeves-watcher validate` — validate config from CLI
- Restart via NSSM (Windows) or systemctl (Linux)
