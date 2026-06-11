---
title: Version Control (VCS)
---

# Version Control (VCS)

Git-backed versioning of watched content. The VCS subsystem maintains a forward-only history of file changes in each watch root, with debounced batch commits, AI-generated commit messages, squash retention, and optional remote push.

Git terminology is used throughout — this is an operator-facing feature.

---

## How It Works

### One Repo Per Watch Root

Each watch path gets its own git repository, initialized automatically at startup. This keeps histories isolated — a revert in one root never affects another.

### Debounced Batch Commits

File changes are collected into batches rather than committed individually. The commit pipeline uses two controls:

- **`commitDebounceMs`** (default: 30000) — After the last file change, wait this long before committing. Resets on each new change.
- **`maxBatchSize`** (default: 1000) — If the pending set reaches this size, flush immediately without waiting for the debounce timer. Overflow files roll into the next commit cycle.

### Forward-Only Reversion

Reverting a file restores its content from a historical commit via `git show`, then writes the old content back to disk as a **new change**. HEAD never moves backward — the restored content becomes a new commit in the forward-only timeline.

### Independent Indexing

VCS tracking and watcher embedding are independent concerns. Git can track files that the watcher cannot embed (e.g., binary files), and the watcher can embed files excluded from git via `.gitignore`. The two systems share watch paths but maintain separate state.

---

## Configuration

### Root-Level `vcs` Block

