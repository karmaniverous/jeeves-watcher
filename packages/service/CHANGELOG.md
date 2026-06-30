# Changelog

All notable changes to this project will be documented in this file.

## [unreleased]

### 💼 Other

- [224] fix: append /** to bare directory watch paths (fixes #224)
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
- [230] refactor: SOLID/DRY pass on VCS subsystem (#230)

- Extract GIT_TIMEOUT_STANDARD/CHERRY_PICK/PUSH constants from magic numbers
- Extract buildAuthenticatedPushUrl() — eliminates duplicate token-URL
  construction in vcsPush.ts and SquashManager.forcePushIfConfigured()
- Extract getExecErrorFields() — shared error field extraction replaces
  duplicate unsafe casts in isIndexLockError() and isNothingToCommitError()
- Convert SquashManager constructor from 8 positional params to
  (rootPath, retention, logger, options?) pattern
- [230] test: close coverage gaps for #230 utilities and error paths

- Unit tests for getExecErrorFields() (ExecFileException fields,
  plain Error, non-Error values, non-string properties)
- Unit tests for buildAuthenticatedPushUrl() (no token, undefined token,
  HTTPS injection, special chars, SSH URLs, file:// URLs)
- VcsManager.start() error resilience: orphan recovery throws →
  logs error → manager continues and commits normally
- [230] docs: sync guides and README with #230 code changes

- Add `branch` field to VCS config tables and JSON examples in
  configuration.md, version-control.md, and service README
- Document pause/resume coordination in squash mechanism
- Document startup orphan branch detection and recovery
- Document "nothing to commit" handling and retry timer after failure
- Document git operation timeouts (30s/120s/60s)
- Add troubleshooting entries: wrong branch after crash, git timeouts
- [230] fix: call resumeCommits when pauseCommits throws (#230)

If pauseCommits() threw after partially executing (e.g., flush succeeded
but the flag wasn't set), runSquash() returned early without reaching
the finally block that calls resumeCommits(). This could leave the
commit pipeline permanently paused.

Add resumeCommits() call in the pause-failure catch block. Resume is
safe to call even if the pipeline isn't actually paused.

Addresses Copilot review comment on PR #231.
- Updated core
## [0.18.10] - 2026-06-13

### 🚀 Features

- Add shared endpoint catalog in core package (#196)

### 🐛 Bug Fixes

- Replace VCS commit debounce with throttle (#221)

### 💼 Other

- Updated core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.18.10
## [0.18.9] - 2026-06-13

### 🐛 Bug Fixes

- *(vcs)* Add stale lock detection, circuit breaker, and re-queue cap (#219)
- *(app)* Thread VCS callbacks through config reload (#218)
- *(vcs)* Apply retention defaults when retention config is omitted (#216)
- *(api)* Prune incomplete-result safety and retry improvements (#182)
- Address PR #220 review — error handling, circuit breaker, case sensitivity, and test determinism
- Address Copilot review — error handling, circuit breaker reset, Windows case sensitivity, test determinism

### 💼 Other

- Updated core
- Lint fix

### 📚 Documentation

- Update VCS and prune documentation for new features

### ⚡ Performance

- *(api)* Rewrite computePrunePlan with filter-first approach (#187)

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.18.9
## [0.18.8] - 2026-06-12

### 🐛 Bug Fixes

- *(vcs)* Eliminate redundant baseline enumeration (#214)
- *(vcs)* Address review — flush race, JSDoc, LOC decomposition

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.18.8
## [0.18.7] - 2026-06-12

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.18.7
## [0.18.6] - 2026-06-12

### 🐛 Bug Fixes

- Use stdin-based git add to avoid ENAMETOOLONG (#211)
- *(vcs)* Handle EPIPE on gitAddViaStdin stdin writes

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.18.6
## [0.18.5] - 2026-06-12

### 🚀 Features

- Declarative VCS git identity config (#209)

### 🐛 Bug Fixes

- Address Copilot review comments on PR #210

### 💼 Other

- Updated core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.18.5
## [0.18.4] - 2026-06-12

### 🐛 Bug Fixes

- Case-insensitive VCS path matching on Windows + baseline commit for pre-existing files
- Address Copilot review - baseline skips AI, isBaseline persists across batches, null-byte ls-files, injectable platform

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.18.4
## [0.18.3] - 2026-06-11

### 🐛 Bug Fixes

- *(vcs)* Extract static roots from glob watch paths instead of skipping

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.18.3
## [0.18.2] - 2026-06-11

### 💼 Other

- Installed deps

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.18.2
## [0.18.1] - 2026-06-11

### 🧪 Testing

- Increase VCS test timeouts from 15s to 30s
- Increase timeout for VCS tests that create real git repos

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.18.1
## [0.18.0] - 2026-06-11

### 🚀 Features

- *(vcs)* Phase 1 — foundation (config schema, watch.paths, startup checks)
- *(vcs)* Phase 2 — commit pipeline (debounce, batch, git commit)
- *(vcs)* Phase 3 — read API (status, history, show, diff, check-exclusion)
- *(vcs)* Phase 4 — write API (revert, exclude)
- *(vcs)* Phase 5 — AI-generated commit messages
- *(vcs)* Phase 6 — remote push after commit
- *(vcs)* Phase 7 — squash retention on schedule
- *(vcs)* Gateway credential fallback for AI commit messages (D6)

### 🐛 Bug Fixes

- Export VCS types + fix typedoc anchor
- Address Copilot review comments

### 💼 Other

- Updated core

### 🚜 Refactor

- *(vcs)* SOLID/DRY pass — extract shared utilities, separate bootstrap from runtime

### 📚 Documentation

- *(vcs)* Phase 9 — skill, README, code comments, TOOLS.md
- *(service)* VCS guide + cross-references in all service guides

### 🧪 Testing

- *(vcs)* Dedicated unit tests for gitExec, vcsBootstrap; cron edge case

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.18.0
## [0.17.11] - 2026-05-29

### 💼 Other

- [0-18] chore: update dependencies

Pin ajv to ~8.18.0 to avoid type mismatch with @fastify/ajv-compiler.
Remove unused hast dependency. Fix knip config and stan integration.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
- [0-18] fix: case-insensitive path matching on Windows (#199)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
- [0-18] fix: pass offset through hybrid search path (#200)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
- [0-18] fix: eliminate double collection scroll on live prune (#182)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
- [0-18] fix: batch embedding calls to respect Gemini 100-doc limit (#186)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
- [0-18] style: add missing JSDoc offset param + fix stale test module doc
- [0-18] test: add offset-zero edge case for hybridSearch (#200)
- [0-18] docs: fix stale prune response and collection bootstrap claims in guides
- [0-18] chore: update dependencies

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
- [0-18] fix: consume substituteEnvVars from jeeves core (#202)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
- [0-18] fix: sort imports and revert ajv bump for fastify compat

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
- Updated core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.17.11
## [0.17.10] - 2026-05-16

### 🐛 Bug Fixes

- Pin jeeves-watcher-core dependency to ^0.1.1

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.17.10
## [0.17.9] - 2026-05-13

### 🚀 Features

- Extract core package with shared schemas, types, defaults, and constants

### ⚙️ Miscellaneous Tasks

- Add npm publish safety net (.npmignore + gitignore *.local)
- Move changelog generation to after:bump hook
- Update all deps, switch core to rollup build, fix lint errors
- Release @karmaniverous/jeeves-watcher v0.17.9
## [0.17.8] - 2026-05-03

### 💼 Other

- Updated jeeves core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.17.8
## [0.17.7] - 2026-04-22

### 💼 Other

- Updated jeeves core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.17.7
## [0.17.6] - 2026-04-15

### 💼 Other

- Updated jeeves-core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.17.6
## [0.17.5] - 2026-04-08

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.17.5
## [0.17.4] - 2026-04-05

### 💼 Other

- Unhoisted jeeves

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.17.4
## [0.17.3] - 2026-04-05

### 💼 Other

- Hoisted jeeves
- Hoisted knip

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.17.3
## [0.17.2] - 2026-04-05

### ⚙️ Miscellaneous Tasks

- Housekeeping batch (#184, #179, #176, #180, #178)
- Release @karmaniverous/jeeves-watcher v0.17.2
## [0.17.1] - 2026-04-05

### ⚙️ Miscellaneous Tasks

- Update deps for @karmaniverous/jeeves-core v0.5.3
- Release @karmaniverous/jeeves-watcher v0.17.1
## [0.17.0] - 2026-04-03

### 🚀 Features

- Bump core to ^0.5.1, engine floor >=22, adopt getPackageVersion
- Add fetchSiblings built-in JsonMap helper for contextual embedding

### 🐛 Bug Fixes

- Remove unused JSON_TEXT_FIELDS export (knip)
- Break circular dependencies, clean knip config

### 🚜 Refactor

- Adopt core createConfigApplyHandler for /config/apply
- Adopt core DEFAULT_PORTS for port constants
- SOLID/DRY pass across codebase

### 📚 Documentation

- Update skill, READMEs, and diagrams for v0.17.0
- Sync all documentation and diagrams with implementation

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.17.0
## [0.16.3] - 2026-03-31

### 💼 Other

- [CORE-046] feat: integrate core 0.4.6 — init() called before descriptor.run()

Bumps @karmaniverous/jeeves to 0.4.6 which fixes karmaniverous/jeeves#53:
createServiceCli now calls init() before descriptor.run() in the start
command, so getBindAddress() and other core functions that require
initialization work correctly.

This unblocks upgrading prod from 0.15.2 to the current release.

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.16.3
## [0.16.2] - 2026-03-30

### 💼 Other

- [CORE-045] feat: integrate core 0.4.5 - add run callback to descriptor

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.16.2
## [0.16.1] - 2026-03-30

### 💼 Other

- [PHASE-2] fix: resolve package root for bundled CLI entry point

The descriptor used import.meta.url-relative paths for package.json and
startCommand, which broke after Rollup bundled descriptor.ts into
dist/cli/jeeves-watcher/index.js (3 levels deep instead of 1).

Fix: walk up from current file to find the package root by name,
then resolve all paths from there.
- [PHASE-2] fix: use package-directory for robust package root resolution

Replace hand-rolled directory walk with packageDirectorySync from
package-directory (already a core dependency). Fixes bundled CLI
crashing with Cannot find module errors when import.meta.url-relative
paths resolve incorrectly after Rollup bundling.

Added package-directory as direct dependency of service package.

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.16.1
## [0.16.0] - 2026-03-30

### 💼 Other

- [PHASE-0] [#161] fix: catch async rejection in onRulesChanged instead of swallowing it

The buildTemplateEngineAndCustomMapLib promise was fire-and-forget with
`void`, silently discarding rejections. Replace with explicit .catch()
that logs the error so failures are visible and diagnosable.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
- [PHASE-0] [#159] fix: add try/catch to facets handler for config and schema errors

getConfig() and buildFacetSchema() can throw on malformed inference rule
configs. Wrap both in try/catch to return graceful error responses
instead of crashing the endpoint.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
- [PHASE-0] [#162] fix: batch embedAndUpsert to prevent OOM on large files

embedAndUpsert previously sent all chunk points in a single upsert call,
causing OOM on large files. Add configurable batch size (default 50) and
loop upserts in batches. Includes tests for batching behavior.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
- [PHASE-0] fix: improve Phase 0 fixes - add tests, graceful facets degradation, waitForIdleWorkers
- [PHASE-0] fix: guard upsertBatchSize against zero/negative (Gemini review)
- [PHASE-1] feat: config path migration to jeeves-watcher/config.json (#149)
- [PHASE-1] fix: address Gemini review - log migration errors, remove unused resolveConfigDir
- [PHASE-2] feat: core 0.4.4 + Zod 4, dep updates, descriptor definition

- Bump @karmaniverous/jeeves to ^0.4.4 (Zod 4)
- Update all deps not blocked by peer constraints (eslint 10, knip 6, vitest 4.1.2, etc)
- Fix ESLint 10 new rules: no-useless-assignment, preserve-caught-error
- Rewrite watcherComponent.ts to return clean JeevesComponentDescriptor
- Add descriptor.ts + descriptor.test.ts (Phase 2 D2)
- Remove unused PROBE_TIMEOUT_MS export
- Update writerIntegration test for core managed-content position change
- [PHASE-2] [PHASE-3] feat: replace hand-rolled CLI with createServiceCli factory (S1)

- Replace CLI entrypoint with createServiceCli(watcherDescriptor)
- Consolidate 7 custom commands into customCommands.ts
- Wire customCliCommands on the descriptor
- Delete 17 dead CLI files (commands, helpers, wrappers)
- Rewrite CLI tests for new structure
- Resolve all knip findings:
  - Remove unused isQdrantAvailable export
  - Remove unused migrateConfigPath/MigrateConfigResult re-exports
  - Make BinaryFileStoreOptions interface non-exported
- [PHASE-2] [PHASE-3] feat: adopt core status handler + getBindAddress (S2/S3)

- Replace /status handler with core createStatusHandler factory
  - Watcher-specific health data (collection, reindex, initialScan) moved to getHealth callback
  - Response shape now follows core StatusResponse convention
- Adopt getBindAddress('watcher') for service bind address (S3)
- Keep watcher-specific /config/apply handler (core factory assumes config-init semantics that don't fit the live-config/reindex model)
- [PHASE-2] refactor: SOLID/DRY review — extract shared patterns, consolidate constants

DRY fixes in customCommands.ts:
- Extract withApiOptions helper (eliminates 7x repeated --port/--host options)
- Extract handleErrors wrapper (eliminates 7x identical try/catch blocks)
- Extract parseMetadataArgs (enrich command validation logic)
- Extract baseUrl helper accepting ApiOpts interface

DRY fixes in plugin constants:
- Extract COMPONENT_NAME, SERVICE_PACKAGE, PLUGIN_PACKAGE, DEFAULT_PORT
- watcherComponent.ts now references constants instead of hardcoded strings
- DEFAULT_API_URL derived from DEFAULT_PORT

Cleanup:
- Remove stale Phase 3/4 placeholder comments from descriptor.ts
- Add descriptive comments explaining why onConfigApply and generateToolsContent
  are wired at different layers
- Remove accidentally committed commit-msg.txt, add to .gitignore
- [PHASE-2] test: improve coverage for touched code, remove trivial and dead tests

descriptor.test.ts:
- Add tests for customMerge (verifies name-based rule merging)
- Add test for customCliCommands (verifies all 7 commands registered)
- Add test for initTemplate (returns config skeleton)
- Add test for startCommand (produces valid node invocation)
- Remove trivial "returns empty plugin tool list in Phase 2" test

customCommands.test.ts:
- Add helpers command tests (format output, no-helpers message)
- Add enrich --key flag parsing test
- Add enrich invalid JSON rejection test
- Add custom --host/--port test
- Add scan body verification (filter, limit, countOnly, fields splitting)
- Add reindex multi-path array test
- Strengthen rebuild-metadata and issues tests to verify response output
- Parse and assert request bodies instead of using loose string contains

Dead code removal:
- Delete handlers/status.ts (replaced by core createStatusHandler in api/index.ts)
- Delete handlers/status.test.ts (tested dead code)
- [PHASE-2] docs: sync all documentation with current implementation

CLI reference (guides/cli-reference.md) — full rewrite:
- Remove stale commands: query, config-reindex, config-apply, validate (standalone)
- Document current CLI structure: core standard commands + domain-specific commands
- Add service start/stop/restart/status subcommands
- Document config/config validate/config apply subcommand structure

SKILL.md:
- Update /status response description for core StatusResponse shape
  (health.collection.pointCount instead of collection.pointCount)
- Fix vectorStore config example: collection → collectionName
- Update watcher_status tool description

Delete dead status handler:
- handlers/status.ts replaced by core createStatusHandler in api/index.ts
- handlers/status.test.ts tested dead code
- [PHASE-2] docs: align guide index structure with jeeves-server pattern

- Add CHANGELOG to children front matter in both index files
- Add descriptive list body to service and plugin guide indexes
- Individual guides already have title front matter

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.16.0
## [0.15.2] - 2026-03-28

### 🐛 Bug Fixes

- Linux CI compatibility — cross-platform path test and skip integration tests without Qdrant

### 💼 Other

- [153] fix: use getter for fileSystemWatcher in API handlers (#153)
- [153] test: simplify walk rebuild getter test
- [152] fix: EnrichmentStore SQLite recovery on startup (#152)
- [152] fix: address PR review feedback on #152
- [151] perf: ValuesManager binary serialization and debounced flush (#151)
- [151] refactor: address PR review feedback on #151
- [150] fix: QdrantClient write path leaks undici Agents (#150)
- [150] refactor: address PR review feedback on #150
- [120] fix: pause event queue during prune to prevent ECONNRESET under load
- [120] fix: ensure queue resumes on all error paths (Gemini review)
- [120] fix: drain in-flight queue work before prune scroll

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.15.2
## [0.15.1] - 2026-03-25

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.15.1
## [0.15.0] - 2026-03-24

### 🚀 Features

- Add full hot-reload with watcher rebuild on config change (#113)

### 🐛 Bug Fixes

- Close EnrichmentStore on shutdown (#145), fix schema path resolution in metadata validation (#116)

### 🚜 Refactor

- Replace captured config with getter pattern in API handlers (#144, #146)
- Convert remaining captured config refs to getters in status, render, walk, search handlers (SOLID/DRY)

### ⚡ Performance

- Cache compiled rules in configMatch handler, invalidate on config change

### ⚙️ Miscellaneous Tasks

- Un-export unused types flagged by knip
- Release @karmaniverous/jeeves-watcher v0.15.0
## [0.14.0] - 2026-03-23

### 🚀 Features

- Extend interfaces for move detection and enrichment store
- Add EnrichmentStore and composable merge utility
- Add ContentHashCache for move detection
- Add MoveCorrelator and wire into FileSystemWatcher
- Implement DocumentProcessor.moveFile for zero-embedding moves

### 🚜 Refactor

- Wire EnrichmentStore into processor, remove sidecar metadata system

### 🧪 Testing

- Remove trivial tests, add move pipeline integration tests

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.14.0
## [0.13.0] - 2026-03-22

### 🚀 Features

- Upgrade @karmaniverous/jeeves to ^0.3.0

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.13.0
## [0.12.0] - 2026-03-21

### 🚀 Features

- Adopt @karmaniverous/jeeves core v0.2.0 SDK (#138) ([#138](https://github.com/karmaniverous/jeeves-watcher/pull/138))

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.12.0
## [0.11.1] - 2026-03-19

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.11.1
## [0.11.0] - 2026-03-18

### 🐛 Bug Fixes

- Add tagPrefix to auto-changelog config for monorepo tags

### 📚 Documentation

- Sync documentation with implementation, replace Mermaid/ASCII with PlantUML diagrams

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.11.0
## [0.10.1] - 2026-03-16

### 💼 Other

- [FIX-122] fix: use chokidar getWatched() for /walk endpoint instead of filesystem traversal

Closes #122

### 🚜 Refactor

- Use path.join() for getWatchedFiles path construction

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.10.1
## [0.10.0] - 2026-03-15

### 🚀 Features

- *(watcher)* Add initial scan statistics logging

### 🐛 Bug Fixes

- Use package-directory for version resolution in /status

### 💼 Other

- [V0_10_0] feat: add scope validation, rules and path reindex scopes (Fixes 1, 2, 13)

- Validate reindex scope against VALID_REINDEX_SCOPES; reject unknown scopes with 400
- Add 'rules' scope: re-applies inference rules via processRulesUpdate without re-embedding
- Add 'path' scope: reindex a specific file or directory with watch scope and gitignore validation
- Update configWatchConfigSchema to accept 'rules'
- Update watcher_reindex plugin tool with new scopes and optional path parameter
- Broaden triggerReindex type to ReindexScope across configApply and API index
- [V0_10_0] fix: wire gitignore filter into reindex path, support standalone .gitignore (Fixes 3, 4)

- Thread GitignoreFilter through ExecuteReindexDeps to processAllFiles/listFilesFromGlobs
- listFilesFromGlobs now accepts optional isGitignored callback
- GitignoreFilter.scan() falls back to standalone .gitignore at watch root when no .git dir
- createWatcher now returns { watcher, gitignoreFilter } for API server threading
- All executeReindex call sites pass gitignoreFilter
- [V0_10_0] fix: return actionable error details from wrapHandler, fix withCache payload capture (Fixes 7, 9)

- wrapHandler now returns { error: className, message: actualMessage } instead of generic 'Internal server error'
- withCache intercepts reply.send() to capture response payload for caching
- On cache hit, withCache sends the captured payload via reply.send()
- Fix 8 (watcher_enrich 500) deferred to runtime diagnosis with improved error messages
- [V0_10_0] feat: version in /status, live scoreThresholds, virtual rule template rebuild, remove dead config keys (Fixes 6, 10, 12)

- Add version field to /status response (read from package.json at startup)
- Plugin reads search.scoreThresholds from config via /config/query, falls back to defaults
- Score interpretation includes actionable guidance (strong/relevant/noise)
- onRulesChanged rebuilds template engine with merged rules (config + virtual)
- Remove slots and extractors from root config schema (dead keys)
- Remove slots from merged virtual document
- Fix 11 (port fallback) already resolved in prior version — no 3456 reference found
- [V0_10_0] test: fix mock dependencies and test assertions for reindex and cache handlers
- [V0_10_0] chore: fix lint errors in promptInjection, clean up knip config, regenerate schema
- [V0_10_0] fix: replace brittle glob parsing in path reindex with full file list + directory filter

Address Gemini code review: directory-scoped path reindex now lists all watched
files via listFilesFromGlobs then filters to the target directory, instead of
attempting to parse and reconstruct glob patterns with a regex.
- [FIX-14] feat: prune reindex scope, blast area plan, dryRun (Fix 14)

- Add 'prune' reindex scope: scrolls Qdrant points, checks file_path
  against watch scope + gitignore, batch-deletes orphaned points
- Add blast area 'plan' object to all reindex responses (counts by root)
- Add dryRun parameter: returns plan without executing
- Thread vectorStore into ExecuteReindexDeps for prune access
- Refactor processAllFiles to accept pre-computed file list
- Guard configWatch auto-trigger against prune scope
- Add CONFIG_WATCH_VALID_SCOPES constant
- Update plugin tool: prune in scope enum, dryRun parameter
- Tests: dryRun per scope (issues/full/rules/prune), prune execution

Closes Phase 6 of spec dev plan.
- [FIX-14] docs: update all guides for reindex scopes, dryRun, plan, and version

- api-reference.md: /config-reindex now documents all 5 scopes, dryRun,
  plan response shape; /status includes version field; error response
  includes error+message fields
- cli-reference.md: config-reindex documents all scopes, --path, --dry-run
- configuration.md: configWatch.reindex includes rules scope, notes
  path/prune exclusion
- inference-rules.md: config watch reindex table adds rules scope, notes
  path/prune exclusion
- README.md: updated API and CLI tables for all scopes
- openclaw README.md: updated watcher_reindex description
- SKILL.md: already updated in previous commit ([#118](https://github.com/karmaniverous/jeeves-watcher/pull/118))
- [FIX-15] feat: initial scan visibility + prune scroll resilience (Fixes 15+16)

Fix 15 - Initial Scan Visibility:
- Add InitialScanTracker with start/setMatched/incrementProcessed/complete
- Thread tracker through app init -> FileSystemWatcher -> status handler
- /status now includes initialScan: { active, filesMatched, filesProcessed,
  startedAt, completedAt, durationMs }

Fix 16 - Prune Scroll Resilience:
- Add scrollPageWithRetry: per-page retry with exponential backoff (3
  attempts, 1s base) and cursor-based resume on connection failure
- Reduce prune scroll page size from 1000 to 500
- Add incomplete flag to ReindexPlan for partial results on exhausted retries
- Refactor computePrunePlan to use page-by-page scroll instead of
  async generator (enables retry/resume per page)
- [FIX-15] fix: rename initialScan.filesProcessed to filesEnqueued for clarity

The field tracks files enqueued to the processing queue during scan,
not files that completed processing. Rename avoids misleading operators.
- [FIX-15] docs: add initialScan to api-reference and SKILL.md

- api-reference.md: initialScan fields in /status response + table
- SKILL.md: watcher_status documents initialScan field, diagnostics updated
- [FIX-17][FIX-18][FIX-19] feat: API Consolidation (Phase 8)

- Convert POST /config/query to GET /config with unified inference rules
- Rename watcher_query to watcher_config tool
- Rename POST /config-reindex to POST /reindex with array path support
- Update CLI, plugin, and tests to match
- [FIX-17] [FIX-20][FIX-21] Phase 9: POST /walk endpoint, watcher_walk tool, auto rules-reindex on rule registration

Fix 20:
- New POST /walk handler: accepts { globs: string[] }, walks watch roots with
  glob intersection, returns { paths, matchedCount, scannedRoots }
- Route registered in api/index.ts
- New watcher_walk OpenClaw tool in watcherTools.ts
- Tests: walk handler (4 tests), plugin tool registration + execution

Fix 21:
- onRulesChanged now extracts match globs from virtual rules
  (match.properties.file.properties.path.glob) and fires executeReindex
  with scope 'rules' and extracted globs array (fire-and-forget)
- Skips reindex when no rules have match globs
- Tests: 3 integration tests via Fastify inject

Docs:
- SKILL.md: added watcher_walk docs, updated API reference table
  (POST /walk, renamed endpoints from Phase 8), renamed watcher_query
  references to watcher_config, noted auto-reindex on rule registration

Quality gates: 492 service tests, 28 plugin tests, zero lint/typecheck/knip errors.
- [FIX-17] [FIX-19] fix: rename CLI config-reindex to reindex, fix stale doc refs, clean watch.ignored
- [FIX-17] [FIX-19] fix: consolidate CLI reindex commands, fix scope validation, update dev plan
- [FIX-17] [REFACTOR] DRY/SOLID pass: extract helpers, consolidate walk functions, separate onRulesChanged
- [FIX-17] [TEST] Add missing test coverage: fileScan walk functions, extractMatchGlobs, rules+path reindex, createIsGitignored
- [FIX-17] [DOCS] Resolve all docs warnings and root-level knip issues
- [FIX-17] chore: gitignore generated docs directories
- [FIX-17] chore: remove changelogs (generated at build time)

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.10.0
## [0.9.9] - 2026-03-14

### 💼 Other

- [114] fix: add nocase to fileScan picomatch calls (#114)

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.9.8
- Release @karmaniverous/jeeves-watcher v0.9.9
## [0.9.7] - 2026-03-12

### 💼 Other

- [107] fix: remove HTML escaping from renderDoc markdown output

renderValueAsMarkdown was passing string values through
hbs.Utils.escapeExpression(), which HTML-encodes backticks, angle
brackets, quotes, and ampersands. Since renderDoc produces markdown
(not HTML), this corrupted fenced code blocks, PlantUML diagrams,
and any content containing special characters.

The fix returns string values as-is and defers HTML escaping to the
downstream markdown-to-HTML renderer (jeeves-server's marked pipeline).

Fixes #107

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.9.7
## [0.9.6] - 2026-03-12

### 🚀 Features

- Support glob/negation patterns in render.frontmatter

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.9.6
## [0.9.5] - 2026-03-10

### 🚀 Features

- Add concurrent file processing for reindex using radash parallel

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.9.5
## [0.9.4] - 2026-03-09

### ⚡ Performance

- *(service)* Use node:https with keep-alive agent for Gemini API

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.9.4
## [0.9.3] - 2026-03-09

### ⚡ Performance

- *(service)* Replace LangChain Gemini wrapper with direct API calls

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.9.3
## [0.9.2] - 2026-03-09

### 🐛 Bug Fixes

- *(service)* Skip live value aggregation for non-enumerated facet uiHint types

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.9.2
## [0.9.0] - 2026-03-08

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.9.0
## [0.9.0-0] - 2026-03-08

### 🚀 Features

- *(service)* Add POST /scan handler with cursor-based pagination

### 🐛 Bug Fixes

- *(service)* Clean up scan handler and test lint issues

### 🚜 Refactor

- *(service)* Extract scrollPage/count helpers, eliminate DRY violations

### 📚 Documentation

- *(service)* Add TypeDoc for scrollPage return type fields
- Add POST /scan and POST /rules/reapply to all documentation

### 🎨 Styling

- Format scrollPage return type

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.9.0-0
## [0.8.5] - 2026-03-07

### 🐛 Bug Fixes

- *(values)* Decompose array metadata into individual trackable elements
- *(facets)* Reject object-type properties as facets, validate uiHint types
- *(test)* Properly type mock deps in configReindex.test.ts
- *(app)* Pass valuesManager to processor during initialization

### ⚙️ Miscellaneous Tasks

- Re-encode .gitignore as UTF-8 (was UTF-16 BOM from PowerShell)
- Release @karmaniverous/jeeves-watcher v0.8.5
## [0.8.4] - 2026-03-07

### 🐛 Bug Fixes

- Update values index before hash check in processFile

### 💼 Other

- Lintfix

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.8.4
## [0.8.2] - 2026-03-07

### 🐛 Bug Fixes

- Pass valuesManager and issuesManager to config-reindex handler

### 💼 Other

- Lintfix

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.8.2
## [0.8.1] - 2026-03-07

### 🐛 Bug Fixes

- Update values index during rules reindex (processRulesUpdate)

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.8.1
## [0.8.0] - 2026-03-07

### 🚀 Features

- Add renderAs field to inference rule schema
- Add renderAs to applyRules and buildMergedMetadata return types
- Add POST /render endpoint with isPathWatched and renderFile
- Add GET /search/facets endpoint with schema-derived facet definitions
- Add Cache-Control no-cache support to withCache, wrap /render endpoint

### 💼 Other

- Updated diagrams

### 📚 Documentation

- Comprehensive documentation audit fixes
- Add v0.8.0 documentation for renderAs, POST /render, GET /search/facets

### 🧪 Testing

- Add render handler tests and buildMetadata last-match-wins test

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.8.0
## [0.7.1] - 2026-03-05

### 🐛 Bug Fixes

- Inject ignored paths and expose watch config in merged document
- Restore strict typings in withCache and fix lint errors

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.7.1
## [0.7.0] - 2026-03-05

### 🚀 Features

- Add renderDoc helper and render block for structured document rendering
- Add api caching and agent bootstrap prompt injection

### 🐛 Bug Fixes

- Use consistent default port 1936 in server.listen() and schema description
- Resolve helper file paths relative to configDir in /config/validate
- Resolve Gemini PR feedback (XSS escaping, js-yaml dump, radash get)

### 🚜 Refactor

- Review pass — remove dead code, DRY context, harden tests, use radash title
- SOLID/DRY pass — extract buildSyntheticAttributes, shared sleep, deduplicate handlers
- SOLID/DRY pass — deduplicate attributes, handlers, sleep; fix extractor registry

### ⚙️ Miscellaneous Tasks

- Fix tsdoc warnings (add tsdoc.json, escape > chars in yamlEscape)
- Copy tsdoc.json into package directories
- Release @karmaniverous/jeeves-watcher v0.7.0
## [0.6.9] - 2026-03-01

### ⚙️ Miscellaneous Tasks

- Fix all eslint errors (210 → 0) (#76) ([#76](https://github.com/karmaniverous/jeeves-watcher/pull/76))
- Change default port from 3456 to 1936 (#75) ([#75](https://github.com/karmaniverous/jeeves-watcher/pull/75))
- Release @karmaniverous/jeeves-watcher v0.6.9
## [0.6.8] - 2026-02-28

### 🐛 Bug Fixes

- Read CLI version from package.json instead of hardcoding ([#72](https://github.com/karmaniverous/jeeves-watcher/pull/72))

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.6.8
## [0.6.7] - 2026-02-28

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.6.7
## [0.6.6] - 2026-02-28

### 🐛 Bug Fixes

- Use fresh QdrantClient for write ops to avoid stale keep-alive connections

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.6.6
## [0.6.5] - 2026-02-28

### 🚀 Features

- POST /rules/reapply endpoint + plugin auto-reapply after registration (#65) ([#65](https://github.com/karmaniverous/jeeves-watcher/pull/65))

### 🐛 Bug Fixes

- Disable AJV strict mode to suppress schema type warnings (#55) ([#55](https://github.com/karmaniverous/jeeves-watcher/pull/55))

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.6.5
## [0.6.4] - 2026-02-27

### 🐛 Bug Fixes

- Add nocase and dot options to AJV glob keyword

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.6.4
## [0.6.3] - 2026-02-27

### 🐛 Bug Fixes

- Revert unconditional ensureTextIndex from initialization.ts

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.6.3
## [0.6.2] - 2026-02-27

### 🐛 Bug Fixes

- Ensure text index on startup + re-register virtual rules after watcher restart (#60) ([#60](https://github.com/karmaniverous/jeeves-watcher/pull/60))

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.6.2
## [0.6.1] - 2026-02-27

### ⚙️ Miscellaneous Tasks

- Bump @karmaniverous/jsonmap to 2.1.1
- Release @karmaniverous/jeeves-watcher v0.6.1
## [0.6.0] - 2026-02-27

### 🚀 Features

- Convert to monorepo with service and openclaw plugin packages
- *(service)* Add filesystem date metadata and line offsets (#46) ([#46](https://github.com/karmaniverous/jeeves-watcher/pull/46))
- *(service)* Handlebars set expressions + date normalization (#47) ([#47](https://github.com/karmaniverous/jeeves-watcher/pull/47))
- *(service)* Add hybrid search with BM25 text index and RRF fusion (#48) ([#48](https://github.com/karmaniverous/jeeves-watcher/pull/48))
- Support external rule file references in inferenceRules config (#50) ([#50](https://github.com/karmaniverous/jeeves-watcher/pull/50))
- Memory slot takeover with virtual rules API (#49) ([#49](https://github.com/karmaniverous/jeeves-watcher/pull/49))

### 🐛 Bug Fixes

- Resolve eslint unbound-method and prettier errors

### 💼 Other

- Removed docs from release script

### 🚜 Refactor

- Service SOLID/DRY fixes + 54 new tests (#51) ([#51](https://github.com/karmaniverous/jeeves-watcher/pull/51))
- DRY fixes and comprehensive test coverage for openclaw package (#52) ([#52](https://github.com/karmaniverous/jeeves-watcher/pull/52))
- Extract modules to fix 300 LOC violations (#53) ([#53](https://github.com/karmaniverous/jeeves-watcher/pull/53))

### 📚 Documentation

- Add guides index pages for foldable typedoc sections
- Fix template syntax, stale references, and add missing API/tool docs

### ⚙️ Miscellaneous Tasks

- Convert repo to npm workspaces monorepo
- Fix knip after monorepo split
- Fix docs, READMEs, and rollup config for monorepo
- Make service package ESM-only, remove CJS and IIFE outputs
- Align release-it config for monorepo
- Release @karmaniverous/jeeves-watcher v0.5.1
- Fix monorepo release-it tags, plugin id, and version sync
- Release @karmaniverous/jeeves-watcher v0.6.0
