---
title: Upgrading
---

# Upgrading

What changes for an existing deployment, release by release. The [Changelog](../CHANGELOG.md) lists every commit; this page lists what you may need to act on.

## 0.21.0 (in progress)

### Node.js

- **Node.js 24.22.2 or later is required** (was 22.13). Every package (`@karmaniverous/jeeves-watcher`, `-core`, `-sdk`, `-openclaw`) declares `engines.node >=24.22.2`, so `npm install` on an older Node prints an `EBADENGINE` warning and fails with `engine-strict`. Upgrade Node before upgrading the watcher.
- Why 24.22.2: on a Jeeves host running Node.js 24.18.0, SQLite write-ahead logs stopped checkpointing and grew without bound; after the host moved to 24.22.2, checkpoints and log sizes were normal again. The watcher keeps its enrichment store in SQLite through the built-in `node:sqlite` module, so it takes the same floor. It is the floor for every Jeeves component, and it also meets unpdf 2's own `>=24` (spec D188).

### Logging

- **`logging.file` now rotates by default** (10 MiB, daily, 14 rotated files kept plus the active one). Every file, the active one included, is named `<name>.<yyyy-MM-dd>.<n>.<ext>` (`watcher.2026-11-04.1.log` for `watcher.log`), so a plain `watcher.log` is no longer written. Point anything that tails the log at the newest file by modification time.
- Rotation deletes older files matching that name pattern, so keep the log in a folder of its own. A single `watcher.log` left by 0.20.0 is not managed by rotation: archive it, then delete it.
- If you rotate the file externally (logrotate), either remove that rotation or set `logging.rotation: false` to keep one plain file.
- The rotating stream runs in the main thread (no worker), and a refusal to start is also written to stderr, so a service manager's stderr log shows why the service stopped.
- See [Configuration](./configuration.md#-logging-configuration).

### Version control

- **`vcs.maxFileBytes` (default 100,000,000 bytes) caps what git versions.** A new file over the cap is not staged. A tracked file already over it is untracked, in a commit of its own just before the batch's commit, the next time it changes: its history ends at its last committed version and the file stays on disk. Set `0` to keep the old behaviour. See [File Size Cap](./version-control.md#file-size-cap).
- **Folder rules over tracked files no longer trip the breaker.** Tracked files are staged with `git add -u` and new files with plain `git add`, so a folder rule in a `.gitignore` or `.git/info/exclude` over files git still tracks no longer fails every batch (0.20.0 tripped the circuit breaker). Those files keep being versioned until they are untracked.
- **Paths are passed to git literally.** 0.20.0 could stage `a1.md` when given `a[1].md`; 0.21.0 cannot. Files wrongly staged that way stay tracked until excluded.
- **Squash rewrites history with plumbing only.** It no longer needs a clean working tree or a free `index.lock`, never checks out, resets or cherry-picks, and keeps files untracked by the size cap on disk with their newest content. Retained commits keep their messages, identities and dates byte for byte. It still refuses while a merge, rebase, cherry-pick or revert is in progress.
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

  Add `--api-key <key>` for a secured Qdrant, `--max-chunks`, `--max-file-bytes` or `--max-text-bytes` to try other ceilings, and `--json <file>` for the full table. To keep such a file indexed, raise the ceiling in config before upgrading; after a raise, `POST /reindex` with scope `issues` brings back the documents that were too large. Source documents get the chunk and text ceilings too (their 10 MiB response cap is unchanged) and answer `failed` with code `too_large`. On the host the defaults were derived from (780,178 points, 332,481 files) only the single largest file, at 6,185 chunks, was over.

- **`GET /issues` and `GET /config/schema`** can show the new issue type `too_large` (an approved wire departure).
- **Large documents no longer hold every vector in memory.** Embeddings are written one window of 100 chunks at a time. Chunk 0 is written first as a claim that counts the highest chunk number either version reaches and has no content hash, so a document whose write fails part-way is never treated as unchanged and a delete still reaches every chunk written. Chunk 0 gets its content hash and final count only after the stale chunks are deleted.
- **One document is processed at a time.** Every process, delete, move, ceiling deletion and metadata change of a document (including each entry POST /rebuild-metadata writes) holds an in-process lock on it, so two runs of the same file can no longer interleave and leave chunks behind. `POST /metadata`, `POST /rules/reapply` and `POST /documents/delete` wait at most 10 s for each document's lock, then answer `503 not_available` with `Retry-After: 10`. A single-document request has then changed nothing; a multi-document request keeps the documents it already changed. Retry after the delay. The CLI's timeout already allows for the wait.
- **A `file_path` keyword index is created on every collection** in the background at startup (startup does not wait; on a large collection the build can take minutes). `GET /status` reports it under `health.collection.systemIndexes` (`building`, `ready`, `conflict` or `failed`). While it builds, or when `file_path` already has an index of another type (`conflict`: the existing index is left alone), metadata writes address each chunk by ID as before; once it is ready they are one write by filter.
- **Custom factories (embedding the service as a library).** A `createVectorStoreClient` factory must return a store with four new members: `keywordIndexReady(field)`, `setPayloadWhere(filter, payload)`, `deletePayloadWhere(filter, keys)` and `existingIds(ids)` (see `VectorStore` in the API docs; `VectorStoreClient` implements them). A custom processor's `sourceOperations()` must also return `withLock(ref, operation, work, options?)`; `withoutSourceSupport` already does (without locking). `POST /rebuild-metadata` locks each file through it too. Without them the factory no longer type-checks.

### Embedding health

- **`GET /status` gains `health.embedding`**: `state` (`ok` or `failing`), `lastSuccessAt`, `lastError` (`{ at, code }`), `failingSince` and `backoffUntil`. Codes only: no provider error text or path. Embeddings turn `failing` after at least 3 failures with 60 s without a success, and `ok` again at the first success.
- **`status` is `degraded`** (HTTP 200) while embeddings are failing or a VCS circuit breaker is tripped. Anything that alarms on a non-`healthy` status will now see these.
- **`embedding.alertUrl`** (optional) receives a POST when embeddings turn failing (`embedding_failed`) and when they recover (`embedding_recovered`). The body is `{ event, at, service, version, host, collection, failingSince, lastError }`, unsigned: use a private endpoint. Delivery makes up to 3 attempts, each with a 10 s timeout.
- **A provider back-off is now capped at 5 minutes** and then expires. A long `Retry-After` (e.g. a daily quota) used to keep every embedding call failing until it passed; now the first call after 5 minutes probes the provider. The `Retry-After` on a search `503` reflects that probe time.
- **The reindex callback** also times out each attempt after 10 s (it shares the alert's delivery code).

### Change source and reconciliation

- **`@parcel/watcher` is the default change source (new, `watch.changeSource`: `parcel` | `chokidar`).** One native subscription per watch root replaces chokidar's per-directory watches. The initial scan is a walk of each root after it is subscribed; every matched file is enqueued and the processor skips unchanged content. A renamed or moved directory becomes one move per file (re-keyed, not re-embedded) when `moveDetection` is on; a directory whose attributes change (`chmod -R`) no longer reconciles its tree. `usePolling: true` still uses chokidar. **Switching:** set `watch.changeSource: chokidar` to go back to chokidar (a reload rebuilds the watcher, one full initial scan). There is no automatic fallback: if the `@parcel/watcher` binary for the platform is missing (an install with `--omit=optional`) or fails to load, the service refuses to start and logs an error naming that switch; a reload to `parcel` that cannot load is refused and the running watcher stays. On Linux, raise `fs.inotify.max_user_watches` and `fs.inotify.max_queued_events` for large trees (see [Deployment](./deployment.md)); each periodic reconcile also renews the root's subscription there, and `reconcileIntervalMs: 0` turns that off (warned at start). Windows paths over 260 characters need `LongPathsEnabled`; without it their events are lost and only reconciliation finds those files.
- **Periodic reconciliation (new, `watch.reconcileIntervalMs`, default 900000 = 15 minutes; `0` turns it off).** Each watch root is walked on that interval and compared with the watcher's inventory: a file whose event was missed is added through the normal stability wait, and a file the inventory holds that is confirmed gone (`ENOENT`) is deleted. Roots are staggered across the interval. A walk that fails, a root that is unreachable, or a root walk that finds nothing while the inventory holds files emits nothing (so an unmounted share never deletes its points). Measured cost: a 110,000-file root walks in about 0.6 to 2.3 s. A reload that changes only this key takes effect without rebuilding the watcher (the stagger restarts with the new interval; a reload that leaves it unchanged keeps the running schedule). Files below a symlinked directory are not walked, so an event missed there is not recovered. See [Configuration](./configuration.md#watch---filesystem-watching).
- **A directory created after the initial scan is reconciled at once**, so files written into it before its watch was set up are not missed. A file both the reconcile and the change source report is enqueued once.
- **`POST /walk` lists the inventory**: matched files only (never directories, glob-rejected, `watch.ignored` or gitignored files), sorted by path. 0.20.0 listed chokidar's entries, which could include directories and files the watcher filters out.
- **`GET /status` gains `health.changeSource`**: `source` (`parcel` or `chokidar`), `resubscribes`, `unavailableRoots`, `reconcileEvents` (synthetic events reconciliation emitted: a rising value means events are being missed), `reconcileErrors`, `lastReconcileAt`, `lastReconcileDurationMs`, `pendingStability`, `lastRenewDurationMs` (the last Linux subscription renewal; `null` on Windows and under chokidar) and `renewFailures` (renewals that forced a rebuild of every subscription, plus any rejection inside one). Counts and timestamps only, never paths.
- **Events under each watch root's own `.git` are always dropped**, even when `watch.ignored` lacks `**/.git/**`, so the watcher's own VCS commits never become change events.
- **A reload that changes `watch.usePolling`, `watch.pollIntervalMs` or `watch.stabilityThresholdMs` now rebuilds the watcher** (0.20.0 needed a restart for them). Values are compared after defaults, so writing a default out is no change.
- **The service sets `UV_THREADPOOL_SIZE` to 16** unless the environment already sets it, and every walk (and the stability checks of reconciled files) shares one limit of 8 filesystem calls in flight, so walks never starve file reads.
- **`GET /config/schema`** shows `watch.reconcileIntervalMs` and `watch.changeSource` (approved wire departures), and `GET /config` and the `POST /config/apply` response include their values when set.
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
- **`@parcel/watcher` 2.6.0** (pinned exactly) is a new dependency with prebuilt native binaries as optional dependencies; install without `--omit=optional`. Its build-from-source install script stays off.
- chokidar stays on major 5.

### Library API

- **`createLogger` is now async** and resolves once the log file is open. Add `await`: `const logger = await createLogger(config.logging);`.
- **`WATCHER_ENDPOINTS` is removed from watcher-core** (D41), with `getEndpoint`, `EndpointName`, `EndpointDescriptor`, `HttpMethod` and `Endpoint`. Read routes from `WATCHER_CATALOG` instead: `WATCHER_CATALOG.byName('showVcsFile')` gives the entry's `method`, `path` and `description`, and `WATCHER_CATALOG.entries` lists them all.
- **The client fetch helpers are removed from watcher-core:** `bearerHeaders`, `tryParseJson`, `httpError`, `formatHttpError`, `HttpErrorInfo` and `unauthorizedMessage`. Use the SDK (`createWatcherClient`, `WatcherError`) or jeeves's `createCatalogClient`. `API_KEY_ENV_VAR` stays.

### Rollback to 0.20.0

Stop the service and reinstall 0.20.0. Before starting it:

1. **Squash first.** 0.20.0's squash rewrites the working tree, and replaying a 0.21.0 untrack commit inside its retained window deletes that file from disk. Turn 0.20.0's squash retention off (until every untrack commit is older than the retention boundary), or copy the untracked files aside.
2. **Over-cap files.** 0.20.0 has no size cap, so its next change to a file 0.21.0 untracked for size stages and commits it; a file over 100 MiB then makes GitHub reject every later push from that root. Find such files (on disk, over `vcs.maxFileBytes`, not listed by `git ls-files`; 0.21.0's warnings name them) and either set `vcs.enabled: false` for 0.20.0 or move them out of the watched root while 0.20.0 runs.
3. **Logs.** 0.20.0 writes `logging.file` again; the rotated files can be archived.
4. **Config.** The new keys (`vcs.maxFileBytes`, `logging.rotation`, `watch.reconcileIntervalMs`, `watch.changeSource`) can stay: 0.20.0 strips unknown keys on load and watches with chokidar.
5. **Clients.** Roll the SDK back to 0.2.0 and the plugin to 0.17.0 with it: plugin 0.17.0 restores the old tool names, so revert any allow-list or prompt that names the 0.18.0 tools.
6. **Exclusions.** Move every pattern from each root's `.git/info/exclude` back into the root `.gitignore`, or delete it. 0.20.0 has no `check-ignore` filter, so an active exclude pattern makes its batches fail again (and trips the breaker), and its `POST /vcs/exclude` `remove` looks only in `.gitignore` files. A pattern moved into a `.gitignore` also drops its files from search under 0.20.0, so delete rather than move any pattern whose files must stay searchable. Files 0.21.0 untracked stay untracked until they next change.
