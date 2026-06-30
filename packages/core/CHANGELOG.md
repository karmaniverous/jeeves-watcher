# Changelog

All notable changes to this project will be documented in this file.

## [unreleased]

### 💼 Other

- [230] fix: squashmanager compound defect (#230)

- Bug 1: Use configured branch name instead of dynamic git branch detection
- Bug 2: Restart throttle timer after commit failure so re-queued files retry
- Bug 3: Pause/resume coordination between SquashManager and VcsManager
- Bug 4: Add timeouts to all git operations (30s standard, 120s cherry-pick, 60s push)
- Bug 5: Exclude "nothing to commit" from circuit breaker failure count
- Bug 6: Startup orphan branch detection and recovery

Adds branch field to VcsConfig schema (default: "master").
SquashManager now pauses VcsManager commit pipeline during squash.
All execFileAsync and gitAddViaStdin calls have explicit timeouts.

Fixes #230
## [0.2.4] - 2026-06-13

### 🚀 Features

- Add shared endpoint catalog in core package (#196)

### 🐛 Bug Fixes

- Replace VCS commit debounce with throttle (#221)

### 💼 Other

- Fix

### 🧪 Testing

- Add endpoint catalog unit tests

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-core v0.2.4
## [0.2.3] - 2026-06-13

### 🚀 Features

- *(core)* Add staleLockThresholdMs and maxConsecutiveFailures to vcsConfigSchema

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-core v0.2.3
## [0.2.2] - 2026-06-12

### 🚀 Features

- Declarative VCS git identity config (#209)

### 🐛 Bug Fixes

- Address Copilot review comments on PR #210

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-core v0.2.2
## [0.2.1] - 2026-06-11

### 💼 Other

- Updated jeeves-core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-core v0.2.1
## [0.2.0] - 2026-06-11

### 🚀 Features

- *(vcs)* Phase 1 — foundation (config schema, watch.paths, startup checks)

### 🐛 Bug Fixes

- Export VCS types + fix typedoc anchor
- Address Copilot review comments

### 💼 Other

- Updated core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-core v0.2.0
## [0.1.2] - 2026-05-29

### 💼 Other

- [0-18] chore: update dependencies

Pin ajv to ~8.18.0 to avoid type mismatch with @fastify/ajv-compiler.
Remove unused hast dependency. Fix knip config and stan integration.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
- [0-18] chore: update dependencies

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-core v0.1.2
## [0.1.1] - 2026-05-13

### 🚀 Features

- Extract core package with shared schemas, types, defaults, and constants

### 🐛 Bug Fixes

- Address review feedback — remove temp script, tslib external, gemini dimensions

### ⚙️ Miscellaneous Tasks

- Update all deps, switch core to rollup build, fix lint errors
- Release @karmaniverous/jeeves-watcher-core v0.1.1