```json
{
  "vcs": {
    "enabled": true,
    "commitDebounceMs": 30000,
    "maxBatchSize": 1000,
    "commitMessage": {
      "enabled": true,
      "provider": "anthropic",
      "model": "claude-haiku-4-0",
      "apiKey": "${ANTHROPIC_API_KEY}"
    },
    "retention": {
      "maxAgeDays": 30,
      "maxVersions": 100,
      "squashCron": "0 0 * * *"
    },
    "defaultAccessToken": "${GIT_ACCESS_TOKEN}"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable VCS tracking globally. |
| `commitDebounceMs` | `number` | `30000` | Milliseconds to wait after last file change before committing (min: 1000). |
| `maxBatchSize` | `number` | `1000` | Max files per commit batch (min: 1). Overflow rolls to next cycle. |
| `commitMessage` | `object` | See below | AI commit message generation settings. |
| `commitMessage.enabled` | `boolean` | `true` | Enable AI-generated commit messages. Falls back to template on failure. |
| `commitMessage.provider` | `string` | `"anthropic"` | LLM provider for commit messages. |
| `commitMessage.model` | `string` | `"claude-haiku-4-0"` | Model name. |
| `commitMessage.apiKey` | `string` | `undefined` | API key. Supports `${ENV_VAR}` substitution. Falls back to OpenClaw gateway if omitted. |
| `retention` | `object` | See below | Squash retention settings. |
| `retention.maxAgeDays` | `number` | `30` | Delete commits older than this (min: 1). |
| `retention.maxVersions` | `number` | `100` | Keep at most this many commits (min: 1). |
| `retention.squashCron` | `string` | `"0 0 * * *"` | Cron schedule for squash retention (5-field format). |
| `defaultAccessToken` | `string` | `undefined` | Shared access token for remote push. Supports `${ENV_VAR}` substitution. |

### Per-Root Overrides

Watch paths can override any VCS setting and add root-specific `remote` and `accessToken`:

```json
{
  "watch": {
    "paths": [
      {
        "path": "d:/documents/**/*.md",
        "vcs": {
          "enabled": true,
          "remote": "https://github.com/org/docs-backup.git",
          "accessToken": "${DOCS_GIT_TOKEN}",
          "commitDebounceMs": 10000,
          "maxBatchSize": 500
        }
      },
      {
        "path": "d:/logs/**/*.log",
        "vcs": {
          "enabled": false
        }
      },
      "d:/notes/**/*.txt"
    ]
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `remote` | `string` | `undefined` | Git remote URL for this root. |
| `accessToken` | `string` | `undefined` | Access token for this root's remote. Overrides `defaultAccessToken`. Supports `${ENV_VAR}` substitution. |

String-only watch paths inherit the root-level `vcs` config. Object entries can selectively override any field.

### Environment Variable Substitution

All string config values support `${ENV_VAR}` syntax, resolved at startup:

```json
{
  "vcs": {
    "commitMessage": {
      "apiKey": "${ANTHROPIC_API_KEY}"
    },
    "defaultAccessToken": "${GIT_ACCESS_TOKEN}"
  }
}
```

---

## API Reference

All VCS endpoints are prefixed with `/vcs`. See the [API Reference](./api-reference.md#vcs-endpoints) for the full endpoint documentation alongside the rest of the HTTP API.

### GET /vcs/status

VCS state for all roots.

#### Request

```bash
curl http://localhost:1936/vcs/status
```

#### Response

```json
{
  "enabled": true,
  "roots": [
    {
      "path": "d:/documents",
      "tracked": 1523,
      "lastCommit": {
        "hash": "a1b2c3d",
        "message": "update project notes and readme",
        "timestamp": "2026-06-10T14:30:00Z"
      },
      "remoteUrl": "https://github.com/org/docs-backup.git",
      "lastPush": "2026-06-10T14:30:05Z",
      "pushErrors": []
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | `boolean` | Whether VCS is enabled globally. |
| `roots` | `array` | Per-root VCS state. |
| `roots[].path` | `string` | Watch root path. |
| `roots[].tracked` | `number` | Number of tracked files in this root. |
| `roots[].lastCommit` | `object?` | Most recent commit (null if no commits yet). |
| `roots[].lastCommit.hash` | `string` | Short commit hash. |
| `roots[].lastCommit.message` | `string` | Commit message. |
| `roots[].lastCommit.timestamp` | `string` | ISO-8601 timestamp. |
| `roots[].remoteUrl` | `string?` | Configured remote URL (if any). |
| `roots[].lastPush` | `string?` | ISO-8601 timestamp of last successful push. |
| `roots[].pushErrors` | `string[]` | Recent push error messages (non-blocking). |

---

### GET /vcs/history

Commit history for files matching a glob pattern.

#### Request

```bash
curl "http://localhost:1936/vcs/history?glob=d:/documents/**/*.md&limit=10&since=2026-06-01T00:00:00Z"
```

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `glob` | `string` | **Required** | Glob pattern to filter history. |
| `since` | `string` | `undefined` | ISO-8601 lower bound (inclusive). |
| `until` | `string` | `undefined` | ISO-8601 upper bound (inclusive). |
| `limit` | `number` | `20` | Max entries to return. |

#### Response

```json
[
  {
    "commit": "a1b2c3d",
    "message": "update project notes and readme",
    "timestamp": "2026-06-10T14:30:00Z",
    "files": ["d:/documents/projects/readme.md", "d:/documents/projects/notes.md"]
  },
  {
    "commit": "e4f5g6h",
    "message": "add meeting transcript",
    "timestamp": "2026-06-09T09:15:00Z",
    "files": ["d:/documents/meetings/2026-06-09.md"]
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `commit` | `string` | Short commit hash. |
| `message` | `string` | Commit message. |
| `timestamp` | `string` | ISO-8601 commit timestamp. |
| `files` | `string[]` | Files changed in this commit (filtered by glob). |

---

### GET /vcs/show

Retrieve file content at a specific commit.

#### Request

```bash
curl "http://localhost:1936/vcs/show?path=d:/documents/readme.md&commit=a1b2c3d"
```

| Param | Type | Description |
|-------|------|-------------|
| `path` | `string` | **Required.** Absolute file path. |
| `commit` | `string` | **Required.** Commit hash. |

#### Response

Returns the raw file content with an appropriate `Content-Type` header based on file extension.

---

### GET /vcs/diff

Unified diff between commits for files matching a glob.

#### Request

```bash
curl "http://localhost:1936/vcs/diff?glob=d:/documents/**/*.md&commit=a1b2c3d&commitEnd=e4f5g6h"
```

| Param | Type | Description |
|-------|------|-------------|
| `glob` | `string` | **Required.** Glob pattern to filter files. |
| `commit` | `string` | **Required.** Start commit hash. |
| `commitEnd` | `string` | End commit hash. Defaults to HEAD if omitted. |

#### Response

Returns unified diff text (`Content-Type: text/plain`).

---

### POST /vcs/revert

Restore files from a historical commit (forward-only — writes old content as new changes).

#### Request

```bash
curl -X POST http://localhost:1936/vcs/revert \
  -H "Content-Type: application/json" \
  -d '{
    "glob": "d:/documents/projects/**",
    "commit": "a1b2c3d",
    "existingOnly": true
  }'
```

**Body schema:**

```typescript
{
  glob: string;            // Glob pattern for files to revert
  commit: string;          // Commit hash to revert to
  existingOnly?: boolean;  // Only restore files that currently exist on disk (default: false)
}
```

#### Response

```json
{
  "restored": 3,
  "files": [
    "d:/documents/projects/readme.md",
    "d:/documents/projects/notes.md",
    "d:/documents/projects/spec.md"
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `restored` | `number` | Number of files restored. |
| `files` | `string[]` | Paths of restored files. |

#### Behavior

1. Lists files at the specified commit matching the glob
2. Retrieves file content via `git show`
3. Writes content back to disk (triggers watcher file events)
4. Records reversion metadata for the commit message
5. The resulting commit is prefixed with `revert: {glob} to {shortCommit}`

---

### POST /vcs/exclude

Manage `.gitignore` entries.

#### Request

```bash
curl -X POST http://localhost:1936/vcs/exclude \
  -H "Content-Type: application/json" \
  -d '{
    "glob": "d:/documents/temp/**/*.tmp",
    "root": "d:/documents",
    "remove": false
  }'
```

**Body schema:**

```typescript
{
  glob: string;      // Glob pattern to add or remove
  root?: string;     // Watch root (resolved automatically if omitted)
  remove?: boolean;  // Remove the entry instead of adding (default: false)
}
```

#### Response

```json
{
  "ok": true,
  "gitignorePath": "d:/documents/temp/.gitignore",
  "action": "added"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ok` | `boolean` | Success indicator. |
| `gitignorePath` | `string` | Path to the `.gitignore` file that was modified. |
| `action` | `string` | `"added"` or `"removed"`. |

#### Behavior

Uses the **locality principle**: the `.gitignore` entry is placed in the deepest appropriate directory. For example, `d:/documents/temp/**/*.tmp` results in a `.gitignore` at `d:/documents/temp/` containing `**/*.tmp`.

---

### GET /vcs/check-exclusion

Check whether a file is excluded by `.gitignore`.

#### Request

```bash
curl "http://localhost:1936/vcs/check-exclusion?path=d:/documents/temp/scratch.tmp"
```

| Param | Type | Description |
|-------|------|-------------|
| `path` | `string` | **Required.** Absolute file path to check. |

#### Response

```json
{
  "excluded": true,
  "rule": "**/*.tmp",
  "source": "d:/documents/temp/.gitignore"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `excluded` | `boolean` | Whether the file is ignored by git. |
| `rule` | `string?` | The matching `.gitignore` pattern (if excluded). |
| `source` | `string?` | Path to the `.gitignore` file containing the rule. |

---

## AI Commit Messages

When `commitMessage.enabled` is `true` (the default), the VCS subsystem generates one-line commit messages using an LLM.

### Provider Configuration

```json
{
  "vcs": {
    "commitMessage": {
      "provider": "anthropic",
      "model": "claude-haiku-4-0",
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  }
}
```

Currently only the `"anthropic"` provider is supported. Unsupported providers log a warning and fall back to the template.

### Auth Resolution

The API key is resolved in order:

1. **Config key** — `commitMessage.apiKey` (with `${ENV_VAR}` substitution)
2. **OpenClaw gateway fallback** — If no key is configured, the generator attempts to route through a local OpenClaw gateway

### Fallback Behavior

If the LLM call fails (timeout, auth error, unsupported provider), the commit uses a template-based message listing changed file paths. The 15-second request timeout and 4000-character diff limit prevent slow or expensive API calls.

### Reversion Messages

Revert commits use a fixed format: `revert: {glob} to {shortCommit}`, bypassing AI generation.

---

## Remote Push

Each root can push to a remote git repository after every commit.

### Configuration

```json
{
  "watch": {
    "paths": [
      {
        "path": "d:/documents/**/*.md",
        "vcs": {
          "remote": "https://github.com/org/docs-backup.git",
          "accessToken": "${DOCS_GIT_TOKEN}"
        }
      }
    ]
  },
  "vcs": {
    "defaultAccessToken": "${GIT_ACCESS_TOKEN}"
  }
}
```

- **`remote`** — Git remote URL (per-root only).
- **`accessToken`** — Per-root token. Falls back to `defaultAccessToken` from the root-level `vcs` block.
- Access tokens are injected into the remote URL for HTTPS authentication.

### Push Error Handling

Push failures are **non-blocking** — the commit succeeds locally regardless. Errors are recorded in `GET /vcs/status` under `pushErrors` for the affected root. The remote is treated as a backup mirror, not a primary store.

---

## Squash Retention

The VCS subsystem periodically squashes old commits to prevent unbounded history growth.

### Retention Rules

Two retention limits work together — the **tighter** constraint wins:

- **`maxAgeDays`** (default: 30) — Commits older than this are eligible for squash.
- **`maxVersions`** (default: 100) — Only the most recent N commits are retained.

### Cron Schedule

Squash runs on a cron schedule configured via `retention.squashCron` (default: `"0 0 * * *"` — daily at midnight). The scheduler is watcher-internal — no external cron daemon or task scheduler is needed.

The cron expression uses standard 5-field format (`minute hour day-of-month month day-of-week`) and supports wildcards (`*`), lists (`1,15`), ranges (`1-5`), and steps (`*/6`).

### Squash Mechanism

1. Parse the commit log and compute the retention boundary
2. Create an orphan branch at the boundary commit
3. Use `commit-tree` to create a single squashed baseline commit
4. Cherry-pick all retained commits on top
5. Force-update the main branch to the new history

### Force Push After Squash

If a remote is configured, the squashed history is force-pushed. This is acceptable because the remote is a **backup mirror** — no other writers commit to it.

### Lock Contention

If `index.lock` is held by another git operation during squash, the squash aborts cleanly and retries on the next cron cycle. No data is lost.

---

## Exclusion Management

### `.gitignore` vs `watch.ignored`

These are independent concerns:

- **`.gitignore`** — Controls what git tracks. Managed via `POST /vcs/exclude`.
- **`watch.ignored`** — Controls what the watcher monitors for embedding. Set in config.

A file can be git-ignored but still embedded (if matched by `watch.paths` and not in `watch.ignored`), or tracked by git but not embedded.

### Always-On Entries

The VCS subsystem automatically adds these to every root's `.gitignore`:

- `.git/`
- `node_modules/`
- `.jeeves-watcher/`
- `.jeeves-metadata/`

These entries are enforced on every startup and cannot be removed via the API.

### Locality Principle

When adding a `.gitignore` entry via `POST /vcs/exclude`, the entry is placed in the **deepest appropriate directory**. For example, excluding `d:/documents/temp/**/*.log` places `**/*.log` in `d:/documents/temp/.gitignore`, not at the root.

---

## Deployment Notes

### Git Soft Dependency

Git is a **soft dependency**. If `git` is not found on `PATH` at startup:

- VCS features are disabled gracefully
- The watcher logs a warning and continues operating normally
- All non-VCS features (embedding, search, metadata) work without git

### State Directory Overlap

The `stateDir` must **not** overlap with any watch path. The watcher validates this at startup and exits with an error if an overlap is detected. This prevents the watcher from indexing its own state files.

### Child Repositories

If a watch root contains child git repositories (nested `.git/` directories), they are tracked uniformly as part of the parent root's VCS history. The child `.git/` directories are excluded via the always-on `.gitignore` entries.

---

## Troubleshooting

### index.lock Contention

**Symptom:** Commits fail intermittently with `index.lock` errors.

**Cause:** Another git process (IDE, manual git command, squash) holds the lock.

**Resolution:** The VCS subsystem retries with exponential backoff (4 attempts). If all retries fail, the commit is deferred to the next batch cycle. No data is lost — pending files accumulate until the lock is released. If the problem persists, check for rogue git processes or IDE integrations that hold locks.

### Large Initial Commits

**Symptom:** First commit after enabling VCS is very large or slow.

**Cause:** All existing files in the watch root are staged for the initial commit.

**Resolution:** The `maxBatchSize` setting naturally chunks large initial commits. With the default of 1000, a root with 5000 files produces 5 sequential commits. Increase `maxBatchSize` if you prefer fewer, larger commits.

### Push Failures

**Symptom:** `GET /vcs/status` shows entries in `pushErrors`.

**Common causes:**
- Invalid or expired access token
- Remote URL incorrect or unreachable
- Network connectivity issues

**Resolution:** Push failures are non-blocking — local commits are safe. Fix the credential or network issue and the next commit will push successfully. Check logs for detailed error messages.

### Git Not Found on PATH

**Symptom:** VCS features silently disabled. Log contains `git not found` warning.

**Resolution:** Install git and ensure it is on the system `PATH`. Restart the watcher. On Windows, the installer typically adds git to `PATH` automatically. On Linux, install via your package manager (`apt install git`, `yum install git`, etc.).

---

## Next Steps

- [Configuration Reference](./configuration.md#-version-control) — VCS config schema table
- [API Reference](./api-reference.md#vcs-endpoints) — Full endpoint documentation
- [Architecture Guide](./architecture.md#version-control-subsystem) — VCS data flow
- [Deployment Guide](./deployment.md#version-control-vcs) — Git dependency and setup
- [Getting Started](./getting-started.md#enable-version-tracking) — Minimal VCS setup
