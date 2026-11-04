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
- **Brackets are a character class.** `Report [draft].docx` matches `Report d.docx`; escape them (`Report \[draft\].docx`) to exclude the file itself.
- **The response changed:** `{ ok, file, action, untracked }` replaces `{ ok, gitignorePath, action }` (an approved wire departure). New answers: `400` for a newline, a leading `!` or `#`, braces, a whole-root pattern, or a glob outside an explicit `root`; `409 confirm_required` when more than 100 files would be untracked without `confirm: true` (nothing written); `503 not_available` with `Retry-After: 30` when the root's git lock stays busy for 30 s.
- **`GET /vcs/check-exclusion`** adds `line`, answers `excluded: false` for a path a negated rule re-includes, and answers `500` when git fails (0.20.0 answered `excluded: false`). A tracked file under a human `.gitignore` rule answers `excluded: false`: git never reports tracked paths as ignored.
- **Migrating patterns 0.20.0 wrote.** They sit in `.gitignore` files and cannot be told apart from human lines, so they are not moved. For each one you want VCS-only:
  1. Find it: `GET /vcs/check-exclusion?path=<a file it covers>` names the `.gitignore` (`source`), the pattern (`rule`) and its `line`.
  2. Remove it with the glob you used in 0.20.0: `POST /vcs/exclude` `{ "glob": "<glob>", "remove": true }` (it falls back to 0.20.0's `.gitignore` line, and `file` names the `.gitignore` it edited).
  3. Add it again: `POST /vcs/exclude` `{ "glob": "<glob>" }`. Mind the anchoring: write `**/` where the old line matched at any depth. Removing the `.gitignore` line brings the files back into the watcher's index scope, so they are embedded again (a reindex cost for large folders).

### Dependencies

- **unpdf 2** extracts PDF text. Indexed text is unchanged. unpdf 2 declares Node.js 24 or later, which the new Node floor covers.
- chokidar stays on major 5.

### Library API

- **`createLogger` is now async** and resolves once the log file is open. Add `await`: `const logger = await createLogger(config.logging);`.

### Rollback to 0.20.0

Stop the service and reinstall 0.20.0. Before starting it:

1. **Squash first.** 0.20.0's squash rewrites the working tree, and replaying a 0.21.0 untrack commit inside its retained window deletes that file from disk. Turn 0.20.0's squash retention off (until every untrack commit is older than the retention boundary), or copy the untracked files aside.
2. **Over-cap files.** 0.20.0 has no size cap, so its next change to a file 0.21.0 untracked for size stages and commits it; a file over 100 MiB then makes GitHub reject every later push from that root. Find such files (on disk, over `vcs.maxFileBytes`, not listed by `git ls-files`; 0.21.0's warnings name them) and either set `vcs.enabled: false` for 0.20.0 or move them out of the watched root while 0.20.0 runs.
3. **Logs.** 0.20.0 writes `logging.file` again; the rotated files can be archived.
4. **Config.** The new keys (`vcs.maxFileBytes`, `logging.rotation`) can stay: 0.20.0 strips unknown keys on load.
5. **Exclusions.** Move every pattern from each root's `.git/info/exclude` back into the root `.gitignore`, or delete it. 0.20.0 has no `check-ignore` filter, so an active exclude pattern makes its batches fail again (and trips the breaker), and its `POST /vcs/exclude` `remove` looks only in `.gitignore` files. A pattern moved into a `.gitignore` also drops its files from search under 0.20.0, so delete rather than move any pattern whose files must stay searchable. Files 0.21.0 untracked stay untracked until they next change.
