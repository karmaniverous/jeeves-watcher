# @karmaniverous/jeeves-watcher

Filesystem watcher that keeps a [Qdrant](https://qdrant.tech/) vector store in sync with document changes. Extract text from files, chunk it, generate embeddings, and query your documents with semantic search.

## Requirements

- **Node.js** ≥ 22

## Features

- **Filesystem watching** — monitors directories for file changes via [chokidar](https://github.com/paulmillr/chokidar)
- **Multi-format extraction** — PDF, HTML, DOCX, Markdown, plain text, and more
- **Configurable chunking** — token-based text splitting with overlap control
- **Embedding providers** — Gemini (default) or mock (for testing); extensible via provider registry
- **Qdrant sync** — automatic upsert/delete keeps the vector store current
- **Rules engine** — glob-based inference rules for metadata enrichment
- **REST API** — Fastify server for search, status, config, and management
- **CLI** — `jeeves-watcher init`, `validate`, `start`, and more

## Version Control (VCS)

The watcher supports optional git-backed version control of watched content. When enabled, every file change under a watch root is automatically committed, providing full history, diff, and revert capabilities.

### Configuration

Add a `vcs` block to your config:

```json
{
  "vcs": {
    "enabled": true,
    "commitThrottleMs": 30000,
    "maxBatchSize": 1000,
    "branch": "master",
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
    "defaultAccessToken": "${GIT_TOKEN}"
  }
}
```

| Property | Default | Description |
|----------|---------|-------------|
| `vcs.enabled` | `false` | Enable git-backed version control globally |
| `vcs.commitThrottleMs` | `30000` | Throttle interval (ms) for batching file changes into commits. Min: 1000 |
| `vcs.maxBatchSize` | `1000` | Maximum files per commit batch. Flushes immediately when exceeded. Min: 1 |
| `vcs.branch` | `"master"` | Git branch name for VCS operations. Squash retention and startup recovery target this branch |
| `vcs.commitMessage.enabled` | `true` | Enable AI-generated commit messages |
| `vcs.commitMessage.provider` | `"anthropic"` | AI provider (currently only `"anthropic"` supported) |
| `vcs.commitMessage.model` | `"claude-haiku-4-0"` | AI model for commit message generation |
| `vcs.commitMessage.apiKey` | — | API key for the commit message provider. Supports env var substitution |
| `vcs.retention.maxAgeDays` | `30` | Commits older than this are squashed into a baseline |
| `vcs.retention.maxVersions` | `100` | Maximum commits retained per root (older ones squashed) |
| `vcs.retention.squashCron` | `"0 0 * * *"` | Cron schedule for squash retention (5-field, checked every 60s) |
| `vcs.defaultAccessToken` | — | Fallback git access token for all roots. Supports env var substitution |

### Per-Root Overrides via `watch.paths`

Watch path entries can be objects with per-root VCS overrides:

```json
{
  "watch": {
    "paths": [
      "J:/domains/notes/**/*.md",
      {
        "path": "J:/domains/jira/**/*.json",
        "vcs": {
          "enabled": false
        }
      },
      {
        "path": "J:/domains/email/**/*.json",
        "vcs": {
          "remote": "https://github.com/org/email-archive.git",
          "accessToken": "${GITHUB_TOKEN}",
          "retention": {
            "maxAgeDays": 7,
            "maxVersions": 50
          }
        }
      }
    ]
  }
}
```

Per-root properties (`remote`, `accessToken`) are only available in per-root overrides. All other `vcs.*` properties can be overridden per root.

### Deployment Notes

- **Git dependency:** `git` must be on the system PATH. The watcher initializes a git repository in each VCS-enabled watch root automatically.
- **stateDir:** The `.jeeves-metadata/` directory (configurable via `stateDir`) is always gitignored. VCS state (git repos) lives inside the watch roots themselves, not in stateDir.
- **Filesystem constraints:** Each VCS-enabled watch path entry must resolve to a single directory root (not a glob with wildcards in directory segments).

### Remote Push

When `remote` is set on a per-root VCS config, the watcher pushes to the remote after every commit. Configure authentication via `accessToken` (per-root) or `defaultAccessToken` (global fallback):

```json
{
  "vcs": {
    "enabled": true,
    "defaultAccessToken": "${GIT_TOKEN}"
  },
  "watch": {
    "paths": [
      {
        "path": "J:/domains/notes",
        "vcs": {
          "remote": "https://github.com/org/notes-archive.git"
        }
      }
    ]
  }
}
```

Push failures are logged and recorded in `/vcs/status` but do not block commits.

### Squash Retention

To prevent unbounded history growth, the squash retention system periodically compresses old commits into a single baseline. Controlled by `vcs.retention`:

- **`maxAgeDays`** and **`maxVersions`** define retention boundaries. The tighter constraint wins — if `maxAgeDays: 30` would keep 200 commits but `maxVersions: 100` caps at 100, only 100 are retained.
- **`squashCron`** controls when squash runs (e.g., `"0 0 * * *"` = daily at midnight). Checked every 60 seconds.
- After squash, old commits are replaced with a single "historical baseline" commit. If a remote is configured, squash triggers a force push.

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/vcs/status` | GET | VCS state for all roots |
| `/vcs/history` | GET | Commit history for a path/glob |
| `/vcs/show` | GET | File content at a specific commit |
| `/vcs/diff` | GET | Diff between commits |
| `/vcs/revert` | POST | Restore files from a past commit |
| `/vcs/exclude` | POST | Manage gitignore exclusions |
| `/vcs/check-exclusion` | GET | Check gitignore status of a path |

## JsonMap Built-in Helpers

The following helpers are available in every JsonMap `lib` context:

| Helper | Description |
|--------|-------------|
| `split(str, sep)` | Split a string into an array |
| `slice(arr, start, end?)` | Slice an array |
| `join(arr, sep)` | Join an array into a string |
| `toLowerCase(str)` | Lowercase a string |
| `replace(str, search, replacement)` | String replacement |
| `get(obj, path)` | Dot-path property access |
| `lookupJson(filePath, key, field?)` | Load a JSON file and look up a value by key |
| `mapLookup(filePath, keys, field)` | Map keys through a JSON lookup, collecting a field from each |
| `fetchSiblings(filePath, options?)` | Extract text from neighboring files for contextual embedding |

### `fetchSiblings`

Retrieves extracted text from sibling files in the same directory, useful for contextual embedding (e.g., injecting surrounding email thread messages).

**Options:** `{ before?: number (default 3), after?: number (default 1), sort?: "name" | "mtime" (default "name") }`

Returns `string[]` of extracted text. Files that fail extraction are silently skipped.

## Install

```bash
npm install @karmaniverous/jeeves-watcher
```

## Quick Start

```bash
# Generate a config file
npx jeeves-watcher init --output ./jeeves-watcher.config.json

# Validate it
npx jeeves-watcher validate --config ./jeeves-watcher.config.json

# Start the watcher
npx jeeves-watcher start --config ./jeeves-watcher.config.json
```

## Documentation

Full docs, guides, and API reference:

**[docs.karmanivero.us/jeeves-watcher](https://docs.karmanivero.us/jeeves-watcher)**

## License

BSD-3-Clause
