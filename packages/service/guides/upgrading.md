---
title: Upgrading
---

# Upgrading

What changes for an existing deployment, release by release. The [Changelog](../CHANGELOG.md) lists every commit; this page lists what you may need to act on.

## 0.21.0 (in progress)

### Logging

- **`logging.file` now rotates by default** (10 MiB, daily, 14 rotated files kept plus the active one). Every file, the active one included, is named `<name>.<yyyy-MM-dd>.<n>.<ext>` (`watcher.2026-11-04.1.log` for `watcher.log`), so a plain `watcher.log` is no longer written. Point anything that tails the log at the newest file by modification time.
- Rotation deletes older files matching that name pattern, so keep the log in a folder of its own. A single `watcher.log` left by 0.20.0 is not managed by rotation: archive it, then delete it.
- If you rotate the file externally (logrotate), either remove that rotation or set `logging.rotation: false` to keep one plain file.
- The rotating stream runs in the main thread (no worker), and a refusal to start is also written to stderr, so a service manager's stderr log shows why the service stopped.
- See [Configuration](./configuration.md#logging---logging-configuration).

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

### Node.js and chokidar 6

- **The service needs Node.js 22.22 or later** (was 22.13), because chokidar 6 requires it. The SDK and core packages keep 22.13.
- **chokidar 6 replaces chokidar 5** for the chokidar change source and the config-file watcher. The backend is pinned to 0.20.0's behaviour: one `fs.watch` per directory (chokidar's `native` backend), or stat polling with `watch.usePolling` (`polling`). chokidar 6's default `auto` backend (recursive `fs.watch` on Windows and macOS) is not used. Editor atomic-write handling is unchanged: on with native watching, off when polling.
- `watch.pollIntervalMs` must be positive: chokidar 6 rejects `0` or less, so the service then uses chokidar's default of 100 ms.
- chokidar 6 never applies `watch.ignored` to the folders above a watch root (a missing root is watched through its parent until it appears). A root that an `ignored` pattern itself names is still skipped, and paths inside the roots are filtered as before.
- The `CHOKIDAR_USEPOLLING` and `CHOKIDAR_INTERVAL` environment variables still override the config.

### Library API

- **`createLogger` is now async** and resolves once the log file is open. Add `await`: `const logger = await createLogger(config.logging);`.

### Rollback to 0.20.0

Stop the service and reinstall 0.20.0. Before starting it:

1. **Squash first.** 0.20.0's squash rewrites the working tree, and replaying a 0.21.0 untrack commit inside its retained window deletes that file from disk. Turn 0.20.0's squash retention off (until every untrack commit is older than the retention boundary), or copy the untracked files aside.
2. **Over-cap files.** 0.20.0 has no size cap, so its next change to a file 0.21.0 untracked for size stages and commits it; a file over 100 MiB then makes GitHub reject every later push from that root. Find such files (on disk, over `vcs.maxFileBytes`, not listed by `git ls-files`; 0.21.0's warnings name them) and either set `vcs.enabled: false` for 0.20.0 or move them out of the watched root while 0.20.0 runs.
3. **Logs.** 0.20.0 writes `logging.file` again; the rotated files can be archived.
4. **Config.** The new keys (`vcs.maxFileBytes`, `logging.rotation`) can stay: 0.20.0 strips unknown keys on load.
