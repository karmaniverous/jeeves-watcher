# Changelog

All notable changes to this project will be documented in this file.

## [unreleased]

### 🚀 Features

- *(core)* Add staleLockThresholdMs and maxConsecutiveFailures to vcsConfigSchema
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
