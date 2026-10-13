---
title: Version Control (VCS)
---

# Version Control (VCS)

Git-backed versioning of watched content. The VCS subsystem maintains a forward-only history of file changes in each watch root, with throttled batch commits, AI-generated commit messages, squash retention, and optional remote push.

Git terminology is used throughout, since this is an operator-facing feature.

---

## How It Works

### One Repo Per Watch Root

Each VCS-enabled watch path gets a git repository at its root (the static directory prefix of the glob, e.g. `d:/documents` for `d:/documents/**/*.md`), initialized automatically at startup if it does not exist. Several globs with the same root share one repository. This keeps histories isolated: a revert in one root never affects another.

At startup each repository also gets its local git identity (`user.name` / `user.email`, from the `author` setting below) and the [always-on `.gitignore` entries](#always-on-entries).

### Throttled Batch Commits

File changes are collected into batches rather than committed individually. The commit pipeline uses two controls:

- **`commitThrottleMs`** (default: 30000): after the first file change, wait this long before committing. New changes during the interval are batched but do not reset the timer.
- **`maxBatchSize`** (default: 1000): if the pending set reaches this size, flush immediately without waiting for the throttle timer. Overflow files roll into the next commit cycle.

Commit messages are `baseline: batch (<n> files)` for commits made during the initial filesystem scan, otherwise an [AI-generated message](#ai-commit-messages) or the template `watcher: batch <ISO timestamp> (<n> files)`.

On shutdown, each root commits its pending files before the service exits.

### Forward-Only Reversion

Reverting a file restores its content from a historical commit via `git show`, then writes the old content back to disk as a **new change**. HEAD never moves backward: the restored content becomes a new commit in the forward-only timeline.

### What Gets Versioned

VCS receives the same file events as the embedding pipeline: files that match `watch.paths`, are not excluded by `watch.ignored` and (with the default `watch.respectGitignore: true`) are not git-ignored. Events reach VCS before extraction, so a file the watcher cannot embed (e.g. a binary or unsupported format matched by a watch glob) is still versioned. Version history and the vector index keep separate state.

> **Keep `watch.respectGitignore` enabled with VCS.** With `respectGitignore: false`, git-ignored files are still sent to VCS, and `git add` refuses an ignored path: the batch fails, is retried, and eventually trips the [circuit breaker](#retries-and-the-circuit-breaker).

---

## Configuration

### Root-Level `vcs` Block

```json
{
  "vcs": {
    "enabled": true,
    "commitThrottleMs": 30000,
    "maxBatchSize": 1000,
    "branch": "master",
    "author": {
      "name": "jeeves-watcher",
      "email": "watcher@localhost"
    },
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
    "defaultAccessToken": "${GIT_ACCESS_TOKEN}",
    "staleLockThresholdMs": 60000,
    "maxConsecutiveFailures": 5,
    "circuitBreakerCooldownMs": 300000
  }
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `false` | Enable VCS tracking globally. |
| `commitThrottleMs` | `number` | `30000` | Throttle interval in milliseconds for batching commits (min: 1000). Timer starts on first change and does not reset. |
| `maxBatchSize` | `number` | `1000` | Max files per commit batch (min: 1). Overflow rolls to next cycle. |
| `branch` | `string` | `"master"` | Git branch name for VCS operations. Squash retention and startup orphan recovery target this branch instead of dynamically detecting the current branch. |
| `author` | `object` | See below | Git commit identity, written to each repository's local git config at startup. |
| `author.name` | `string` | `"jeeves-watcher"` | Commit author name. |
| `author.email` | `string` | `"watcher@localhost"` | Commit author email. |
| `commitMessage` | `object` | See below | AI commit message generation settings. |
| `commitMessage.enabled` | `boolean` | `true` | Enable AI-generated commit messages. Falls back to template on failure. |
| `commitMessage.provider` | `string` | `"anthropic"` | LLM provider for commit messages. |
| `commitMessage.model` | `string` | `"claude-haiku-4-0"` | Model name. |
| `commitMessage.apiKey` | `string` | `undefined` | API key. Supports `${ENV_VAR}` substitution. Falls back to the OpenClaw gateway config if omitted (see [Auth Resolution](#auth-resolution)). |
| `retention` | `object` | See below | Squash retention settings. |
| `retention.maxAgeDays` | `number` | `30` | Squash commits older than this (min: 1). |
| `retention.maxVersions` | `number` | `100` | Keep at most this many commits on top of the squashed baseline (min: 1). |
| `retention.squashCron` | `string` | `"0 0 * * *"` | Cron schedule for squash retention (5-field format, host local time). |
| `defaultAccessToken` | `string` | `undefined` | Shared access token for remote push. Supports `${ENV_VAR}` substitution. |
| `staleLockThresholdMs` | `number` | `60000` | Age in ms after which an `index.lock` is considered stale and force-removed (min: 5000). |
| `maxConsecutiveFailures` | `number` | `5` | Circuit breaker: trip after this many consecutive commit failures (min: 1). Pending files are retained. |
| `circuitBreakerCooldownMs` | `number` | `300000` | Cooldown in ms before a tripped breaker makes a single recovery attempt (min: 1000). |

### Per-Root Overrides

A watch path can be an object with a `vcs` block that overrides VCS settings for that root and adds root-specific `remote` and `accessToken`:

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
          "commitThrottleMs": 10000,
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
| --- | --- | --- | --- |
| `remote` | `string` | `undefined` | Git remote URL for this root. |
| `accessToken` | `string` | `undefined` | Access token for this root's remote. Overrides `defaultAccessToken`. Supports `${ENV_VAR}` substitution. |

String-only watch paths inherit the root-level `vcs` config. In an object entry's `vcs` block, the per-root block is validated with the same schema defaults as the root-level block, so **every setting that has a default and is omitted takes that default, not the root-level value**:

- `enabled` defaults to `false`: an object entry must set `"enabled": true` to be versioned, even when `vcs.enabled` is `true`.
- `commitThrottleMs`, `maxBatchSize`, `branch`, `staleLockThresholdMs`, `maxConsecutiveFailures` and `circuitBreakerCooldownMs` likewise fall back to their defaults, so repeat any root-level value you changed.
- `author`, `commitMessage` and `retention` have no default: when omitted they are inherited from the root-level block (each replaces the root-level object as a whole when set). `accessToken` falls back to `defaultAccessToken`.

`vcs.enabled` must still be `true` at the root level for any root to be versioned.

> **Caution:** `GET /config` returns the `watch` block as loaded, so a per-root `vcs.accessToken` is visible there (after `${ENV_VAR}` substitution) to any API caller. The root-level `vcs` block (including `defaultAccessToken` and `commitMessage.apiKey`) is never returned. Prefer `defaultAccessToken` and protect the API with `api.apiKey`.

### Environment Variable Substitution

String config values support `${ENV_VAR}` syntax, resolved at startup. A reference to an unset variable is left as the literal text (only `api.apiKey` and `sources` fail the startup on an unresolved reference):

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

The routes are always registered. When `vcs.enabled` is `false`, `GET /vcs/status` reports `enabled: false` with no roots and every other route answers `404 not_found`. When `api.apiKey` is set they require `Authorization: Bearer <key>` like every other route except `GET /status`.

Errors use the standard error body (`{ code, error }`, with the status derived from `code`):

| Status | `code` | When |
| --- | --- | --- |
| `400` | `invalid_request` | A required parameter is missing. |
| `404` | `not_found` | The path or glob is outside every VCS-enabled root; `root` is not a VCS-enabled root; the file does not exist at the commit (`/vcs/show`); the `.gitignore` or the pattern to remove does not exist (`/vcs/exclude`). |
| `500` | `internal_error` | An unexpected failure (logged; the response carries generic text, `message: "Internal server error"`). |

Paths and globs are absolute. A glob is resolved to the root(s) it falls under and passed to git relative to that root as a pathspec, so git's wildcard rules apply: `*` also matches `/` (`docs/*.md` matches nested files too), while `docs/**/*.md` requires at least one subdirectory.

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
      "tracked": 152,
      "lastCommit": {
        "hash": "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
        "message": "update project notes and readme",
        "timestamp": "2026-06-10T14:30:00+00:00"
      },
      "remoteUrl": "https://github.com/org/docs-backup.git",
      "lastPush": "2026-06-10T14:30:05.000Z",
      "pushErrors": [],
      "breaker": {
        "consecutiveFailures": 0,
        "tripped": false,
        "trippedAt": null,
        "lastError": null,
        "pendingCount": 0
      }
    }
  ]
}
```

| Field | Type | Description |
| --- | --- | --- |
| `enabled` | `boolean` | Whether any root is versioned. |
| `roots` | `array` | Per-root VCS state. |
| `roots[].path` | `string` | Watch root path. |
| `roots[].tracked` | `number` | Number of commits on the current branch (`git rev-list --count HEAD`; `0` before the first commit). |
| `roots[].lastCommit` | `object \| null` | Most recent commit (`null` if no commits yet). |
| `roots[].lastCommit.hash` | `string` | Full commit hash. |
| `roots[].lastCommit.message` | `string` | Commit subject. |
| `roots[].lastCommit.timestamp` | `string` | ISO-8601 author date, with the committer's UTC offset. |
| `roots[].remoteUrl` | `string \| null` | Configured `remote`, else the repository's `origin` URL, else `null`. |
| `roots[].lastPush` | `string \| null` | ISO-8601 timestamp of the last successful push since startup. |
| `roots[].pushErrors` | `array` | Push failures since startup, oldest first, each `{ timestamp, message }` (token redacted). Not cleared by a later successful push. |
| `roots[].breaker` | `object \| null` | Commit circuit breaker state (`null` if the root has no manager). |
| `roots[].breaker.consecutiveFailures` | `number` | Consecutive commit failures since the last success. |
| `roots[].breaker.tripped` | `boolean` | Whether the breaker is tripped (cooling down). |
| `roots[].breaker.trippedAt` | `string \| null` | ISO-8601 timestamp of the current trip. |
| `roots[].breaker.lastError` | `string \| null` | Message of the most recent commit failure. |
| `roots[].breaker.pendingCount` | `number` | Files queued or in flight, not yet committed. |

---

### GET /vcs/history

Commit history for files matching a glob.

#### Request

```bash
curl "http://localhost:1936/vcs/history?glob=d:/documents/*.md&limit=10&since=2026-06-01T00:00:00Z"
```

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `glob` | `string` | **Required** | Path or glob pattern to filter history. |
| `since` | `string` | `undefined` | Lower date bound, passed to `git log --since` (ISO-8601 or any git date string). |
| `until` | `string` | `undefined` | Upper date bound, passed to `git log --until`. |
| `limit` | `number` | `20` | Max entries to return. |

#### Response

```json
[
  {
    "commit": "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    "message": "update project notes and readme",
    "timestamp": "2026-06-10T14:30:00+00:00",
    "files": ["projects/readme.md", "projects/notes.md"]
  },
  {
    "commit": "e4f5a6b7c8d90a1b2c3d4e5f60718293a4b5c6d7",
    "message": "add meeting transcript",
    "timestamp": "2026-06-09T09:15:00+00:00",
    "files": ["meetings/2026-06-09.md"]
  }
]
```

| Field | Type | Description |
| --- | --- | --- |
| `commit` | `string` | Full commit hash. |
| `message` | `string` | Commit subject. |
| `timestamp` | `string` | ISO-8601 author date. |
| `files` | `string[]` | Files changed in this commit that match the glob, relative to the root. |

When the glob covers several roots, their entries are merged, sorted newest first and cut to `limit`; entries do not name their root. A root whose `git log` fails (e.g. no commits yet) contributes nothing.

---

### GET /vcs/show

Retrieve file content at a specific commit.

#### Request

```bash
curl "http://localhost:1936/vcs/show?path=d:/documents/readme.md&commit=a1b2c3d"
```

| Param | Type | Description |
| --- | --- | --- |
| `path` | `string` | **Required.** Absolute file path. |
| `commit` | `string` | **Required.** Commit hash (full or abbreviated) or any git revision. |

#### Response

The file content as text, with a `Content-Type` chosen from the extension (`.txt`, `.md`, `.json`, `.xml`, `.html`, `.css`, `.js`, `.ts`, `.yaml`/`.yml`, `.csv`; anything else is `application/octet-stream`). The content is decoded as UTF-8, so binary files are not returned byte-for-byte. `404 not_found` when the file does not exist at that commit (or the commit does not exist).

---

### GET /vcs/diff

Unified diff between commits for files matching a glob.

#### Request

```bash
curl "http://localhost:1936/vcs/diff?glob=d:/documents/*.md&commit=a1b2c3d&commitEnd=e4f5a6b"
```

| Param       | Type     | Description                                         |
| ----------- | -------- | --------------------------------------------------- |
| `glob`      | `string` | **Required.** Path or glob pattern to filter files. |
| `commit`    | `string` | **Required.** Start commit.                         |
| `commitEnd` | `string` | End commit. Defaults to `HEAD` if omitted.          |

#### Response

Unified diff text (`Content-Type: text/plain`) of `git diff <commit>..<commitEnd>`, concatenated across the roots the glob covers. An unknown commit (or a range with no changes) yields an empty `200` body, not an error. A glob outside every root is `404 not_found`.

---

### POST /vcs/revert

Restore files from a historical commit (forward-only: writes old content as new changes).

#### Request

```bash
curl -X POST http://localhost:1936/vcs/revert \
  -H "Content-Type: application/json" \
  -d '{
    "glob": "d:/documents/projects",
    "commit": "a1b2c3d",
    "existingOnly": true
  }'
```

**Body schema:**

```typescript
{
  glob: string;            // File or directory to revert (absolute)
  commit: string;          // Commit to restore from
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

| Field      | Type       | Description                       |
| ---------- | ---------- | --------------------------------- |
| `restored` | `number`   | Number of files restored.         |
| `files`    | `string[]` | Absolute paths of restored files. |

#### Behavior

1. Lists the files at the commit under the given path (`git ls-tree -r --name-only <commit> -- <path>`). `git ls-tree` matches literal paths, not wildcards: pass a file or a directory (everything under it is restored). A wildcard pattern, or an unknown commit, restores nothing (`restored: 0`).
2. Retrieves each file's content via `git show`.
3. Writes the content back to disk as UTF-8 text, creating missing directories (binary files are not restored byte-for-byte).
4. Queues the restored files for the next commit and records the reversion for its message.
5. The resulting commit message starts with `revert: {glob} to {shortCommit} — ` (the first 7 characters of `commit`), followed by the AI description or, on the template path, `restored <n> files` (plus `(+ <m> other changes)` when other files share the commit).

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
  glob: string;      // Absolute glob pattern to add or remove
  root?: string;     // Watch root (resolved from the glob if omitted)
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
| --- | --- | --- |
| `ok` | `boolean` | Success indicator. |
| `gitignorePath` | `string` | Path to the `.gitignore` file that was modified. |
| `action` | `string` | `"added"` or `"removed"`. |

#### Behavior

Uses the **locality principle**: the `.gitignore` entry is placed in the deepest directory before the first wildcard segment (the parent directory for a literal path). For example, `d:/documents/temp/**/*.tmp` results in a `.gitignore` at `d:/documents/temp/` containing `**/*.tmp`.

Adding a pattern that is already present succeeds without writing (`action: "added"`). Removing deletes every line equal to the pattern; a missing `.gitignore` or pattern is `404 not_found`. `.gitignore` only affects untracked files: a file git already tracks keeps being committed until it is removed from the index. With the default `watch.respectGitignore: true`, the watcher also stops reacting to the newly ignored files, so later changes to them are neither versioned nor re-embedded.

---

### GET /vcs/check-exclusion

Check whether a file is excluded by `.gitignore`.

#### Request

```bash
curl "http://localhost:1936/vcs/check-exclusion?path=d:/documents/temp/scratch.tmp"
```

| Param  | Type     | Description                                |
| ------ | -------- | ------------------------------------------ |
| `path` | `string` | **Required.** Absolute file path to check. |

#### Response

```json
{
  "excluded": true,
  "rule": "**/*.tmp",
  "source": "temp/.gitignore"
}
```

| Field | Type | Description |
| --- | --- | --- |
| `excluded` | `boolean` | Whether the file is ignored by git (`git check-ignore`). Any `git check-ignore` failure also reads as `false`. |
| `rule` | `string?` | The matching `.gitignore` pattern (if excluded). |
| `source` | `string?` | The `.gitignore` file containing the rule, as git reports it (relative to the root). |

---

### OpenClaw Plugin Tools

The OpenClaw plugin exposes each endpoint as a tool. Tool errors read `HTTP <status> <code>: <message>`.

| Tool | Endpoint | Parameters |
| --- | --- | --- |
| `watcher_vcs_status` | `GET /vcs/status` | none |
| `watcher_vcs_history` | `GET /vcs/history` | `glob` (required), `since`, `until`, `limit` |
| `watcher_vcs_show` | `GET /vcs/show` | `path`, `commit` (both required) |
| `watcher_vcs_diff` | `GET /vcs/diff` | `glob`, `commit` (both required), `commitEnd` |
| `watcher_vcs_revert` | `POST /vcs/revert` | `glob`, `commit` (both required), `existingOnly` |
| `watcher_vcs_exclude` | `POST /vcs/exclude` | `glob` (required), `root`, `remove` |
| `watcher_vcs_check` | `GET /vcs/check-exclusion` | `path` (required) |

There are no VCS CLI commands.

---

## AI Commit Messages

When `commitMessage.enabled` is `true` (the default) and an API key resolves, the VCS subsystem generates one-line commit messages using an LLM.

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

Currently only the `"anthropic"` provider is supported (Anthropic Messages API). An unsupported provider logs a warning on each commit and falls back to the template.

### Auth Resolution

The API key is resolved once at startup, per root, in order:

1. **Config key:** `commitMessage.apiKey` (with `${ENV_VAR}` substitution).
2. **OpenClaw gateway config:** `models.providers.<provider>.apiKey` in `~/.openclaw/openclaw.json` on the watcher host. The watcher reads the key and calls the provider directly; nothing is routed through the gateway.

If neither yields a key, a warning is logged and every commit uses the template message.

### Fallback Behavior

AI generation is skipped for baseline commits and for retry attempts of a batch. If the LLM call fails (timeout, non-OK response, unsupported provider, empty reply), the commit uses the template message (`watcher: batch <ISO timestamp> (<n> files)`). The request sends the changed file paths and the staged diff (`--stat` plus patch) cut to 4000 characters, with a 15-second timeout; the reply is trimmed to 100 characters.

### Reversion Messages

Revert commits start with `revert: {glob} to {shortCommit} — `. The rest is the AI description when one is generated, otherwise `restored <n> files` (see [POST /vcs/revert](#post-vcsrevert)).

---

## Remote Push

Each root with a `remote` pushes after every commit that creates a commit (`git push <remote> HEAD`, i.e. the current branch to the same name on the remote). The URL is used directly; no git remote is configured in the repository.

### Configuration

```json
{
  "watch": {
    "paths": [
      {
        "path": "d:/documents/**/*.md",
        "vcs": {
          "enabled": true,
          "remote": "https://github.com/org/docs-backup.git",
          "accessToken": "${DOCS_GIT_TOKEN}"
        }
      }
    ]
  },
  "vcs": {
    "enabled": true,
    "defaultAccessToken": "${GIT_ACCESS_TOKEN}"
  }
}
```

- **`remote`:** Git remote URL (per-root only).
- **`accessToken`:** Per-root token. Falls back to `defaultAccessToken` from the root-level `vcs` block.
- For HTTPS remotes, the token is sent to git as an HTTP `Authorization` header (Basic, user `x-access-token`, which GitHub accepts) scoped to the remote URL, for that one push only. It is passed through the environment, never on the command line or in the URL, and configured credential helpers are bypassed so the push can never block on an interactive prompt. The token is ignored for non-HTTPS remotes (configured credential helpers stay in effect there, with interactive prompts disabled).
- Push error messages (in logs and `pushErrors`) are scrubbed of the token in raw, URL-encoded, and base64 forms.

### Push Error Handling

Push failures are **non-blocking**: the commit succeeds locally regardless. Errors are recorded in `GET /vcs/status` under `pushErrors` for the affected root. The remote is treated as a backup mirror, not a primary store.

---

## Squash Retention

The VCS subsystem periodically squashes old commits to prevent unbounded history growth. Retention defaults apply automatically when `vcs.enabled` is `true`, even if the `retention` block is omitted from config. The defaults are: 30 days max age, 100 versions max, daily midnight cron schedule.

### Retention Rules

Two retention limits work together, and the **tighter** constraint wins:

- **`maxAgeDays`** (default: 30): commits older than this are eligible for squash.
- **`maxVersions`** (default: 100): only the most recent N commits are kept as individual commits.

Everything older than the boundary becomes one parentless `historical baseline` commit with the boundary's tree.

### Cron Schedule

Squash runs on a cron schedule configured via `retention.squashCron` (default: `"0 0 * * *"`, daily at midnight). The scheduler is watcher-internal: it checks the expression once a minute against the host's local time, so no external cron daemon or task scheduler is needed.

The cron expression uses the 5-field format (`minute hour day-of-month month day-of-week`) with numbers only, and supports wildcards (`*`), lists (`1,15`), ranges (`1-5`), and steps (`*/6`). Day-of-week `0` and `7` both mean Sunday. Unlike standard cron, a restricted day-of-month and day-of-week must **both** match. An expression without exactly five fields never fires (no error is logged).

### Squash Mechanism

1. Refuse if `index.lock` exists or an in-progress git operation is present (see [Safety Guards](#safety-guards)).
2. **Pause** the commit pipeline (pending commits are drained first).
3. Refuse if tracked files have uncommitted changes.
4. Read the commit log and compute the retention boundary; stop if there is nothing to squash.
5. Check out a temporary orphan branch at the last commit to squash and create a single `historical baseline` commit from its tree (`commit-tree`).
6. Cherry-pick all retained commits on top.
7. Force-update the **configured branch** (from `vcs.branch`) to the new history, check it out and delete the temporary branch.
8. Force-push if a remote is configured.
9. **Resume** the commit pipeline.

All git operations during squash have explicit timeouts (30s standard, 120s for cherry-pick, 60s for push) to prevent permanent pipeline freezes from hung git processes.

### Pause/Resume Coordination

Squash pauses the VcsManager commit pipeline before rewriting history. This drains any pending commits, then blocks new commits from executing during the squash. File changes that arrive during the squash are queued in the pending set and committed after resume. The resume always fires (via a `finally` block), even if the squash fails.

### Force Push After Squash

If a remote is configured, the squashed history is force-pushed. This is acceptable because the remote is a **backup mirror**: no other writers commit to it. A failed force push is logged; the local squash stands.

### Lock Contention

If `index.lock` is held by another git operation when the squash starts, the squash aborts cleanly (`Squash aborted: index.lock exists, will retry next cycle`) and runs again at the next cron match. No data is lost.

### Safety Guards

The squash rewrites history in the working tree (`reset --hard`, `checkout -f`), so it refuses to run when doing so could lose data or wedge the repo. Each refusal is logged and retried at the next cron match:

- **In-progress git operation.** If `.git/sequencer`, `.git/rebase-merge`, `.git/rebase-apply`, `.git/CHERRY_PICK_HEAD`, or `.git/MERGE_HEAD` exists, the squash refuses (error log). The watcher never clears this state itself; resolve it manually (e.g. `git cherry-pick --quit`, `git rebase --abort`, `git merge --abort`). The same condition is reported at startup.
- **Uncommitted tracked changes.** After draining the commit pipeline, if `git status --porcelain --untracked-files=no` reports anything, the squash refuses (warning log) rather than overwrite uncommitted content. Untracked files do not block.
- **Failed squash cleanup.** If a squash fails midway, `git cherry-pick --abort` runs before returning to the configured branch (and the temporary branch and any leftover `index.lock` are removed), so a failure never leaves a half-finished cherry-pick sequence behind.

### Startup Orphan Recovery

If the service starts and a VCS root is on an unexpected branch (e.g., a leftover squash orphan branch from a crash), the VcsManager detects this during startup and recovers:

1. Reads the current branch via `git rev-parse --abbrev-ref HEAD`
2. If it differs from the configured `branch`, force-updates the configured branch to the current HEAD
3. Checks out the configured branch

Orphan branches are **not deleted**: they serve as a recovery safety net. If recovery fails, the error is logged and the manager continues with the current state.

### "Nothing Staged" Handling

When a batch stages nothing (e.g., a file was touched but its content is identical), the pipeline detects it with `git diff --cached --quiet` and skips `git commit`. This is a no-op, not a failure: it counts as a success for the circuit breaker, and files are not re-queued. Detection does not parse git's output text, so it is unaffected by untracked files, unstaged changes outside the batch, `status.showUntrackedFiles`, or git's message wording.

### Missing Paths in a Batch

Before staging, each batch is partitioned:

- Files that exist are staged with `git add`.
- Files that are gone but tracked have their deletion staged with `git rm --cached --ignore-unmatch`.
- Files that are gone and were never tracked (created and deleted between commits) are dropped.

A missing path never fails the batch. Paths are passed to git through stdin, so a large batch never hits the Windows command-line length limit.

### Startup Deletion Reconciliation

The initial filesystem scan only reports files that exist, so deletions that happened while the service was stopped (or unlink events that were missed) are never observed as events. When the initial scan completes, each root lists tracked-but-deleted paths (`git ls-files --deleted`), keeps those inside the watch scope (`watch.paths` minus `watch.ignored`), and adds them to the baseline batch so the deletions are committed.

### Retries and the Circuit Breaker

Only transient `index.lock` contention is retried within a commit attempt (4 attempts, exponential backoff). Any other error fails the attempt immediately with its real message.

Each commit covers at most `maxBatchSize` files; a flush with a larger backlog commits it in several chunks. When a batch fails, all of its files are re-queued (the pending set holds each path once, so it cannot grow beyond the distinct changed paths) and the throttle timer restarts so they are retried automatically. After `maxConsecutiveFailures` consecutive failures the per-root circuit breaker trips:

- Pending files are **retained**, never discarded. Batches that arrive while cooling down go straight back into the pending set.
- After `circuitBreakerCooldownMs` (default 5 minutes) a single half-open commit attempt runs from a timer; no new file event is needed. Success resets the breaker; failure re-arms the cooldown.
- The breaker is **not** reset by new file events, so a busy root cannot hammer a deterministic failure.
- Breaker state is exposed per root in `GET /vcs/status` under `breaker`.

### Git Configuration Pinning

Every git invocation made by the VCS subsystem passes `-c core.longpaths=true`, so paths longer than the Windows `MAX_PATH` limit work without any repo-local or machine-wide git configuration.

---

## Exclusion Management

### `.gitignore` vs `watch.ignored`

These are separate settings:

- **`.gitignore`:** controls what git tracks. Managed via `POST /vcs/exclude`.
- **`watch.ignored`:** controls what the watcher monitors at all (for both embedding and versioning). Set in config.

With the default `watch.respectGitignore: true`, the watcher skips git-ignored files entirely, so a git-ignored file is neither embedded nor versioned. With `respectGitignore: false`, git-ignored files are embedded, but see the [caution above](#what-gets-versioned) about versioning them.

### Always-On Entries

The VCS subsystem automatically adds these to every root's `.gitignore`:

- `.git/`
- `node_modules/`
- `.jeeves-watcher/`
- `.jeeves-metadata/`

These entries are re-added on every startup (missing ones are appended) and cannot be removed via the API.

### Locality Principle

When adding a `.gitignore` entry via `POST /vcs/exclude`, the entry is placed in the **deepest appropriate directory**. For example, excluding `d:/documents/temp/**/*.log` places `**/*.log` in `d:/documents/temp/.gitignore`, not at the root.

---

## Deployment Notes

### Git Soft Dependency

Git is a **soft dependency**. If `git` is not found on `PATH` at startup:

- The watcher logs `git not found on PATH — VCS disabled for this session` and skips repository initialization and the state directory check.
- All non-VCS features (embedding, search, metadata) work without git.
- The per-root commit pipelines are still created, so their commit attempts fail and the circuit breaker trips (see `breaker.lastError` in `GET /vcs/status`). Set `vcs.enabled: false` if git will not be installed.

### State Directory Overlap

When VCS is enabled, the `stateDir` (default `.jeeves-metadata`) must **not** overlap with any watch path's root (same directory, parent or child). The watcher validates this at startup and fails to start if an overlap is detected. This prevents the watcher from versioning and indexing its own state files.

### Child Repositories

If a watch root contains child git repositories (nested `.git/` directories), git does not add their files to the parent root's repository: changes inside a child repository are silently not versioned. The child `.git/` directories themselves are excluded via the always-on `.gitignore` entries. Use separate watch roots, or keep child repositories outside VCS-enabled roots.

---

## Troubleshooting

### index.lock Contention

**Symptom:** Commits fail with `index.lock` errors.

**Cause:** Another git process (IDE, manual git command, squash) holds the lock, or a crashed process left a stale lock file behind.

**Automatic recovery:** The VCS subsystem handles lock contention automatically:

1. **Stale lock detection.** Before each batch commit, the lock file's modification time is checked. If it's older than `staleLockThresholdMs` (default: 60 seconds), the lock is force-removed (`Removed stale index.lock`) and the commit proceeds.
2. **Exponential backoff retries.** If the lock is fresh (held by a live process), the commit is retried with exponential backoff (4 attempts, 500ms-2s delays).
3. **Retention.** If all retries fail, the batch's files are re-queued in full for the next batch cycle. Nothing is discarded.
4. **Circuit breaker.** After `maxConsecutiveFailures` (default: 5) consecutive commit failures, the breaker trips. Pending files are retained, and a single recovery attempt runs every `circuitBreakerCooldownMs` (default: 5 minutes) until one succeeds.

No manual intervention is needed in most cases. If the circuit breaker trips, check `breaker.lastError` in `GET /vcs/status` and resolve the underlying issue. The next recovery attempt picks up the retained files automatically.

### Squash Refused

**Symptom:** Logs show `Squash refused: in-progress git operation detected (.git/<marker>)` or `Squash refused: working tree has uncommitted changes to tracked files`.

**Cause:** An abandoned cherry-pick, rebase, or merge in `.git/`, or tracked changes that the commit pipeline has not committed.

**Resolution:** For an in-progress operation, inspect the repo and clear it manually (`git cherry-pick --quit`, `git rebase --abort`, or `git merge --abort`). For uncommitted tracked changes, check `GET /vcs/status` for a tripped breaker; once commits succeed, the next squash cycle proceeds.

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

**Resolution:** Push failures are non-blocking: local commits are safe. Fix the credential or network issue and the next commit will push successfully (`lastPush` updates; earlier `pushErrors` entries remain until restart). Check logs for detailed error messages.

### Git Not Found on PATH

**Symptom:** Log contains `git not found on PATH — VCS disabled for this session`; commits fail and the circuit breaker trips.

**Resolution:** Install git and ensure it is on the system `PATH`, then restart the watcher. On Windows, the installer typically adds git to `PATH` automatically. On Linux, install via your package manager (`apt install git`, `yum install git`, etc.).

### Repo on Wrong Branch After Crash

**Symptom:** Log shows `Repo is on unexpected branch — recovering to configured branch` at startup.

**Cause:** The service crashed or was killed during a squash operation, leaving the repo on a temporary orphan branch.

**Automatic recovery:** The VcsManager detects the wrong branch at startup, force-updates the configured branch to the current HEAD, and checks out the configured branch. No manual intervention needed. The orphan branch is preserved as a safety net.

### Git Operations Timing Out

**Symptom:** Log shows timeout errors for git operations.

**Cause:** A git operation (add, commit, push, cherry-pick) took longer than its timeout.

**Resolution:** Standard operations time out at 30 seconds, cherry-pick at 120 seconds, push at 60 seconds. If timeouts occur regularly, investigate disk I/O, network connectivity (for push), or repository size (for cherry-pick during squash).

---

## Next Steps

- [Configuration Reference](./configuration.md#-version-control): VCS config schema table
- [API Reference](./api-reference.md#vcs-endpoints): full endpoint documentation
- [Architecture Guide](./architecture.md#version-control-subsystem): VCS data flow
- [Deployment Guide](./deployment.md#version-control-vcs): Git dependency and setup
- [Getting Started](./getting-started.md#enable-version-tracking): minimal VCS setup
