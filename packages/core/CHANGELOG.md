# Changelog

All notable changes to this project will be documented in this file.

## [unreleased]

### 💼 Other

- [234] chore: update root package-lock in release-it after:bump hooks
- [234] chore(deps): pin @karmaniverous/jeeves 0.6.0-8
## [0.2.6-0] - 2026-09-27

### 💼 Other

- [234] chore(deps): ncu --peer across all packages (keep @karmaniverous/jeeves pinned)
- [234] chore: knip and prettier clean-up

- knip 6.38: remove unused barrel re-exports and a stale backward-compat re-export (no public API change)

- prettier 3.9 formatting; add .prettierignore for generated CHANGELOGs, config.schema.json and .stan state
- [234] feat!: move core and service to @karmaniverous/jeeves 0.6.0-4

Drop the v0.x workspace-writer descriptor fields (sectionId,
refreshIntervalSeconds, generateToolsContent) removed in core 0.6.
- [234] chore(core): use root TypeScript 6

Drop core's typescript ^7.0.2 devDependency (added only because ncu --peer
ran per package); core now uses the root typescript ^6.0.3.
- [234] chore(deps): pin @karmaniverous/jeeves 0.6.0-6
- [234] fix(release): use --github.preRelease for release-it 21
- [234] fix: post-e2e fixes for core 0.6 (#238, #239, #240, #241)

- deps: openclaw/service depend on watcher-core ^0.2.5 || ^0.2.6-0 so the core-0.6 prerelease resolves (#238)

- service: pin @qdrant/js-client-rest ^1.19.0; real-QdrantClient regression test for POST /search (#239)

- service: /config/apply merges into the running config file and deep-merges patches (#240)

- engines.node >=22.13 everywhere; docs say 22.13+ (#241)
- [234] chore(deps): pin @karmaniverous/jeeves 0.6.0-7
- [234] chore: release @karmaniverous/jeeves-watcher-core v0.2.6-0
## [0.2.5] - 2026-06-30

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

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-core v0.2.5
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
