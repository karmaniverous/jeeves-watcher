# Changelog

All notable changes to this project will be documented in this file.

## [0.15.2] - 2026-06-12

### 💼 Other

- Updated core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.15.2
## [0.15.1] - 2026-06-11

### 💼 Other

- Installed deps

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.15.1
## [0.15.0] - 2026-06-11

### 🚀 Features

- *(vcs)* Phase 8 — plugin tools (7 VCS tools)

### 🐛 Bug Fixes

- Export VCS types + fix typedoc anchor
- Address Copilot review comments

### 💼 Other

- [204] fix(openclaw): externalize @karmaniverous/jeeves in rollup config

Moves @karmaniverous/jeeves from bundled to external in both plugin and
CLI rollup builds. The plugin installer copies the jeeves core lib into
the extensions directory, so it is always resolvable at runtime.

Service package already externalizes via dynamic dependency list.

Closes #204
- Updated core

### 📚 Documentation

- *(vcs)* Phase 9 — skill, README, code comments, TOOLS.md
- *(openclaw)* Sync README and integration guide with VCS tools

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.15.0
## [0.14.11] - 2026-05-29

### 💼 Other

- [0-18] chore: update dependencies

Pin ajv to ~8.18.0 to avoid type mismatch with @fastify/ajv-compiler.
Remove unused hast dependency. Fix knip config and stan integration.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
- [0-18] fix(openclaw): add contracts.tools manifest (#192)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
- [0-18] docs: sync README and guides with 0.18.0 changes

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
- [0-18] docs: fix stale prune response and collection bootstrap claims in guides
- [0-18] chore: update dependencies

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
- Updated core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.14.11
## [0.14.10] - 2026-05-16

### 🐛 Bug Fixes

- Pin jeeves-watcher-core dependency to ^0.1.1

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.14.10
## [0.14.9] - 2026-05-13

### 🚀 Features

- Extract core package with shared schemas, types, defaults, and constants

### ⚙️ Miscellaneous Tasks

- Add npm publish safety net (.npmignore + gitignore *.local)
- Move changelog generation to after:bump hook
- Update all deps, switch core to rollup build, fix lint errors
- Release @karmaniverous/jeeves-watcher-openclaw v0.14.9
## [0.14.8] - 2026-05-03

### 💼 Other

- Updated jeeves core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.14.8
## [0.14.7] - 2026-04-22

### 💼 Other

- Updated jeeves core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.14.7
## [0.14.6] - 2026-04-15

### 💼 Other

- Updated jeeves-core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.14.6
## [0.14.5] - 2026-04-08

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.14.5
## [0.14.4] - 2026-04-05

### 💼 Other

- Unhoisted jeeves

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.14.4
## [0.14.3] - 2026-04-05

### 💼 Other

- Hoisted jeeves
- Hoisted knip

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.14.3
## [0.14.2] - 2026-04-05

### ⚙️ Miscellaneous Tasks

- Housekeeping batch (#184, #179, #176, #180, #178)
- Release @karmaniverous/jeeves-watcher-openclaw v0.14.2
## [0.14.1] - 2026-04-05

### ⚙️ Miscellaneous Tasks

- Update deps for @karmaniverous/jeeves-core v0.5.3
- Release @karmaniverous/jeeves-watcher-openclaw v0.14.1
## [0.14.0] - 2026-04-03

### 🚀 Features

- Bump core to ^0.5.1, engine floor >=22, adopt getPackageVersion
- Wire gatewayUrl into ComponentWriter for cleanup escalation

### 🐛 Bug Fixes

- Break circular dependencies, clean knip config

### 🚜 Refactor

- Adopt createPluginToolset, ship watcher_service tool
- Adopt core DEFAULT_PORTS for port constants

### 📚 Documentation

- Update skill, READMEs, and diagrams for v0.17.0
- Sync all documentation and diagrams with implementation

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.14.0
## [0.13.2] - 2026-03-31

### 💼 Other

- [CORE-046] feat: integrate core 0.4.6 — init() called before descriptor.run()

Bumps @karmaniverous/jeeves to 0.4.6 which fixes karmaniverous/jeeves#53:
createServiceCli now calls init() before descriptor.run() in the start
command, so getBindAddress() and other core functions that require
initialization work correctly.

This unblocks upgrading prod from 0.15.2 to the current release.

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.13.2
## [0.13.1] - 2026-03-30

### 💼 Other

- [CORE-045] feat: integrate core 0.4.5 - add run callback to descriptor

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.13.1
## [0.13.0] - 2026-03-30

### 💼 Other

- [PHASE-2] feat: core 0.4.4 + Zod 4, dep updates, descriptor definition

- Bump @karmaniverous/jeeves to ^0.4.4 (Zod 4)
- Update all deps not blocked by peer constraints (eslint 10, knip 6, vitest 4.1.2, etc)
- Fix ESLint 10 new rules: no-useless-assignment, preserve-caught-error
- Rewrite watcherComponent.ts to return clean JeevesComponentDescriptor
- Add descriptor.ts + descriptor.test.ts (Phase 2 D2)
- Remove unused PROBE_TIMEOUT_MS export
- Update writerIntegration test for core managed-content position change
- [PHASE-2] [PHASE-4] feat: plugin refactor — core CLI factory, simplified menu, new status shape

O2: Remove ACTION REQUIRED blocks from generateWatcherMenu
  - Core ComponentWriter handles unreachable state independently
  - Function now throws on failure (createAsyncContentCache retains last good value)
O3: Replace hand-rolled plugin CLI with createPluginCli factory
O4: Update status parsing for core StatusResponse convention
  - Read health.collection.pointCount instead of collection.pointCount
- Remove unused DEFAULT_QDRANT_URL constant
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

- Release @karmaniverous/jeeves-watcher-openclaw v0.13.0
## [0.12.1] - 2026-03-25

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.12.1
## [0.12.0] - 2026-03-24

### 📚 Documentation

- Update watcher_config_apply skill text to reflect hot-reload capability

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.12.0
## [0.11.0] - 2026-03-23

### 📚 Documentation

- Sync README, SKILL.md with v0.14.0 implementation (move detection, enrichment store)

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.11.0
## [0.10.0] - 2026-03-22

### 🚀 Features

- Upgrade @karmaniverous/jeeves to ^0.3.0

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.10.0
## [0.9.0] - 2026-03-21

### 🚀 Features

- Adopt @karmaniverous/jeeves core v0.2.0 SDK (#138) ([#138](https://github.com/karmaniverous/jeeves-watcher/pull/138))

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.9.0
## [0.8.1] - 2026-03-19

### 🚀 Features

- *(openclaw)* Update to @karmaniverous/jeeves@0.1.6, add servicePackage/pluginPackage

### 🐛 Bug Fixes

- *(openclaw)* Bundle @karmaniverous/jeeves into plugin output
- *(openclaw)* Update @karmaniverous/jeeves to 0.1.3 (content path fix)
- *(openclaw)* Copy core content/ at build time, simplify rollup externals
- *(openclaw)* Include content/ in CLI installer copy list
- *(openclaw)* Add 10s timeout to menu generation fetch calls
- *(openclaw)* Update @karmaniverous/jeeves to 0.1.5 (workspace path priority fix)

### 🚜 Refactor

- *(openclaw)* Use core resolveWorkspacePath from @karmaniverous/jeeves@0.1.4

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.8.1
## [0.8.0] - 2026-03-18

### 🚀 Features

- *(openclaw)* Adopt @karmaniverous/jeeves core components

### 🐛 Bug Fixes

- Add tagPrefix to auto-changelog config for monorepo tags
- *(openclaw)* Derive plugin version from package.json instead of hardcoding

### 🚜 Refactor

- *(openclaw)* Upgrade to @karmaniverous/jeeves v0.1.1, use createAsyncContentCache, static imports, real integration tests
- *(openclaw)* Resolve SOLID/DRY violations

### 📚 Documentation

- Add embedding cost behavioral gate to plugin SKILL.md
- Sync documentation with implementation, replace Mermaid/ASCII with PlantUML diagrams

### 🧪 Testing

- *(openclaw)* Add watcherComponent unit tests, document ServiceCommands in spec
- *(openclaw)* Remove trivial typeof tests, add getApiUrl/getConfigRoot coverage

### ⚙️ Miscellaneous Tasks

- *(openclaw)* Update dev dependencies
- Release @karmaniverous/jeeves-watcher-openclaw v0.8.0
## [0.7.0] - 2026-03-15

### 💼 Other

- [V0_10_0] feat: add scope validation, rules and path reindex scopes (Fixes 1, 2, 13)

- Validate reindex scope against VALID_REINDEX_SCOPES; reject unknown scopes with 400
- Add 'rules' scope: re-applies inference rules via processRulesUpdate without re-embedding
- Add 'path' scope: reindex a specific file or directory with watch scope and gitignore validation
- Update configWatchConfigSchema to accept 'rules'
- Update watcher_reindex plugin tool with new scopes and optional path parameter
- Broaden triggerReindex type to ReindexScope across configApply and API index
- [V0_10_0] feat: version in /status, live scoreThresholds, virtual rule template rebuild, remove dead config keys (Fixes 6, 10, 12)

- Add version field to /status response (read from package.json at startup)
- Plugin reads search.scoreThresholds from config via /config/query, falls back to defaults
- Score interpretation includes actionable guidance (strong/relevant/noise)
- onRulesChanged rebuilds template engine with merged rules (config + virtual)
- Remove slots and extractors from root config schema (dead keys)
- Remove slots from merged virtual document
- Fix 11 (port fallback) already resolved in prior version — no 3456 reference found
- [V0_10_0] chore: fix lint errors in promptInjection, clean up knip config, regenerate schema
- [V0_10_0] docs: add score threshold guidance to SKILL.md, reference skill from TOOLS.md injection
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
- [FIX-17] [DOCS] Resolve all docs warnings and root-level knip issues
- [FIX-17] chore: remove changelogs (generated at build time)
- [FIX-17] docs: update READMEs with renamed endpoints, tools, and new /walk endpoint

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.7.0
## [0.6.2] - 2026-03-12

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.6.2
## [0.6.1] - 2026-03-10

### 📚 Documentation

- Document reindex.concurrency in published and dev skills

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.6.1
## [0.6.0] - 2026-03-08

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.6.0
## [0.6.0-0] - 2026-03-08

### 🚀 Features

- Add proactive bootstrap diagnostics to prompt injection
- Add renderAs field to inference rule schema
- Add renderAs to applyRules and buildMergedMetadata return types
- *(plugin)* Add watcher_scan tool and update prompt injection

### 🚜 Refactor

- *(service)* Extract scrollPage/count helpers, eliminate DRY violations

### 📚 Documentation

- *(skill)* Add watcher_scan tool section and query planning guidance
- Add POST /scan and POST /rules/reapply to all documentation

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.6.0-0
## [0.5.7] - 2026-03-05

### 🚀 Features

- *(openclaw)* Strengthen escalation rule with search-first guidance

### 📚 Documentation

- Comprehensive documentation audit fixes

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.5.7
## [0.5.6] - 2026-03-05

### 🚀 Features

- *(openclaw)* Clean up TOOLS.md watcher section on uninstall

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.5.6
## [0.5.5] - 2026-03-05

### 🚀 Features

- *(openclaw)* Replace agent:bootstrap hook with disk-based TOOLS.md writer

### 🐛 Bug Fixes

- *(openclaw)* Resolve lint and type errors in toolsWriter

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.5.5
## [0.5.4] - 2026-03-05

### 🐛 Bug Fixes

- Prevent watcher menu duplication in TOOLS.md injection

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.5.4
## [0.5.3] - 2026-03-05

### 🐛 Bug Fixes

- *(openclaw)* Use correct registerHook name for prompt injection (#82) ([#82](https://github.com/karmaniverous/jeeves-watcher/pull/82))
- *(openclaw)* Add required name option to registerHook call
- *(openclaw)* Rename hook registration to match plugin name
- *(openclaw)* Align registerHook opts type with OpenClawPluginHookOptions

### 💼 Other

- Fix
- Fix

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.5.3
## [0.5.1] - 2026-03-05

### 🐛 Bug Fixes

- Inject ignored paths and expose watch config in merged document

### 💼 Other

- Lintfix

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.5.1
## [0.5.0] - 2026-03-05

### 🚀 Features

- Add api caching and agent bootstrap prompt injection
- Make plugin cache TTL configurable and fix API port fallback mismatch

### 📚 Documentation

- *(skill)* Clarify date normalization convention via toUnix helper
- *(skill)* Add render/template authoring guidance and transformer definitions
- *(skill)* Remove redundant Orientation Pattern and Quick Start step

### ⚙️ Miscellaneous Tasks

- Copy tsdoc.json into package directories
- Release @karmaniverous/jeeves-watcher-openclaw v0.5.0
## [0.4.2] - 2026-03-01

### 🐛 Bug Fixes

- Complete Qdrant systemd setup and add WorkingDirectory to watcher service

### ⚙️ Miscellaneous Tasks

- Remove memory-core Gemini migration from bootstrap
- Release @karmaniverous/jeeves-watcher-openclaw v0.4.2
## [0.4.1] - 2026-03-01

### 🚀 Features

- *(openclaw)* Add complete bootstrap sequence to skill (#78) ([#78](https://github.com/karmaniverous/jeeves-watcher/pull/78))

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.4.1
## [0.4.0] - 2026-03-01

### 🚀 Features

- *(openclaw)* [**breaking**] Remove memory slot takeover, simplify to pure extension

### 🐛 Bug Fixes

- *(openclaw)* Correct embedding alignment config path in skill
- *(openclaw)* Remove deployment-specific content from skill
- *(openclaw)* Add deployment-discovery guidance to skill, prevent assumption of specific domains

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.4.0
## [0.3.13] - 2026-03-01

### 🚀 Features

- *(openclaw)* Add memory → archive escalation pattern to skill

### ⚙️ Miscellaneous Tasks

- Change default port from 3456 to 1936 (#75) ([#75](https://github.com/karmaniverous/jeeves-watcher/pull/75))
- Release @karmaniverous/jeeves-watcher-openclaw v0.3.13
## [0.3.11] - 2026-02-28

### 🚀 Features

- *(openclaw)* Disable memory-core when installing with --memory

### 💼 Other

- Lintfix

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.3.11
## [0.3.10] - 2026-02-28

### 🚀 Features

- *(openclaw)* Brand memory tool responses with provider field

### 🐛 Bug Fixes

- *(openclaw)* Skill proactive check matches positive case only

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.3.10
## [0.3.9] - 2026-02-28

### 📚 Documentation

- *(openclaw)* Add bootstrap, install modes, and proactive posture to skill

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.3.9
## [0.3.8] - 2026-02-28

### 🚀 Features

- *(openclaw)* Decouple plugin from watcher config vocabulary
- *(openclaw)* --memory flag for install CLI

### 💼 Other

- Lintfix

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.3.8
## [0.3.7] - 2026-02-28

### 🐛 Bug Fixes

- Use domains (plural array) in virtual rules and search filter (#66) ([#66](https://github.com/karmaniverous/jeeves-watcher/pull/66))

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.3.7
## [0.3.6] - 2026-02-28

### 🚀 Features

- POST /rules/reapply endpoint + plugin auto-reapply after registration (#65) ([#65](https://github.com/karmaniverous/jeeves-watcher/pull/65))

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.3.6
## [0.3.5] - 2026-02-27

### 🐛 Bug Fixes

- Use glob instead of pattern for virtual rule matching (case-insensitive on Windows)

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.3.5
## [0.3.4] - 2026-02-27

### 🐛 Bug Fixes

- NormalizePath preserves drive letter case to match service path normalization

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.3.4
## [0.3.3] - 2026-02-27

### 🐛 Bug Fixes

- Ensure text index on startup + re-register virtual rules after watcher restart (#60) ([#60](https://github.com/karmaniverous/jeeves-watcher/pull/60))

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.3.3
## [0.3.2] - 2026-02-27

### 🐛 Bug Fixes

- Plugin config lookup uses correct entry key (jeeves-watcher-openclaw) (#59) ([#59](https://github.com/karmaniverous/jeeves-watcher/pull/59))

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.3.2
## [0.3.1] - 2026-02-27

### 🐛 Bug Fixes

- Plugin installer now claims memory slot in OpenClaw config
- Update test fixture to include slots for idempotency check (#58) ([#58](https://github.com/karmaniverous/jeeves-watcher/pull/58))

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.3.1
## [0.3.0] - 2026-02-27

### 🚀 Features

- Memory slot takeover with virtual rules API (#49) ([#49](https://github.com/karmaniverous/jeeves-watcher/pull/49))

### 🚜 Refactor

- DRY fixes and comprehensive test coverage for openclaw package (#52) ([#52](https://github.com/karmaniverous/jeeves-watcher/pull/52))

### 📚 Documentation

- Fix template syntax, stale references, and add missing API/tool docs

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.3.0
## [0.2.0] - 2026-02-27

### 🐛 Bug Fixes

- *(openclaw)* Use error.cause for precise connection error detection
- *(openclaw)* Skill review feedback (#45) ([#45](https://github.com/karmaniverous/jeeves-watcher/pull/45))

### ⚙️ Miscellaneous Tasks

- *(openclaw)* Merge skills, simplify build, improve error messaging
- Release @karmaniverous/jeeves-watcher-openclaw v0.2.0
## [0.1.2] - 2026-02-25

### 🚀 Features

- Add install/uninstall CLI to bypass OpenClaw spawn EINVAL bug on Windows

### 🐛 Bug Fixes

- Resolve lint errors in openclaw CLI and add rollup externals
- Remove plugins.allow management from CLI, only manage entries and tools.allow
- Conditionally manage plugins.allow only when already populated
- Apply same conditional logic to tools.allow as plugins.allow

### 📚 Documentation

- Document self-installer CLI and Windows spawn EINVAL workaround

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.1.2
## [0.1.1] - 2026-02-25

### 🚀 Features

- Convert to monorepo with service and openclaw plugin packages

### 💼 Other

- Added env local template
- Package version 0

### 📚 Documentation

- Add guides index pages for foldable typedoc sections

### ⚙️ Miscellaneous Tasks

- Fix docs, READMEs, and rollup config for monorepo
- Align release-it config for monorepo
- Release @karmaniverous/jeeves-watcher-openclaw v0.1.0
- Fix monorepo release-it tags, plugin id, and version sync
- Release @karmaniverous/jeeves-watcher-openclaw v0.1.1
