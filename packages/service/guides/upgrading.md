---
title: Upgrading
---

# Upgrading

What changes for an existing deployment, release by release. The [Changelog](../CHANGELOG.md) lists every commit; this page lists what you may need to act on.

## 0.21.0 (in progress)

### Logging

- **`logging.file` now rotates by default** (10 MB, daily, 14 rotated files kept plus the active one). Every file, the active one included, is named `<name>.<yyyy-MM-dd>.<n>.<ext>` (`watcher.2026-11-04.1.log` for `watcher.log`), so a plain `watcher.log` is no longer written. Point anything that tails the log at the newest file by modification time.
- Rotation deletes older files matching that name pattern, so keep the log in a folder of its own.
- If you rotate the file externally (logrotate), either remove that rotation or set `logging.rotation: false` to keep one plain file.
- See [Configuration](./configuration.md#logging---logging-configuration).

### Version control

- **`vcs.maxFileBytes` (default 100 MB) caps what git versions.** A new file over the cap is not staged. A tracked file already over it is untracked, in a commit of its own, the next time it changes: its history ends at its last committed version and the file stays on disk. Set `0` to keep the old behaviour. See [File Size Cap](./version-control.md#file-size-cap).
- **Squash rewrites history with plumbing only.** It no longer needs a clean working tree or a free `index.lock`, never checks out or resets, and no longer creates `__squash_orphan_*` branches. Leftover `__squash_orphan_*` branches from 0.20.0 are reported at startup; delete them once you are sure they hold nothing you need.
- **Startup repairs each root:** a stale `index.lock` is removed, abandoned git temp files are swept, and a HEAD detached or off `vcs.branch` is reported (the watcher never switches branches).
- **`GET /status`** gains `health.vcs`: the VCS root count, files pending commit, roots whose breaker is tripped, and when the oldest one tripped.
- **`GET /config/schema`** shows `maxFileBytes` under `watch.paths[].vcs`, the per-root override.

### Library API

- **`createLogger` is now async** and resolves once the log file is open. Add `await`: `const logger = await createLogger(config.logging);`.
