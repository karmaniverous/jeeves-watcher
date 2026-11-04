# Changelog

All notable changes to this project will be documented in this file.

## [0.5.0-2] - 2026-11-04

### 🚀 Features

- *(core)* Schemas for the remaining catalog routes (A1)
- *(core)* Catalog entries for every route (A2)
- *(service)* Serve every route from the catalog (A3)
- *(vcs)* Staging, untracking, squash plumbing, git process layer (0.21.0 B2, B3)
- *(vcs)* VCS-only exclusion through .git/info/exclude (spec B4)

### 🐛 Bug Fixes

- *(core)* Close the vcs/status push error and breaker shapes, enum the exclude action, describe wait
- Independent review findings on the clients

### 💼 Other

- [281] chore: pin jeeves 0.8.0-6; drop fastify-type-provider-zod, zod-openapi, openapi-types

jeeves 0.8.0-6 makes fastify, fastify-type-provider-zod and zod-openapi its own dependencies (jeeves Decision 88), so the service and core no longer supply them.
- [281] chore: pin jeeves 0.8.0
- [281] chore: patch/minor deps, prettier-ignore generated baselines, squash test timeout
- [281] refactor: one requiredQueryParam for the vcs/show query schema (#281)

Independent review: each parameter repeated its 'Missing required query parameter' text, and the min(1) copy was redundant (a schema-level error also words its checks; the mutant dropping it survived). openapi.json unchanged.
- [281] docs: review fixes for the skill, API reference and plugin README (#281)

SKILL.md: watcher_scan cursor is a string or a number (D34); WATCHER_SKILL regenerated. API reference: the /vcs/show 400 error text. Plugin README: one list. registerCatalog TSDoc: one preValidation hook, HEAD included. vcsShowHandler: say why its VCS-off guard stays.
- [281] test,docs: second-review nits on the fix commits (#281)

Fresh review of faf2fe9..e0cfae6: test names now say what they prove (hashObject, InitialScanTracker without start); errorResult keys compared in any order (M3 still KILLED); skill scan response cursor is a string, number or null (WATCHER_SKILL regenerated); catalogTools module TSDoc lists the four standard tools and registerCatalogTool.
- Pin @karmaniverous/jeeves 0.9.0-0 (D42)
- Patch and minor dependency updates
- Require Node >=24.22.2 (D188)

### 🚜 Refactor

- *(service)* DRY and file-size pass over the catalog completion
- *(vcs)* Exclude nits (threshold constant, remove text, commit message template, VcsManager doc)
- [**breaking**] Verb-first operation names (D77); retire WATCHER_ENDPOINTS (D41)
- *(core)* [**breaking**] Drop the client fetch helpers

### 📚 Documentation

- *(core)* Skill authoring notes for maps, set, frontmatter globs, virtual rules (#258)
- Core README describes the full catalog; walk no longer 500s without a body
- *(logging)* MaxFiles keeps that many rotated files plus the active one (D184); cite D182/D183 in the API reference
- Rollback step for .git/info/exclude, absolute vs root-relative globs, core skill
- *(vcs)* Leading-slash glob with root in the upgrade guide, tool and skill text; stronger remove test
- Clients on the catalog (SDK guide, CLI reference, plugin guide, upgrading)

### 🧪 Testing

- *(vcs)* Assert a timed-out git call is killed, not left to finish; skill: health.vcs

### ⚙️ Miscellaneous Tasks

- *(skills)* Trim jeeves-watcher skill description to 160 chars or less
## [0.5.0-0] - 2026-10-30

### 💼 Other

- [281] chore(deps): pin @karmaniverous/jeeves 0.8.0-1 and add catalog plumbing (#281)

Exact 0.8.0-1 pin in core, service and plugin; fastify-type-provider-zod for the service's catalog routes; zod-openapi and openapi-types for core's OpenAPI writer. Rollup externals match jeeves and dependency sub-paths by prefix so no second copy of core is bundled. The plugin pin test accepts a prerelease. Core's generated status tool schema now closes additionalProperties (accepted baseline change).
- [281] feat: prompt rules and skill live in watcher-core (#281)

WATCHER_PROMPT_RULES (moved verbatim from the plugin) and WATCHER_SKILL (compiled from packages/core/skills/jeeves-watcher/SKILL.md by npm run skill, with a drift test) are exported from watcher-core and set on both descriptors. The plugin injects the descriptor's promptRules and its build writes the skill to dist/skills/jeeves-watcher, the folder its manifest lists. The injected rules stay byte-identical to 0.17.0.
- [281] feat: WATCHER_CATALOG in watcher-core (#281)

The slice catalog: core's standard status/config/configApply (status health typed by the new loose watcherHealthSchema, config routes bearer-authenticated), render, search, scan and the non-JSON vcsShow (vcsShowQuerySchema). Search and scan request fields carry descriptions for tools and OpenAPI. WATCHER_ENDPOINTS is unchanged and a test holds the catalog to it on method and path. Core's declaration build keeps jeeves sub-paths external too.
- [281] chore(deps): re-pin @karmaniverous/jeeves to 0.8.0-4 (#281)

G1/G2 already present at this pin (route logger option, Zod params on validation issues); this is the step 5 core loop-back re-pin.
- [281] feat: OpenAPI in watcher-core (#281)

Add npm run openapi writer, committed openapi.json, WATCHER_OPENAPI_DOCUMENT export, ./openapi.json sub-path export, drift and content tests.
- [281] chore: pin @karmaniverous/jeeves 0.8.0-5 (#281)

0.8.0-5 adds #151 (runnable argument parser additions); nothing the watcher uses changes. One copy of jeeves and of zod; all gates pass.
- [281] docs: document the catalog slice (#281)

API reference: which routes are in WATCHER_CATALOG, the catalog's 400 details shape ({ slot, path, code, message, params }), response validation and its 500, the new GET /openapi.json (open, like /status), /config/apply's catalog schema with the deprecated config alias and the replace check, the /vcs/show 400 change, and the 401 wording of catalog-built tools. Root README: /openapi.json row, alias deprecated, plugin on jeeves 0.8 with catalog-built tools. watcher-core README: catalog, OpenAPI and agent-content exports. Plugin README and guide: which tools core builds from the catalog, the two error formats, generated parameter bounds, replace on config_apply, vcs_show returning text. Skill: tool errors, API key, and a troubleshooting entry for a catalog tool's 401 and the response-validation 500 (D31); WATCHER_SKILL regenerated. npm run docs has zero warnings.
- [281] chore: update dependencies (patch and minor) (#281)

npm-check-updates --peer --target minor in the root and all four packages, then npm audit fix (non-breaking): audit 17 -> 14. One zod (4.6.7). All gates pass. Left for the owner (major): chokidar 6, unpdf 2, typescript 7 (blocked by typescript-eslint's peer range), mdast-util-from-adf 2.2 and release-it 19 (the remaining audit highs).
- [281] feat: name the missing /vcs/show query parameter (#281)

Independent review finding 12. vcsShowQuerySchema had no messages of its own, so a missing parameter read 'Invalid input: expected string, received undefined'. Like the admin schemas, it now says 'Missing required query parameter: path' (or commit), for a missing or an empty value. New catalog.test case; the recorded catalog 400 bodies for the two vcsShow scenarios are updated to match. OpenAPI document unchanged.
- [281] docs: review fixes for auth exemptions, error formats and key order (#281)

Independent review findings 9 and 10. The API reference summary and the skill now say GET /openapi.json needs no key, and the skill's endpoint table lists it. The error-format line covers the catalog-built tools' HTTP <status>: <body>. Catalog error bodies list error before code, so the config-apply 400 examples in the skill and the plugin guide now match the real text. WATCHER_SKILL regenerated.
- [281] chore: release @karmaniverous/jeeves-watcher-core v0.5.0-0
## [0.4.0] - 2026-10-14

### 🚀 Features

- *(core)* Config schema for payload indexes, API key and sources
- *(core)* Request/response schemas for public API endpoints
- *(service)* Record processing failures as typed issues
- *(service)* POST /documents, POST /documents/delete, source references on render/metadata/reindex
- *(service)* Reindex scopes cover source documents
- Machine-readable error codes on API error responses

### 🐛 Bug Fixes

- Harden delete filters, issue records and config schemas
- *(service)* Harden source processing, reindex routing and shutdown
- *(service)* Client-input errors are 4xx; reindex prepares once
- *(service)* Gemini requests the configured dimensions; init template uses 3072
- *(release)* GitHub release notes and changelog use the new version tag

### 🚜 Refactor

- One HTTP client contract in core; error status comes from the code
- Shared reindex deps, defaults and work policy; admin route schemas; route handlers wrapped
- Core owns defaults, limits and index-type guards; uniform route registrars

### 📚 Documentation

- Typedoc covers core, sdk and service; fix docs warnings
- *(core)* Rebuild-metadata endpoint description and status uptime comment match the code
- Root README, CONTRIBUTING and package READMEs match the code
- *(core)* StateDir description names values.v8
- Neutral example paths and names in guides, skill and tests

### 🧪 Testing

- Neutral example names; remove client wording from tests and docs
- Route-wide auth, shared limiter, reload and deletion proofs
- Rule handlers, plugin config tools, CLI helpers and edges

### ⚙️ Miscellaneous Tasks

- Ship LICENSE in every package; core README and license metadata
- Tsdoc config for core; real-git reconciliation tests get the suite's 30 s budget
- Release @karmaniverous/jeeves-watcher-core v0.4.0
## [0.3.1] - 2026-09-30

### 💼 Other

- [249] fix(vcs): resilient commit pipeline and squash guard (#249)

- Detect "nothing staged" with `git diff --cached --quiet` instead of
  parsing git's "nothing to commit" text; empty batches are no-ops.
- Partition each batch: add existing files, stage removal of
  tracked-but-missing files (`git rm --cached --ignore-unmatch`), drop
  missing untracked files. A missing path never fails the batch.
- Reconcile tracked deletions in the watch scope at the end of the
  initial scan so the baseline commit records them.
- Retry only index.lock contention (`shouldRetry` on util/retry).
- Circuit breaker retains pending files and recovers on a time-based
  half-open attempt (`vcs.circuitBreakerCooldownMs`, default 5 min);
  state exposed per root in GET /vcs/status.
- Pass `-c core.longpaths=true` on every VCS git invocation.
- Squash refuses on in-progress sequencer/rebase/merge state or dirty
  tracked files, aborts a failed cherry-pick during cleanup, and stale
  state is reported at startup.

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-core v0.3.1
## [0.3.0] - 2026-09-29

### 💼 Other

- [234] updated jeeves

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-core v0.3.0
## [0.2.6-2] - 2026-09-28

### 💼 Other

- [234] chore(deps): pin @karmaniverous/jeeves 0.6.0-9
- [234] chore: release @karmaniverous/jeeves-watcher-core v0.2.6-2
## [0.2.6-1] - 2026-09-27

### 💼 Other

- [234] chore: update root package-lock in release-it after:bump hooks
- [234] chore(deps): pin @karmaniverous/jeeves 0.6.0-8
- [234] chore: release @karmaniverous/jeeves-watcher-core v0.2.6-1
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
