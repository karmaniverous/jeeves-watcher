---
title: Upgrading
---

# Upgrading

What changes for an existing deployment, release by release. The [Changelog](../CHANGELOG.md) lists every commit; this page lists what you may need to act on.

## 0.22.1

0.22.1 ships with OpenClaw plugin 0.20.0, on watcher-core 0.6.0 and SDK 0.4.0 (both unchanged) and `@karmaniverous/jeeves` 0.11.0. Nothing changes on the wire, in the config or in the tools' names and parameters; what changes is how the packages are installed (spec D205).

- **The service depends on the SDK.** `@karmaniverous/jeeves-watcher-sdk` `^0.4.0` is a runtime dependency that npm installs with the service; the CLI used to carry its own copy. A `WatcherError` the CLI sees is now the class the installed SDK exports.
- **The plugin depends on watcher-core and the SDK, and calls the watcher through the SDK.** `openclaw plugins install` installs both (`^0.6.0`, `^0.4.0`); 0.19.0 bundled watcher-core and called the API through jeeves's toolset. Every result reads as in 0.19.0, error bodies included (the server's body verbatim), except in these cases:
  - A successful reply is parsed with the SDK's response schema (watcher-core 0.6.0's, which service 0.22.x follows). A reply the schema rejects reads `Error: <entry> response did not match the expected shape`; a field the schema does not declare is dropped; an object's keys print in schema order. Service 0.22.x sends none of these, so they show only against another server or a proxy.
  - An `apiUrl` without `http://` or `https://` reads `Error: baseUrl must be an http(s) URL, got "<apiUrl>"` (0.19.0: `fetch`'s `Error: fetch failed`).
  - An `apiUrl` with a query string or fragment reads `Error: baseUrl must not contain a query string or fragment, got "<apiUrl>"` and sends nothing (0.19.0 sent the request to a garbled path such as `/?x=1/search`).

### Install order

1. Install `@karmaniverous/jeeves-watcher` 0.22.1 as for 0.22.0 ([Install order](#install-order-1) step 1).
2. Install OpenClaw plugin 0.20.0 the same way as in 0.21.0's [Upgrade order](#upgrade-order) step 3, with `@0.20.0`. Use it with service 0.22.0 or later; the service and the plugin can go in either order.

## 0.22.0

0.22.0 ships with watcher-core 0.6.0, SDK 0.4.0 and OpenClaw plugin 0.19.0, all on `@karmaniverous/jeeves` 0.11.0 (pinned exactly). It changes one contract: every error the watcher sends is now Fastify's standard error body with an upper-case code. Successful responses are unchanged except `POST /vcs/exclude`'s confirmation, which is now a `200`. The CHANGELOGs are generated at release, so the table of old and new codes lives here.

### Install order

1. Stop the service, install `@karmaniverous/jeeves-watcher` 0.22.0 (it brings watcher-core 0.6.0) and start it. The config file needs no change.
2. At the same time, upgrade anything that uses the SDK to 0.4.0 and update every client that branches on an error `code`, reads `details` or `issueType` from an error body, or treats `409` from `POST /vcs/exclude` as "confirm needed" ([Clients](#clients)).
3. Install OpenClaw plugin 0.19.0 the same way as in 0.21.0's [Upgrade order](#upgrade-order) step 3, with `@0.19.0`. Its tools are unchanged; its bundled skill and prompt rules describe the new codes.

### The error body

Every non-2xx response is `{ statusCode, code?, error, message }` (`errorBodySchema` in `@karmaniverous/jeeves/catalog`):

```json
{
  "statusCode": 404,
  "code": "WATCHER_SOURCE_NOT_INDEXED",
  "error": "Not Found",
  "message": "The source document is not indexed."
}
```

- **`error` is now the HTTP reason phrase** (`Not Found`), not the watcher's text. The watcher's own explanation is in `message`, a fixed sentence written for the caller.
- **`details`, `issueType`, `issues` and `untracked` are gone** from error bodies. What they carried is folded into `message` where the caller needs it (the unknown rule names, the fields without a payload index, the failing metadata properties, the rule compiler's explanation, Qdrant's reason for rejecting a filter; each capped at 300 characters), and otherwise goes to the service log (the source callback's status and error, the extraction or rule error of a failed render and its issue type and `details`, the Qdrant error object, the embedding error).
- **No message names a filesystem path, host or library error.** `Path not found: <path>`, `Path is neither a file nor a directory: <path>` and `Excluding <pattern> would untrack <n> files` lose the path.
- **Codes are upper case.** A watcher code is `WATCHER_*`; request validation and Fastify's body errors carry Fastify's `FST_ERR_*` codes; `GET /config` and `POST /config/apply` errors carry jeeves's `JEEVES_*` codes.
- **An unexpected failure has no code.** It is a masked `500` with the message `The server could not complete the request.` (0.21: `{ "code": "internal_error", "error": "Internal Server Error", "message": "Internal server error" }`); branch on the status. The cause is logged once.
- **Headers:** `Retry-After` only on a busy document lock (`10`), a busy root git lock (`30`) and an unavailable embedding provider (when the back-off is known), and the message says the wait too. No `WWW-Authenticate` on `401`, no `Cache-Control` on an error.
- **Response validation:** a response that fails its schema is `500 JEEVES_RESPONSE_VALIDATION` (0.21: `500 internal_error`, `error: "Response validation failed"`).

### Old and new codes

One row per 0.21 code. Where an old code was sent in several cases, the new code can depend on the case; see [Error Handling](./api-reference.md#error-handling) for every message.

| 0.21 status and code | 0.22 status and code |
| --- | --- |
| `400 invalid_request` | `400 FST_ERR_VALIDATION`: the body, query or path parameters fail the route's schema (`details` gone; `message` joins the failures). Fastify's own `FST_ERR_CTP_*` code and status (`400`, `413`, `415`): malformed or empty JSON body, body too large, unsupported media type. `400 JEEVES_CONFIG_QUERY_INVALID`: `GET /config` with an invalid JSONPath. `400 JEEVES_CONFIG_INVALID`: `POST /config/apply` whose merged config fails the schema (`issues` folded into `message`). `400 WATCHER_INVALID_REQUEST`: Qdrant rejects a filter (`search`, `scan`, `countFacets`, `deletePoints`, `deleteDocuments`); a facet field without a usable payload index; an empty or unknown `rules` list; metadata that fails the matched rules' schemas; rules that do not compile; a `reindex` path that is neither file nor directory; a refused `excludeVcsPath` glob. |
| `401 unauthorized` | `401 WATCHER_UNAUTHORIZED` |
| `403 path_not_watched` | `403 WATCHER_PATH_NOT_WATCHED` |
| `404 not_found` | `404 WATCHER_NOT_FOUND` (unknown or gated route, missing file or path, no VCS root, file not at the commit, pattern not excluded) |
| `404 source_not_indexed` | `404 WATCHER_SOURCE_NOT_INDEXED` |
| `404 source_not_found` | `404 WATCHER_SOURCE_NOT_FOUND` |
| `409 confirm_required` | none: `200 { "confirmRequired": true, "untracked": <n> }` ([VCS exclude](#vcs-exclude-confirmation)) |
| `422 unsupported_content_type` | `422 WATCHER_UNSUPPORTED_CONTENT_TYPE` |
| `422 pipeline_error` | One code per issue type, `422 WATCHER_PIPELINE_<TYPE>_ERROR`: `WATCHER_PIPELINE_EXTRACTION_ERROR` (a file's extraction, or an untagged source failure), `WATCHER_PIPELINE_RULE_MISSING_ERROR`, `WATCHER_PIPELINE_MATCH_FAILED_ERROR`, `WATCHER_PIPELINE_NO_CONTENT_ERROR`, `WATCHER_PIPELINE_INTERPOLATION_ERROR`. `issueType` and `details` leave the body. |
| `502 source_unavailable` | `502 WATCHER_SOURCE_UNAVAILABLE` |
| `503 not_available` | `503 WATCHER_NOT_AVAILABLE` (no source support, no filesystem watcher, a system index not ready, the facet count budget, a busy document lock with `Retry-After: 10`, a busy root git lock with `Retry-After: 30`) |
| `400 not_available` (`reindex` scope `prune` without a vector store) | `503 WATCHER_NOT_AVAILABLE` ([Status changes](#status-changes)) |
| `503 scan_in_progress` | `503 WATCHER_SCAN_IN_PROGRESS` |
| `503 embedding_unavailable` | `503 WATCHER_EMBEDDING_UNAVAILABLE` |
| `500 internal_error` | No code: the masked `500` for any unexpected failure (including `checkVcsExclusion`'s git failure). `500 JEEVES_RESPONSE_VALIDATION`: a response that fails its schema. `500 JEEVES_CONFIG_READ_FAILED` / `500 JEEVES_CONFIG_WRITE_FAILED`: `POST /config/apply` cannot read or write the config file. |

`<TYPE>` is the issue type in upper case with a trailing `_error` dropped. Four more pipeline codes are defined but no route raises them today: `WATCHER_PIPELINE_TYPE_COLLISION_ERROR`, `WATCHER_PIPELINE_EMBEDDING_ERROR`, `WATCHER_PIPELINE_UPSERT_ERROR` and `WATCHER_PIPELINE_TOO_LARGE_ERROR`.

### Status changes

- **`POST /vcs/exclude` over the threshold:** `409` becomes `200` ([below](#vcs-exclude-confirmation)).
- **`POST /reindex` scope `prune` without a vector store:** `400 not_available` becomes `503 WATCHER_NOT_AVAILABLE` (`Prune needs a vector store, and none is configured.`), so every `WATCHER_NOT_AVAILABLE` is a `503`.

Every other status is unchanged (Fastify's own body errors keep Fastify's status, as before).

### VCS exclude confirmation

Without `confirm: true`, an exclusion that would untrack more than 100 files changes nothing and answers `200 { "confirmRequired": true, "untracked": <n> }`. The response is a union with the usual `{ ok, file, action, untracked }`; tell them apart by `confirmRequired`, check the count with whoever asked, then repeat with `confirm: true`.

### Clients

- **watcher-core 0.6.0:** `API_ERROR_CODES`, `API_ERROR_STATUS`, `ApiErrorCode`, `apiErrorCodeSchema`, `apiErrorBodySchema`, `apiErrorResponseSchema` and the types `ApiErrorBody` and `ApiErrorResponse` are removed, with no deprecation period. New: `WATCHER_ERROR_CODES` (every `WATCHER_*` code), `WATCHER_ERROR_STATUS` (each code's status) and the type `WatcherErrorCode`. Parse error bodies with jeeves's `errorBodySchema`. `vcsExcludeResponseSchema` is now the union above.
- **SDK 0.4.0:** `WatcherError.code` is the body's `code` (`WATCHER_*`, `FST_ERR_*` or `JEEVES_*`), or `http_<status>` when the body has none (a masked `500`, a proxy's page); `WatcherError.message` is the body's `message` (0.3: `<error>: <message>`); `details` is the whole body (the server sends no `details` field any more). `retryAfterMs` is unchanged. The SDK's own codes stay lower case (`invalid_options`, `invalid_request`, `invalid_response`, `timeout`, `network_error`), so a client-side `invalid_request` can no longer be confused with a server code. The `API_ERROR_CODES` and `ApiErrorCode` re-exports are replaced by `WATCHER_ERROR_CODES` and `WatcherErrorCode`. `excludeVcsPath` returns the union: check `'confirmRequired' in result`.

  ```ts
  // 0.3.x
  if (err.code === 'not_available') retryLater(err.retryAfterMs);
  // 0.4.0
  if (err.code === 'WATCHER_NOT_AVAILABLE') retryLater(err.retryAfterMs);
  ```

- **CLI:** errors still print `<code>: <message>`, now with the new codes and messages. `vcs exclude` without `--confirm` over the threshold prints `Not excluded: <n> files would be untracked. Repeat with --confirm.` to stderr and exits `1` (0.21: `confirm_required: ...`, also exit `1`).
- **OpenClaw plugin 0.19.0:** no tool changes; tool errors still read `HTTP <status>: <body>` with the new body verbatim. Prompts or skills of your own that name an old code need the new one.

### jeeves 0.11.0

- **`@karmaniverous/jeeves` 0.11.0** (was 0.9.0), pinned exactly in all four packages. Its catalog scope answers every error and masks anything that is not a deliberate one.

### Other fixes

- **A moved file that had no points is indexed at its new path** (#305). A file never indexed, rejected `too_large` or failing extraction, moved by itself or with its folder (a paired directory move), used to log `No points found for move` and stay unindexed; now its new path is processed as a create (its enrichment moves with it) and the old path's issue is dropped.
- **The stability check reads the clock before the file stats** (#306), so a stall in the watcher between a `stat` and its continuation can only delay a file settling, never settle it early.

### Rollback to 0.21.1

Reinstall service 0.21.1, SDK 0.3.x and plugin 0.18.x together, and revert client changes made for the new codes. Nothing on disk changes between the versions.

## 0.21.0

0.21.0 ships with watcher-core 0.5.0, SDK 0.3.0 and OpenClaw plugin 0.18.0, all on `@karmaniverous/jeeves` 0.9.0. The sections below the first three follow the feature areas; the [rollback](#rollback-to-0200) closes the page.

### Before you upgrade

1. **Node.js 24.22.2 or later** on the host ([Node.js](#nodejs)).
2. **List the files the new ceilings will remove from search** with the corpus survey, and raise a ceiling first for any that must stay searchable ([Processing at scale](#processing-at-scale)).
3. **Linux:** raise `fs.inotify.max_queued_events` (and keep `fs.inotify.max_user_watches` raised) before installing: parcel cannot detect an inotify queue overflow, so a too-small queue loses events silently until the next periodic reconcile ([Deployment](./deployment.md#linux-inotify-limits)).
4. **Windows:** make sure the service manager restarts the service when it exits ([Deployment](./deployment.md#windows-nssm), [Change source](#change-source-and-reconciliation)). `LongPathsEnabled = 1` stays recommended for other tools, but it gives the watcher no events for long paths ([Windows long paths](./deployment.md#windows-long-paths)).
5. **Move anything that tails `logging.file`** to the newest rotated file, and stop any external rotation of it ([Logging](#logging)).
6. **Plan the client updates:** the SDK and the plugin move with the service, and the plugin renames ten tools, so tool allow-lists, prompts, skills and scripts that name the old tools change with it ([OpenClaw plugin 0.18.0](#openclaw-plugin-0180)).

### Upgrade order

1. Stop the service, install `@karmaniverous/jeeves-watcher` 0.21.0 (it brings watcher-core 0.5.0; install without `--omit=optional`, see [Dependencies](#dependencies)), and start it. The config file needs no change: every new key has a default.
2. Upgrade anything that uses the SDK to 0.3.0 at the same time ([SDK 0.3.0](#sdk-030)).
3. Install OpenClaw plugin 0.18.0 and update every caller of the renamed tools in the same change. With the OpenClaw CLI:

   ```bash
   openclaw plugins install npm:@karmaniverous/jeeves-watcher-openclaw@0.18.0 --pin --accept-capabilities --force
   ```

   `--force` confirms the npm source and replaces the installed plugin; without it a non-interactive install is cancelled (`Install cancelled; rerun with --force after reviewing the source.`). On a Jeeves box, use `jeeves install` with the flags your deployment uses (it runs the same command with `--force` and keeps the plugin config), from any folder:

   ```bash
   jeeves install --workspace <workspace> --config-root <configRoot> watcher@0.18.0
   ```

   Without `--workspace`, `jeeves install` takes the current folder as the workspace and writes its platform files (`AGENTS.md`, `SOUL.md`, `config/`) there. Add `--managed` and `--watcher-api-url <url>` if your deployment installs with them.

### First start

The first 0.21.0 start does more than a restart:

- **The start walk** of each root (parcel's initial scan) enqueues every matched file; the processor skips unchanged content, so only new or changed files are embedded.
- **Files over a processing ceiling** have their points deleted and a `too_large` issue recorded ([Processing at scale](#processing-at-scale)).
- **Files that no longer extract** (for example front matter with `!!float 1`) have their points deleted and an `extraction_error` issue recorded ([Front matter](#front-matter)).
- **The index check** deletes the documents of files deleted while the service was down, including under earlier versions, unless more than 10% (once more than 20 are missing) or more than 1,000 of a root's documents are missing ([Change source](#change-source-and-reconciliation)).
- **Three system payload indexes** (`chunk_index`, `file_path`, `matched_rules`) are built in the background; until they are `ready`, metadata writes address chunks by ID and the facet counts route answers `503` ([Facets](#facets)).
- **Each root's repair** removes a stale `index.lock`, sweeps git temp files and finishes an interrupted untrack ([Version control](#version-control)).
- **Tracked files over `vcs.maxFileBytes`** are untracked, in a commit of their own, though they did not change: the start walk enqueues them ([Version control](#version-control)).

`GET /status` shows each of these: `health.indexCheck`, `health.collection.systemIndexes`, `health.changeSource` and `GET /issues` (`too_large`).

### New configuration keys

Every key is optional; the defaults apply without a config change. Byte sizes take a number of bytes or a string with a `k`, `m` or `g` suffix (binary units).

| Key | Default | Takes effect |
| --- | --- | --- |
| `vcs.maxFileBytes` (also per root, `watch.paths[].vcs.maxFileBytes`) | `100000000` (`0` off) | reload |
| `logging.rotation` | `{ maxSize: '10m', frequency: 'daily', maxFiles: 14 }` when `logging.file` is set; `false` off | restart |
| `embedding.alertUrl` | unset | reload |
| `processing.maxFileBytes` | `'64m'` | reload |
| `processing.maxChunksPerFile` | `5000` | reload |
| `processing.maxTextBytes` | `'8m'` | reload |
| `watch.changeSource` | `parcel` (`chokidar`; `usePolling: true` forces chokidar) | reload (rebuilds the watcher; on Windows under parcel, a restart) |
| `watch.reconcileIntervalMs` | `900000` (`0` off) | reload |
| `watch.indexCheckOnStart` | `true` | next start |

See [Configuration](./configuration.md) for each.

### Node.js

- **Node.js 24.22.2 or later is required** (was 22.13). Every package (`@karmaniverous/jeeves-watcher`, `-core`, `-sdk`, `-openclaw`) declares `engines.node >=24.22.2`, so `npm install` on an older Node prints an `EBADENGINE` warning and fails with `engine-strict`. Upgrade Node before upgrading the watcher.
- Why 24.22.2: on a Jeeves host running Node.js 24.18.0, SQLite write-ahead logs stopped checkpointing and grew without bound; after the host moved to 24.22.2, checkpoints and log sizes were normal again. The watcher keeps its enrichment store in SQLite through the built-in `node:sqlite` module, so it takes the same floor. It is the floor for every Jeeves component, and it also meets unpdf 2's own `>=24` (spec D188).

### Logging

- **`logging.file` now rotates by default** (10 MiB, daily, 14 rotated files kept plus the active one). Every file, the active one included, is named `<name>.<yyyy-MM-dd>.<n>.<ext>` (`watcher.2026-11-04.1.log` for `watcher.log`), so a plain `watcher.log` is no longer written. Point anything that tails the log at the newest file by modification time.
- Rotation deletes older files matching that name pattern, so keep the log in a folder of its own. A single `watcher.log` left by 0.20.0 is not managed by rotation: archive it, then delete it.
- If you rotate the file externally (logrotate), either remove that rotation or set `logging.rotation: false` to keep one plain file.
- The rotating stream runs in the main thread (no worker), and a refusal to start is also written to stderr, so a service manager's stderr log shows why the service stopped.
- See [Configuration](./configuration.md#logging-logging-configuration).

### Version control

- **`vcs.maxFileBytes` (default 100,000,000 bytes) caps what git versions.** A new file over the cap is not staged. A tracked file already over it is untracked, in a commit of its own just before the batch's commit, at the first 0.21.0 start (the start walk enqueues every file) or, for a file that grows past the cap later, the next time it changes: its history ends at its last committed version and the file stays on disk. The log names each one (`Tracked file is over vcs.maxFileBytes: untracking it`). Set `0` to keep the old behaviour. See [File Size Cap](./version-control.md#file-size-cap).
- **Folder rules over tracked files no longer trip the breaker.** Tracked files are staged with `git add -u` and new files with plain `git add`, so a folder rule in a `.gitignore` or `.git/info/exclude` over files git still tracks no longer fails every batch (0.20.0 tripped the circuit breaker). Those files keep being versioned until they are untracked.
- **Paths are passed to git literally.** 0.20.0 could stage `a1.md` when given `a[1].md`; 0.21.0 cannot. Files wrongly staged that way stay tracked until excluded.
- **Squash rewrites history with plumbing only.** It no longer needs a clean working tree or a free `index.lock`, never checks out, resets or cherry-picks, and keeps files untracked by `/vcs/exclude` or the size cap on disk with their newest content. Retained commits keep their messages, identities and dates byte for byte; a commit recorded with a non-UTF-8 `encoding` header (`i18n.commitEncoding`) is rebuilt with `git hash-object`, so its header and message bytes survive too (its signature, like every rewritten commit's, is dropped). It still refuses while a merge, rebase, cherry-pick or revert is in progress.
- **No startup branch recovery.** 0.21.0 never moves `vcs.branch` or checks out a branch. If HEAD is on another branch, or a `__squash_orphan_*` branch is left from an interrupted 0.20.0 squash (HEAD is then usually on that branch), the service logs a warning and squash refuses. Recover by hand: check what the branch holds, `git checkout <vcs.branch>`, then delete the leftover branch.
- **Startup repairs each root:** a stale `index.lock` is removed, abandoned git temp files are swept, and an untrack interrupted by a crash is finished (or discarded, with its exclude pattern line removed).
- **`GET /vcs/history` and `GET /vcs/diff`** return non-ASCII paths unescaped (`résumé.md`, not `"r\303\251sum\303\251.md"`).
- **`GET /status`** gains `health.vcs` when some root has VCS enabled: the VCS root count, files pending commit, roots whose breaker is tripped, and when the longest-failing one first tripped.
- **`GET /config/schema`** shows `maxFileBytes` under `watch.paths[].vcs`, the per-root override (an approved wire departure, D185).

### VCS-only exclusion

- **`POST /vcs/exclude` writes `.git/info/exclude`, not a `.gitignore`.** An excluded file leaves version history but stays in search (0.20.0's `.gitignore` line also dropped it from the index). Tracked files the pattern matches are now untracked, in one commit, and the commit is pushed; 0.20.0 left them tracked, so they kept being committed. See [VCS-Only Exclusion](./version-control.md#vcs-only-exclusion).
- **Patterns are root-anchored.** The line is `/` plus the root-relative glob: `*.log` given for a root now matches only at the root. Use `**/*.log` for every depth. 0.20.0 wrote the un-anchored rest of the glob into the `.gitignore` of the deepest literal folder.
- **With `root`, a glob starting with `/` is a filesystem path.** 0.20.0 read `{ "glob": "/docs", "root": "<root>" }` as the root's `docs` folder; 0.21.0 reads `/docs` as the folder on disk and answers `400 The glob resolves outside the root` unless it lies under the root. Send `docs` (root-relative) or `<root>/docs` (absolute) instead.
- **Brackets are a character class.** `Report [draft].docx` matches `Report d.docx`; escape them (`Report \[draft\].docx`) to exclude the file itself.
- **`untracked` counts every matching file git had in its index**, including one a failed batch staged but never committed (it is unstaged too), so it and the 100-file `confirm` threshold can exceed the files in the last commit.
- **The response changed:** `{ ok, file, action, untracked }` replaces `{ ok, gitignorePath, action }` (an approved wire departure). New answers: `400` for a newline, a leading `!` or `#`, braces, a whole-root pattern, or a glob outside an explicit `root`; `409 confirm_required` when more than 100 files would be untracked without `confirm: true` (nothing written); `503 not_available` with `Retry-After: 30` when the root's git lock stays busy for 30 s.
- **`GET /vcs/check-exclusion`** adds `line`, answers `excluded: false` for a path a negated rule re-includes, and answers `500` when git fails (0.20.0 answered `excluded: false`). A tracked file under a human `.gitignore` rule answers `excluded: false`: git never reports tracked paths as ignored.
- **Migrating patterns 0.20.0 wrote.** They sit in `.gitignore` files and cannot be told apart from human lines, so they are not moved. For each one you want VCS-only:
  1. Find it: `GET /vcs/check-exclusion?path=<a file it covers>` names the `.gitignore` (`source`), the pattern (`rule`) and its `line`.
  2. Remove it with the glob you used in 0.20.0 (if you sent a leading `/` together with `root`, drop the `/` or send the absolute `<root>/...` form): `POST /vcs/exclude` `{ "glob": "<glob>", "remove": true }` (it falls back to 0.20.0's `.gitignore` line, and `file` names the `.gitignore` it edited).
  3. Add it again: `POST /vcs/exclude` `{ "glob": "<glob>" }` (same glob form as step 2). Mind the anchoring: write `**/` where the old line matched at any depth. Removing the `.gitignore` line brings the files back into the watcher's index scope, so they are embedded again (a reindex cost for large folders).

### Processing at scale

- **Processing ceilings, with deletion on the first start.** `processing.maxFileBytes` (default `64m`, checked with `stat` before extraction), `processing.maxChunksPerFile` (default 5000) and `processing.maxTextBytes` (default `8m` of extracted text) cap what one document may cost. A document over a ceiling has its points deleted and a `too_large` issue recorded; it leaves search. The size check runs before the unchanged-content check, so on the first start every file already indexed over a ceiling is deleted. Before upgrading, list those files with the read-only corpus survey (from a clone of the repository):

  ```bash
  node scripts/corpus-survey.mjs --url http://localhost:6333 --collection <collectionName>
  ```

  The survey reads the index, so it lists only files that have points. A watched file over `processing.maxFileBytes` that has none (a scanned PDF with no text, say) loses nothing from search, but it gets a `too_large` issue at the first start too. To list those as well, find the files on disk over the ceiling (64 MiB by default; use your value) under each watch root:

  ```bash
  find <root> -path '*/.git' -prune -o -type f -size +67108864c -print
  ```

  ```powershell
  Get-ChildItem -LiteralPath '<root>' -Recurse -File -Force | Where-Object { $_.Length -gt 67108864 -and $_.FullName -notmatch '[\\/]\.git[\\/]' } | ForEach-Object FullName
  ```

  Those the watcher matches (its globs, not `watch.ignored` or gitignored) and the survey does not list are the files with no points.

  Add `--api-key <key>` for a secured Qdrant, `--max-chunks`, `--max-file-bytes` or `--max-text-bytes` to try other ceilings, and `--json <file>` for the full table. To keep such a file indexed, raise the ceiling in config before upgrading; after a raise, `POST /reindex` with scope `issues` brings back the documents that were too large. Source documents get the chunk and text ceilings too (their 10 MiB response cap is unchanged) and answer `failed` with code `too_large`. On the host the defaults were derived from (780,178 points, 332,481 files) only the single largest file, at 6,185 chunks, was over.

- **`GET /issues` and `GET /config/schema`** can show the new issue type `too_large` (an approved wire departure).
- **An indexed file that fails extraction leaves search.** When a file that has points can no longer be parsed, extracted or run through its rules, its points are deleted (under its document lock, like any delete) and the `extraction_error` issue is recorded; 0.20.0 kept its old points, frozen at the last content that read. A system error reading the file (locked by another program, gone mid-save, a dropped share) or a Node error (an enrichment store read that fails, an extractor that does not load) is not such a failure: the points stay, as in 0.20.0. The enrichment is kept, and the file is indexed again once it reads (its next change, or `POST /reindex` with scope `issues`).
- **Large documents no longer hold every vector in memory.** Embeddings are written one window of 100 chunks at a time. Chunk 0 is written first as a claim that counts the highest chunk number either version reaches and has no content hash, so a document whose write fails part-way is never treated as unchanged and a delete still reaches every chunk written. Chunk 0 gets its content hash and final count only after the stale chunks are deleted.
- **One document is processed at a time.** Every process, delete, move, ceiling deletion and metadata change of a document (including each entry POST /rebuild-metadata writes) holds an in-process lock on it, so two runs of the same file can no longer interleave and leave chunks behind. `POST /metadata`, `POST /rules/reapply` and `POST /documents/delete` wait at most 10 s for each document's lock, then answer `503 not_available` with `Retry-After: 10`. A single-document request has then changed nothing; a multi-document request keeps the documents it already changed. Retry after the delay. The CLI's timeout already allows for the wait.
- **A `file_path` keyword index is created on every collection** in the background at startup (startup does not wait; on a large collection the build can take minutes). `GET /status` reports it under `health.collection.systemIndexes` (`building`, `ready`, `conflict` or `failed`). While it builds, or when `file_path` already has an index of another type (`conflict`: the existing index is left alone), metadata writes address each chunk by ID as before; once it is ready they are one write by filter.
- **Custom factories (embedding the service as a library).** A `createVectorStoreClient` factory must return a store with four new members: `keywordIndexReady(field)`, `setPayloadWhere(filter, payload)`, `deletePayloadWhere(filter, keys)` and `existingIds(ids)` (see `VectorStore` in the API docs; `VectorStoreClient` implements them). A custom processor's `sourceOperations()` must also return `withLock(ref, operation, work, options?)`; `withoutSourceSupport` already does (without locking). `POST /rebuild-metadata` locks each file through it too. Without them the factory no longer type-checks.

### Front matter

- **Markdown front matter is parsed with `yaml`** (js-yaml no longer parses it; it still writes the front matter of rendered documents). Plain values, quoted strings, dates, lists and maps parse as before, and so do the `!!str`, `!!int`, `!!bool`, `!!null`, `!!map` and `!!seq` tags.
- **`!!float` on a value not written as a float is an extraction error.** `rank: !!float 1` and `rank: !!float "1"` were indexed by 0.20.0 (as `1`); 0.21.0 records an `extraction_error` issue for the file and leaves it out of search. A file 0.20.0 already indexed has its points deleted when 0.21.0 first processes it (at the first start, since the start walk enqueues every file), so stale content never stays searchable; fixed, it is indexed again at its next change. `!!float 1.5` and `!!float 1.0` still parse. Before upgrading, find such lines and write the value as a float (`1.0`) or drop the tag:

  ```bash
  grep -rnE $'!!float[[:space:]]+["\']?[+-]?[0-9]+["\']?([],}[:space:]]|$)' --include='*.md' <root>
  ```

  This is a first pass (it can also match lines outside front matter); after the upgrade, `GET /issues` lists any file it missed as an `extraction_error`.

- **A `%YAML 1.1` directive** at the top of the front matter is also refused (an `extraction_error`); remove the directive line.

### Embedding health

- **`GET /status` gains `health.embedding`**: `state` (`ok` or `failing`), `lastSuccessAt`, `lastError` (`{ at, code }`), `failingSince` and `backoffUntil`. Codes only: no provider error text or path. Embeddings turn `failing` after at least 3 failures with 60 s without a success, and `ok` again at the first success.
- **`status` is `degraded`** (HTTP 200) while embeddings are failing or a VCS circuit breaker is tripped. Anything that alarms on a non-`healthy` status will now see these.
- **`embedding.alertUrl`** (optional) receives a POST when embeddings turn failing (`embedding_failed`) and when they recover (`embedding_recovered`). The body is `{ event, at, service, version, host, collection, failingSince, lastError }`, unsigned: use a private endpoint. Delivery makes up to 3 attempts, each with a 10 s timeout.
- **A provider back-off is now capped at 5 minutes** and then expires. A long `Retry-After` (e.g. a daily quota) used to keep every embedding call failing until it passed; now the first call after 5 minutes probes the provider. The `Retry-After` on a search `503` reflects that probe time.
- **The reindex callback** also times out each attempt after 10 s (it shares the alert's delivery code).

### Change source and reconciliation

- **`@parcel/watcher` is the default change source (new, `watch.changeSource`: `parcel` | `chokidar`).** One native subscription per watch root replaces chokidar's per-directory watches. The initial scan is a walk of each root after it is subscribed; every matched file is enqueued and the processor skips unchanged content. A renamed or moved directory becomes one move per file (re-keyed, not re-embedded) when `moveDetection` is on; a directory whose attributes change (`chmod -R`) no longer reconciles its tree. `usePolling: true` still uses chokidar. **Switching:** set `watch.changeSource: chokidar` to go back to chokidar (a reload rebuilds the watcher, one full initial scan). There is no automatic fallback: if the `@parcel/watcher` binary for the platform is missing (an install with `--omit=optional`) or fails to load, the service refuses to start and logs an error naming that switch; a reload to `parcel` that cannot load is refused and the running watcher stays. On Linux, raise `fs.inotify.max_queued_events` before installing and keep `fs.inotify.max_user_watches` raised for large trees (see [Linux inotify limits](./deployment.md#linux-inotify-limits)): parcel needs one inotify watch per directory rather than per file, but it cannot detect a queue overflow. Each periodic reconcile also renews the root's subscription on Linux (Windows subscriptions are never renewed), and `reconcileIntervalMs: 0` turns that off (warned at start).
- **Linux: some changes wait for the next renewal.** Changes inside folders nested in a newly created or moved-in tree, and inside a directory renamed or moved within a root, can go unseen until the subscription is renewed: they are indexed at the next periodic reconcile, up to `watch.reconcileIntervalMs` (15 minutes by default) late. Files moved in with the tree itself are indexed at once. Shorten the interval if that latency matters; renewing a large root pauses event handling for every root for the length of its walk.
- **Windows: files with paths of 260 characters or more are indexed only by the periodic reconcile.** `@parcel/watcher` 2.6.0 reports no change event for creating or changing such a file, whatever the `LongPathsEnabled` setting, so it is indexed at the next periodic reconcile, up to `watch.reconcileIntervalMs` late (deletes still arrive live). `LongPathsEnabled = 1` stays recommended for other tools on the host ([Windows long paths](./deployment.md#windows-long-paths)). Under chokidar nothing changes.
- **Windows: the service must be restarted when it exits (parcel only).** `@parcel/watcher` 2.6.0 crashes the process natively on Windows (`0xC0000005`) whenever a subscription is unsubscribed, so on Windows the service never unsubscribes. Instead, a reload that rebuilds the watcher (including a switch of `watch.changeSource`), a subscription error, or a watch root that disappears makes the service log the cause, stop gracefully and exit with code **75**, for the service manager to start it again with the current config; the start walks every root, so files added or changed meanwhile are indexed (files deleted meanwhile are removed by the index check at start, below), and the reload's `configWatch.reindex` runs after the restart. NSSM restarts on exit by default (`AppExit Default Restart`): check that the service has not been set otherwise (see [Deployment](./deployment.md#windows-nssm)). Run under any other manager, configure it to restart on a non-zero exit. Under chokidar nothing changes. Linux and macOS are unchanged.
- **Index check at start (new, `watch.indexCheckOnStart`, default `true`).** After the start walk, the service deletes the indexed documents of files gone from disk under each available watch root (deleted, or moved away, while it was down), each under its document lock as a delete event would. 0.20.0 left them until a `prune` reindex. It skips a root where more than 10% of the indexed documents (once more than 20 are missing) or more than 1,000 are missing (logged; run `prune` deliberately), leaves files that still exist but are now filtered out to `prune`, and never touches source documents or points outside the watch roots. On the first 0.21.0 start it may therefore remove documents of files deleted under an earlier version. Set `watch.indexCheckOnStart: false` to keep 0.20.0's behaviour. See [Configuration](./configuration.md).
- **Periodic reconciliation (new, `watch.reconcileIntervalMs`, default 900000 = 15 minutes; `0` turns it off).** Each watch root is walked on that interval and compared with the watcher's inventory: a file whose event was missed is added through the normal stability wait, and a file the inventory holds that is confirmed gone (`ENOENT`) is deleted. Roots are staggered across the interval. A walk that fails, a root that is unreachable, or a root walk that finds nothing while the inventory holds files emits nothing (so an unmounted share never deletes its points). Measured cost: a 110,000-file root walks in about 0.6 to 2.3 s. A reload that changes only this key takes effect without rebuilding the watcher (the stagger restarts with the new interval; a reload that leaves it unchanged keeps the running schedule). Files below a symlinked directory are not walked, so an event missed there is not recovered. See [Configuration](./configuration.md#watch-filesystem-watching).
- **A directory created after the initial scan is reconciled at once**, so files written into it before its watch was set up are not missed. A file both the reconcile and the change source report is enqueued once.
- **`POST /walk` lists the inventory**: matched files only (never directories, glob-rejected, `watch.ignored` or gitignored files), sorted by path. 0.20.0 listed chokidar's entries, which could include directories and files the watcher filters out.
- **`GET /status` gains `health.changeSource`**: `source` (`parcel` or `chokidar`), `resubscribes`, `unavailableRoots`, `reconcileEvents` (synthetic events reconciliation emitted: a rising value means events are being missed), `reconcileErrors`, `lastReconcileAt`, `lastReconcileDurationMs`, `pendingStability`, `lastRenewDurationMs` (the last Linux subscription renewal; `null` on Windows and under chokidar), `renewFailures` (renewals that forced a rebuild of every subscription, plus any rejection inside one), and `lastRestartCause` and `lastRestartAt` (why and when the previous process exited for a restart on Windows: `watch-config-changed`, `subscription-error` or `root-gone`; `null` otherwise). Counts, codes and timestamps only, never paths.
- **`GET /status` gains `health.indexCheck`**: `state` (`pending`, `running`, `done`, `failed` or `off`), `at`, `durationMs`, `checked`, `removed`, `skippedRoots` and `capped`. Counts and timestamps only, never paths.
- **Events under each watch root's own `.git` are always dropped**, even when `watch.ignored` lacks `**/.git/**`, so the watcher's own VCS commits never become change events.
- **A reload that changes `watch.usePolling`, `watch.pollIntervalMs` or `watch.stabilityThresholdMs` now rebuilds the watcher** (0.20.0 needed a restart for them). Values are compared after defaults, so writing a default out is no change.
- **The service sets `UV_THREADPOOL_SIZE` to 16** unless the environment already sets it, and every walk (and the stability checks of reconciled files) shares one limit of 8 filesystem calls in flight, so walks never starve file reads.
- **`GET /config/schema`** shows `watch.reconcileIntervalMs`, `watch.changeSource` and `watch.indexCheckOnStart` (approved wire departures), and `GET /config` and the `POST /config/apply` response include their values when set.
- **Watch roots keep their case off Windows.** Earlier releases lower-cased every watch root on every platform. On Linux a root with an upper-case letter was therefore watched at a path that does not exist and silently reported nothing; from 0.21.0 it is watched, so its files are indexed for the first time. On macOS (and any other non-Windows platform) file paths, the `file_path` payload, `/walk` and VCS paths now keep the root's configured case. Point IDs never depended on case, so the same points are updated, but the index can hold both casings until a full reindex; case-sensitive rule patterns, templates and `file_path` filters see the configured case. Windows is unchanged: roots are still lower-cased.

### Facets

- **`POST /search/facets/counts` (new, `countFacets`)** counts the values of indexed payload fields over the documents matching a filter, each document once (approximate counts, D194), or gives `{ min, max }` for numeric and date fields; `rules` keeps only documents of the named rules. Every counted field needs a payload index (else `400` naming it): add a `keyword` index under `vectorStore.payloadIndexes` for each field your UI offers as a facet, and restart. See [the route](./api-reference.md#post-searchfacetscounts).
- **Two more system indexes are built at the first 0.21.0 start**, in the background like `file_path`: `chunk_index` (`integer`) and `matched_rules` (`keyword`). Until `chunk_index` is `ready` the counts route answers `503 not_available`, and until `matched_rules` is `ready` a counts request with `rules` does too; `GET /status` shows their progress under `health.collection.systemIndexes`. A field already indexed with another type is left alone (`conflict`) and the route stays `503` until you drop that index and restart.
- **`GET /search/facets` takes `rules`** (comma-separated, configured or registered rule names): only the fields those rules declare, with only their documents' values; an unknown name answers `400`. Without it the answer is unchanged.
- **No plugin tool or CLI command** is added for counts; the SDK has `countFacets()`.

### Operation names

- **Every operation has one verb-first name** (D77): the catalog entry, the SDK method, the OpenAPI `operationId` and (as `watcher_` plus the name in snake_case) the plugin tool. Routes and paths are unchanged, so the HTTP API itself does not change. Renamed:

  | 0.20.0 entry / `operationId` | 0.21.0                    |
  | ---------------------------- | ------------------------- |
  | `configSchema`               | `getConfigSchema`         |
  | `configMatch`                | `matchConfig`             |
  | `configValidate`             | `validateConfig`          |
  | `issues`                     | `listIssues`              |
  | `metadata`                   | `setMetadata`             |
  | `searchFacets`               | `listFacets`              |
  | `documents`                  | `notifyDocuments`         |
  | `documentsDelete`            | `deleteDocuments`         |
  | `pointsDelete`               | `deletePoints`            |
  | `rulesRegister`              | `registerRules`           |
  | `rulesUnregister`            | `unregisterRules`         |
  | `rulesUnregisterBySource`    | `unregisterRulesBySource` |
  | `rulesReapply`               | `reapplyRules`            |
  | `vcsStatus`                  | `getVcsStatus`            |
  | `vcsHistory`                 | `listVcsHistory`          |
  | `vcsShow`                    | `showVcsFile`             |
  | `vcsDiff`                    | `diffVcs`                 |
  | `vcsCheckExclusion`          | `checkVcsExclusion`       |
  | `vcsExclude`                 | `excludeVcsPath`          |
  | `vcsRevert`                  | `revertVcs`               |

  `status`, `config`, `configApply`, `search`, `scan`, `reindex`, `walk`, `render` and `rebuildMetadata` keep their names. Code generated from `openapi.json` sees the new `operationId`s.

### SDK 0.3.0

`@karmaniverous/jeeves-watcher-sdk` 0.3.0 is built on jeeves's catalog client over `WATCHER_CATALOG` (D36). Its own fetch layer is gone; it depends on `@karmaniverous/jeeves` 0.9.0 and `@karmaniverous/jeeves-watcher-core` ^0.5.0.

- **New runtime dependency:** the SDK imports `@karmaniverous/jeeves/catalog`, so jeeves's own runtime dependencies (`commander`, `@commander-js/extra-typings`, `cross-spawn`, `jsonpath-plus`, `package-directory`, `semver`, `zod`) install in every consumer, whichever sub-path is imported.
- **Methods are named by the catalog entry**, and the client now has one per entry: `issues()` becomes `listIssues()`, `metadata()` becomes `setMetadata()`, and the new methods include `getConfigSchema`, `matchConfig`, `validateConfig`, `listFacets`, `walk`, `config`, `configApply`, the rule methods, `deletePoints` and the VCS methods. `documents.notify` and `documents.delete` stay as they were. The [SDK guide](../../sdk/guides/sdk-guide.md#methods) lists every method.

  ```ts
  // 0.2.0
  await watcher.issues();
  await watcher.metadata({ source, metadata: { priority: 2 } });
  // 0.3.0
  await watcher.listIssues();
  await watcher.setMetadata({ source, metadata: { priority: 2 } });
  ```

- **Inputs are validated by the entry's schemas, in their wire form.** Query fields are strings: `listVcsHistory({ glob, limit: '20' })`. A condition-free delete filter is still refused before sending.
- **Responses are parsed by the entry's schema**, which drops fields a newer service adds. A new enum value from a newer service fails validation (`invalid_response`) until the SDK is upgraded: upgrade the SDK with the service.
- **Error codes:** a non-2xx body's `code` wins; a body without one maps to `http_<status>` (0.2.0 fell back to the body's `error` text first). Client-side failures keep their codes (`invalid_request`, `invalid_response`, `timeout`, `network_error`, `invalid_options`).
- **`WatcherError.retryAfterMs`** carries the server's `Retry-After` in milliseconds, clamped to one hour. The SDK still never retries.
- **`documents.notify` no longer checks references client-side.** A malformed reference is sent, and the server returns it in the `202` body's `rejected` list.
- **Test mocks:** requests now carry lowercase `authorization` and `content-type` headers and no `accept` header, and a mocked response must be a real `Response`.
- **Timeouts:** the default stays 10 s. Raise `timeoutMs` for `excludeVcsPath`, `revertVcs` and `documents.notify(..., { wait: true })`; a timeout does not cancel them on the server (D119).

### CLI

- **Every API command goes through the SDK and now times out after 60 s** (0.20.0 set no timeout). A timeout does not cancel the operation on the server (D119); long operations on large corpora can exceed it (see the [CLI Reference](./cli-reference.md#output-and-errors)). Errors print as `<code>: <message>` (a `401` adds a line on supplying the key); exit code 1 as before.
- **New commands:** `walk <globs...>`, and `vcs status`, `vcs history`, `vcs show`, `vcs diff`, `vcs revert`, `vcs check` and `vcs exclude` (#213); `reindex --dry-run` (#257). A timed-out `vcs exclude` or `vcs revert` says it may still complete and how to check. See the [CLI Reference](./cli-reference.md).

### OpenClaw plugin 0.18.0

- **Every tool is built from the catalog** (D38), so the ten hand-written-tool names change:

  | 0.17.0 tool           | 0.18.0 tool                   |
  | --------------------- | ----------------------------- |
  | `watcher_enrich`      | `watcher_set_metadata`        |
  | `watcher_validate`    | `watcher_validate_config`     |
  | `watcher_issues`      | `watcher_list_issues`         |
  | `watcher_vcs_status`  | `watcher_get_vcs_status`      |
  | `watcher_vcs_history` | `watcher_list_vcs_history`    |
  | `watcher_vcs_show`    | `watcher_show_vcs_file`       |
  | `watcher_vcs_diff`    | `watcher_diff_vcs`            |
  | `watcher_vcs_revert`  | `watcher_revert_vcs`          |
  | `watcher_vcs_exclude` | `watcher_exclude_vcs_path`    |
  | `watcher_vcs_check`   | `watcher_check_vcs_exclusion` |

  Update any tool allow-list, prompt or skill that names the old tools. The bundled skill and prompt rules already use the new names.

- **Parameters come from the catalog schemas.** `watcher_reindex` without `scope` still sends `rules`, `watcher_list_vcs_history.limit` is a string, and `watcher_set_metadata` also accepts `source`.
- **Every tool waits 120 s** (core's default), and errors read `HTTP <status>: <body>`. A `401` no longer carries key guidance: see the skill's troubleshooting section.

### Dependencies

- **unpdf 2** extracts PDF text. Indexed text is unchanged. unpdf 2 declares Node.js 24 or later, which the new Node floor covers.
- **`@parcel/watcher` 2.6.0** (pinned exactly) is a new dependency with prebuilt native binaries as optional dependencies; install without `--omit=optional`. Its build-from-source install script stays off. npm 11.19 and later warn about it on install (`install-scripts ... @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js) not yet covered by allowScripts`): that is expected, and the prebuilt binary is used. Do not allow the script.
- chokidar stays on major 5.
- **`@karmaniverous/jeeves` 0.9.0** makes `fastify` (types) and `zod-openapi` (OpenAPI generation) optional peers and drops `fastify-type-provider-zod`. The service depends on `fastify` 5 itself, so a service install is unchanged; an SDK-only install no longer pulls in either.
- **Front matter** is parsed by `yaml` instead of js-yaml ([Front matter](#front-matter)).

### Library API

- **`createLogger` is now async** and resolves once the log file is open. Add `await`: `const logger = await createLogger(config.logging);`.
- **`WATCHER_ENDPOINTS` is removed from watcher-core** (D41), with `getEndpoint`, `EndpointName`, `EndpointDescriptor`, `HttpMethod` and `Endpoint`. Read routes from `WATCHER_CATALOG` instead: `WATCHER_CATALOG.byName('showVcsFile')` gives the entry's `method`, `path` and `description`, and `WATCHER_CATALOG.entries` lists them all.
- **The client fetch helpers are removed from watcher-core:** `bearerHeaders`, `tryParseJson`, `httpError`, `formatHttpError`, `HttpErrorInfo` and `unauthorizedMessage`. Use the SDK (`createWatcherClient`, `WatcherError`) or jeeves's `createCatalogClient`. `API_KEY_ENV_VAR` stays.

### Rollback to 0.20.0

Stop the service and reinstall 0.20.0 (`npm install -g @karmaniverous/jeeves-watcher@0.20.0`). Before starting it, work through these steps in order for every watch root with VCS enabled (steps 1 to 3) and for the host (steps 4 to 6). `<root>` is the watch root's folder, which holds the `.git` repository.

1. **Squash first.** 0.20.0's squash rewrites the working tree, and replaying a 0.21.0 untrack commit (by `/vcs/exclude` or the size cap) inside its retained window deletes that file from disk. 0.20.0 always schedules squash, so give it a schedule that never fires: set `vcs.retention.squashCron` to `"0 0 31 2 *"` (February 31st) at the top level **and** in every `watch.paths[].vcs.retention` that overrides it, keeping your `maxAgeDays` and `maxVersions`:

   ```json
   {
     "vcs": {
       "retention": {
         "maxAgeDays": 30,
         "maxVersions": 100,
         "squashCron": "0 0 31 2 *"
       }
     }
   }
   ```

   Keep it until every untrack commit is older than the retention boundary (`git -C <root> log --format='%h %ad %s' --date=short | grep -i untrack` lists them), or instead copy the untracked files aside before 0.20.0 starts.

2. **Over-cap files.** 0.20.0 has no size cap, so its next change to a file 0.21.0 untracked for size stages and commits it, and a file over 100 MiB then makes GitHub reject every later push from that root. List the files on disk over `vcs.maxFileBytes` (default 100,000,000 bytes) that git does not track (0.21.0's warnings also name them):

   ```bash
   cd <root>
   comm -23 <(find . -path ./.git -prune -o -type f -size +100000000c -print | sed 's|^\./||' | sort) \
     <(git -c core.quotePath=false ls-files | sort)
   ```

   ```powershell
   $root = $null; $root = (Get-Item -LiteralPath '<root>' -ErrorAction Stop).FullName.TrimEnd('\')
   [Console]::OutputEncoding = [Text.Encoding]::UTF8   # read git's non-ASCII paths correctly
   $tracked = @{}; git -C $root -c core.quotePath=false ls-files | ForEach-Object { $tracked[$_] = $true }
   Get-ChildItem -LiteralPath $root -Recurse -File -Force | Where-Object { $_.Length -gt 100000000 -and $_.FullName -notmatch '[\\/]\.git[\\/]' } |
     ForEach-Object { $_.FullName.Substring($root.Length + 1) -replace '\\', '/' } | Where-Object { -not $tracked[$_] }
   ```

   (Works in Windows PowerShell 5.1 and PowerShell 7.)

   For each file listed (files a `.gitignore` already ignores are safe), either set `vcs.enabled: false` for 0.20.0, or move the file out of the watched root (or keep it under the cap) for as long as 0.20.0 runs.

3. **Exclude patterns.** 0.21.0 writes VCS-only exclusions to `<root>/.git/info/exclude`. 0.20.0 has no `check-ignore` filter, so an active pattern there makes its batches fail again (and trips the breaker), and its `POST /vcs/exclude` `remove` looks only in `.gitignore` files. Move each pattern into the root `.gitignore` or delete it. The lines are root-anchored, so they mean the same in the root `.gitignore`, but there they also drop their files from **search** under 0.20.0: delete rather than move any pattern whose files must stay searchable. 0.20.0 only stops indexing those files; their existing points stay in search until a `prune` reindex (`POST /reindex` with scope `prune`, after a `dryRun`), so run one once 0.20.0 is up if you moved any pattern.

   ```bash
   cd <root>
   grep -v -e '^#' -e '^$' .git/info/exclude              # review the patterns
   [ -s .gitignore ] && [ -n "$(tail -c1 .gitignore)" ] && echo >> .gitignore  # end .gitignore with a newline
   grep -v -e '^#' -e '^$' .git/info/exclude >> .gitignore # move them (skip to delete)
   : > .git/info/exclude                                    # then empty the file
   ```

   ```powershell
   $root = $null; $root = (Get-Item -LiteralPath '<root>' -ErrorAction Stop).FullName.TrimEnd('\')
   $exclude = Join-Path $root '.git\info\exclude'; $ignore = Join-Path $root '.gitignore'
   $patterns = Get-Content -LiteralPath $exclude | Where-Object { $_ -and -not $_.StartsWith('#') }
   $patterns                                                                                  # review
   if ((Test-Path -LiteralPath $ignore) -and (Get-Item -LiteralPath $ignore).Length -gt 0 -and -not (Get-Content -LiteralPath $ignore -Raw).EndsWith("`n")) {
     Add-Content -LiteralPath $ignore ''                                                      # end .gitignore with a newline
   }
   $patterns | Add-Content -LiteralPath $ignore                                               # move (skip to delete)
   Clear-Content -LiteralPath $exclude
   ```

   Files 0.21.0 untracked stay untracked until they next change.

4. **Logs.** 0.20.0 writes the plain `logging.file` again; archive the rotated `<name>.<yyyy-MM-dd>.<n>.<ext>` files and point log tailing back at the plain file.

5. **Plugin and tool names.** Install plugin 0.17.0 with the service, the same way as in [Upgrade order](#upgrade-order) step 3: `openclaw plugins install npm:@karmaniverous/jeeves-watcher-openclaw@0.17.0 --pin --accept-capabilities --force` (without `--force` a non-interactive install is cancelled), or `jeeves install --workspace <workspace> --config-root <configRoot> watcher@0.17.0` with your deployment's flags (without `--workspace` it writes platform files into the current folder). It brings back the 0.17.0 tool names, so revert every allow-list, prompt, skill and script edit made for the [renames](#openclaw-plugin-0180).

6. **Nothing else needs action.**
   - **Config:** the new keys can stay in the config file: 0.20.0 strips unknown keys on load (and watches with chokidar). A `restart.json` that a Windows exit for a restart left in the state directory is ignored by 0.20.0 and can be deleted.
   - **System indexes** (`chunk_index`, `file_path`, `matched_rules`) are harmless to 0.20.0.
   - **Documents removed as `too_large`**, and files whose write failed, are processed again by 0.20.0's initial scan.
   - **Issues 0.21.0 recorded stay listed** in 0.20.0's `GET /issues`, `too_large` included, until their file is processed again. An entry for a file since moved out of the root (say, an over-cap file from step 2) is stale and can be ignored.
   - **The SDK** goes back to 0.2.0 with the service: SDK and service versions move together.
   - **Windows:** 0.20.0 never exits for a restart, so the NSSM restart setting needs no change.
