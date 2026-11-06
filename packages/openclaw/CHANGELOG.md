# Changelog

All notable changes to this project will be documented in this file.

## [0.18.0-0] - 2026-11-06

### 🚀 Features

- *(openclaw)* [**breaking**] Every tool built from the catalog (D38, D137)

### 🐛 Bug Fixes

- *(openclaw)* Watcher_reindex keeps 0.17.0's default scope (rules)
- Independent review findings on the clients

### 💼 Other

- [281] test: capture 0.20.0 wire and 0.17.0 plugin-surface baselines for the catalog slice (#281)

Wire scenarios for every slice route and outcome (status, config, config apply, render, search, scan, vcs/show) replayed through the real server against a recorded fixture, and the plugin's 18 tool definitions and prompt rules recorded from untouched code. Later steps list each accepted change explicitly.
- [281] chore(deps): pin @karmaniverous/jeeves 0.8.0-1 and add catalog plumbing (#281)

Exact 0.8.0-1 pin in core, service and plugin; fastify-type-provider-zod for the service's catalog routes; zod-openapi and openapi-types for core's OpenAPI writer. Rollup externals match jeeves and dependency sub-paths by prefix so no second copy of core is bundled. The plugin pin test accepts a prerelease. Core's generated status tool schema now closes additionalProperties (accepted baseline change).
- [281] feat: prompt rules and skill live in watcher-core (#281)

WATCHER_PROMPT_RULES (moved verbatim from the plugin) and WATCHER_SKILL (compiled from packages/core/skills/jeeves-watcher/SKILL.md by npm run skill, with a drift test) are exported from watcher-core and set on both descriptors. The plugin injects the descriptor's promptRules and its build writes the skill to dist/skills/jeeves-watcher, the folder its manifest lists. The injected rules stay byte-identical to 0.17.0.
- [281] chore(deps): re-pin @karmaniverous/jeeves to 0.8.0-4 (#281)

G1/G2 already present at this pin (route logger option, Zod params on validation issues); this is the step 5 core loop-back re-pin.
- [281] chore: pin @karmaniverous/jeeves 0.8.0-5 (#281)

0.8.0-5 adds #151 (runnable argument parser additions); nothing the watcher uses changes. One copy of jeeves and of zod; all gates pass.
- [281] feat: build the catalog plugin tools with core's toolset (#281)

watcher_status, watcher_config and watcher_config_apply, plus watcher_search, watcher_scan and watcher_vcs_show, now come from createPluginToolset with WATCHER_CATALOG, the tools selection and a bearer credential resolved per call (catalogTools.ts). The plugin's own config tools are deleted, and so is its local catalogMode plumbing (core's ToolDescriptor carries it). Tool names, descriptions, catalogMode, optional registration and the 0.17.0 registration order are unchanged. Parameters are generated from the request schemas; toolBaseline.test lists every delta: closed objects, open records for filter and config, the bounds the server already enforced (search limit/offset/query, scan limit 1-1000, vcs_show non-empty path and commit), scan cursor as string or number, and replace on config_apply. Catalog-built tools report errors as core's HTTP <status>: <body> (D31); the plugin-built tools keep their key guidance. watcher_vcs_show now returns file text. New distSmoke.test registers the built dist (bundled watcher-core and Zod): 18 tools in order, search/scan direct-only, bearer sent; it must find dist in CI. Mutations checked: dropping auth fails auth.test; dropping direct-only on search fails the baseline and watcherTools tests.
- [281] docs: document the catalog slice (#281)

API reference: which routes are in WATCHER_CATALOG, the catalog's 400 details shape ({ slot, path, code, message, params }), response validation and its 500, the new GET /openapi.json (open, like /status), /config/apply's catalog schema with the deprecated config alias and the replace check, the /vcs/show 400 change, and the 401 wording of catalog-built tools. Root README: /openapi.json row, alias deprecated, plugin on jeeves 0.8 with catalog-built tools. watcher-core README: catalog, OpenAPI and agent-content exports. Plugin README and guide: which tools core builds from the catalog, the two error formats, generated parameter bounds, replace on config_apply, vcs_show returning text. Skill: tool errors, API key, and a troubleshooting entry for a catalog tool's 401 and the response-validation 500 (D31); WATCHER_SKILL regenerated. npm run docs has zero warnings.
- [281] chore: update dependencies (patch and minor) (#281)

npm-check-updates --peer --target minor in the root and all four packages, then npm audit fix (non-breaking): audit 17 -> 14. One zod (4.6.7). All gates pass. Left for the owner (major): chokidar 6, unpdf 2, typescript 7 (blocked by typescript-eslint's peer range), mdast-util-from-adf 2.2 and release-it 19 (the remaining audit highs).
- [281] test: assert status sends no key (#281)

Independent review finding 7. The spec's 'status sends none' was never asserted. catalogRoutes.test now records the Authorization header of each request a keyed catalog client makes: none for status, the bearer for config. auth.test checks watcher_status sends no header even with a key configured.
- [281] docs: review fixes for auth exemptions, error formats and key order (#281)

Independent review findings 9 and 10. The API reference summary and the skill now say GET /openapi.json needs no key, and the skill's endpoint table lists it. The error-format line covers the catalog-built tools' HTTP <status>: <body>. Catalog error bodies list error before code, so the config-apply 400 examples in the skill and the plugin guide now match the real text. WATCHER_SKILL regenerated.
- [281] chore: point service and plugin at watcher-core 0.5.0-0 (#281)

The service imports WATCHER_CATALOG from watcher-core at run time, and ^0.4.0 resolved to the registry 0.4.0 published before the slice, so a packed service failed to load. Service and plugin now take ^0.5.0-0 (the owner's prerelease from this branch); in the workspace both link to packages/core. The SDK keeps ^0.4.0 (unchanged in the slice, D30). All gates pass.
- [281] chore: pin jeeves 0.8.0-6; drop fastify-type-provider-zod, zod-openapi, openapi-types

jeeves 0.8.0-6 makes fastify, fastify-type-provider-zod and zod-openapi its own dependencies (jeeves Decision 88), so the service and core no longer supply them.
- [281] chore: pin jeeves 0.8.0
- [281] chore: patch/minor deps, prettier-ignore generated baselines, squash test timeout
- [281] refactor: one registerCatalogTool for the plugin's catalog-built tools (#281)

Independent review (5721988106): index.ts and watcherTools.ts each looked a catalog-built tool up, threw when it was missing and registered it as optional. registerCatalogTool in catalogTools.ts owns that now, with a test of its throw arm (uncovered before in both places).
- [281] docs: review fixes for the skill, API reference and plugin README (#281)

SKILL.md: watcher_scan cursor is a string or a number (D34); WATCHER_SKILL regenerated. API reference: the /vcs/show 400 error text. Plugin README: one list. registerCatalog TSDoc: one preValidation hook, HEAD included. vcsShowHandler: say why its VCS-off guard stays.
- [281] test: watcher_reindex forwards path and dryRun only when set (#281)

Finishing pass: the dryRun arm of the touched watcherTools.ts was uncovered (87.5% branches); now 100%.
- [281] test,docs: second-review nits on the fix commits (#281)

Fresh review of faf2fe9..e0cfae6: test names now say what they prove (hashObject, InitialScanTracker without start); errorResult keys compared in any order (M3 still KILLED); skill scan response cursor is a string, number or null (WATCHER_SKILL regenerated); catalogTools module TSDoc lists the four standard tools and registerCatalogTool.
- Release guard for dependents' core range (#277)
- Pin @karmaniverous/jeeves 0.9.0-0 (D42)
- Patch and minor dependency updates
- Require Node >=24.22.2 (D188)
- Updated core
- Merge remote-tracking branch 'origin/main' into feature/p9-processing-at-scale
- Updated core

### 🚜 Refactor

- *(vcs)* Exclude nits (threshold constant, remove text, commit message template, VcsManager doc)
- [**breaking**] Verb-first operation names (D77); retire WATCHER_ENDPOINTS (D41)
- Finishing passes on the clients

### 📚 Documentation

- VCS-only exclusion (API reference, version-control and upgrading guides, READMEs, plugin tool descriptions)
- Rollback step for .git/info/exclude, absolute vs root-relative globs, core skill
- *(vcs)* Leading-slash glob with root in the upgrade guide, tool and skill text; stronger remove test
- Clients on the catalog (SDK guide, CLI reference, plugin guide, upgrading)
- Change source, inventory and reconciliation (P11: C1, B5b)
- No 0.17.0 tool name or WATCHER_ENDPOINTS outside the upgrading guide and the tool-name tests (Design 14)
## [0.17.0] - 2026-10-14

### 🚀 Features

- CLI and OpenClaw plugin send the API bearer key

### 🐛 Bug Fixes

- *(cli)* Report unreadable or malformed config patches cleanly
- *(openclaw)* Prompt context states score thresholds have no defaults
- *(release)* GitHub release notes and changelog use the new version tag

### 💼 Other

- Updated core

### 🚜 Refactor

- One HTTP client contract in core; error status comes from the code
- Shared reindex deps, defaults and work policy; admin route schemas; route handlers wrapped

### 📚 Documentation

- Typedoc covers core, sdk and service; fix docs warnings
- Document review fixes, error bodies and status shape
- *(openclaw)* Skill, README and integration guide match the tools; watcher_issues description
- Neutral example paths and names in guides, skill and tests

### 🧪 Testing

- Rule handlers, plugin config tools, CLI helpers and edges

### ⚙️ Miscellaneous Tasks

- Ship LICENSE in every package; core README and license metadata
- Release @karmaniverous/jeeves-watcher-openclaw v0.17.0
## [0.16.1] - 2026-09-30

### 💼 Other

- Updated core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.16.1
## [0.16.0] - 2026-09-29

### 💼 Other

- [234] updated jeeves
- Updated core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.16.0
## [0.16.0-6] - 2026-09-29

### 💼 Other

- [234] [248] fix: tell models to call watcher_search/watcher_scan directly, not via tool_call

Stopgap for openclaw/openclaw#161022. Closes #248.
- [234] chore: release @karmaniverous/jeeves-watcher-openclaw v0.16.0-6
## [0.16.0-5] - 2026-09-29

### 💼 Other

- [234] [247] feat(openclaw): make watcher_search and watcher_scan direct tools under OpenClaw Tool Search

Register watcher_search and watcher_scan with catalogMode 'direct-only' so OpenClaw 2026.9 Tool Search keeps them model-visible instead of hiding them in the tool_search catalog. guardTool is now generic and preserves descriptor properties. Decompose watcherTools (432 lines) into apiTool/vcsTools modules to honor the 300-line limit.

Closes #247
- [234] chore: release @karmaniverous/jeeves-watcher-openclaw v0.16.0-5
## [0.16.0-4] - 2026-09-28

### 💼 Other

- [234] chore(deps): pin @karmaniverous/jeeves 0.6.0-9
- [234] updated core
- [234] chore: release @karmaniverous/jeeves-watcher-openclaw v0.16.0-4
## [0.16.0-3] - 2026-09-27

### 💼 Other

- [234] chore(deps): pin @karmaniverous/jeeves 0.6.0-8
- [234] updated core
- [234] chore: release @karmaniverous/jeeves-watcher-openclaw v0.16.0-3
## [0.16.0-2] - 2026-09-27

### 💼 Other

- [234] fix(deps): require watcher-core ^0.2.6-0 (no fallback to 0.2.5)
- [234] chore: release @karmaniverous/jeeves-watcher-openclaw v0.16.0-2
## [0.16.0-1] - 2026-09-27

### 💼 Other

- [234] style(openclaw): prettier-format openclaw.plugin.json
- [234] fix: post-e2e fixes for core 0.6 (#238, #239, #240, #241)

- deps: openclaw/service depend on watcher-core ^0.2.5 || ^0.2.6-0 so the core-0.6 prerelease resolves (#238)

- service: pin @qdrant/js-client-rest ^1.19.0; real-QdrantClient regression test for POST /search (#239)

- service: /config/apply merges into the running config file and deep-merges patches (#240)

- engines.node >=22.13 everywhere; docs say 22.13+ (#241)
- [234] chore(release): prettier-format openclaw.plugin.json after bump
- [234] chore(deps): pin @karmaniverous/jeeves 0.6.0-7
- [234] fix: tests and typecheck read watcher-core from source, not dist

Service and openclaw vitest configs alias @karmaniverous/jeeves-watcher-core
to packages/core/src, and their tsconfigs map it via paths, so typecheck
and tests pass on a clean checkout with no dist/. Rollup builds override
paths ({}) so bundling and typing still use the built core package with
no TS warnings. Root npm test now also runs the openclaw package tests.

Closes #242
- [234] chore: update root package-lock in release-it after:bump hooks
- [234] chore: release @karmaniverous/jeeves-watcher-openclaw v0.16.0-1
## [0.16.0-0] - 2026-09-27

### 💼 Other

- [234] feat(openclaw)!: standard OpenClaw plugin on jeeves core 0.6.0 with lazy configRoot

- move @karmaniverous/jeeves to 0.6.0-3 (static-content core, jeeves#109)
- remove ComponentWriter, createAsyncContentCache TOOLS.md menu, and the
  createPluginCli install/uninstall CLI (bin, rollup CLI entry, content copy)
- inject watcher escalation/scan-first/search-first rules via
  before_prompt_build (registerPromptContext); declare it in
  package.json jeeves.conversationHooks
- resolve configRoot lazily (pluginConfig -> plugins.entries -> JEEVES_CONFIG_ROOT);
  registration always succeeds, warns once when unset, defers core init()
  to first tool use; tools return a clear error until it is set
- remove the j:/config default (constants, helpers, manifest); declare
  configRoot in the manifest configSchema with no default

BREAKING CHANGE: the npx install/uninstall CLI is gone (use jeeves install or
openclaw plugins install); configRoot has no default and must be set in plugin
config or JEEVES_CONFIG_ROOT; the plugin no longer writes TOOLS.md.

Closes #234
Closes #235
Closes #227
- [234] chore(deps): ncu --peer across all packages (keep @karmaniverous/jeeves pinned)
- [234] chore: knip and prettier clean-up

- knip 6.38: remove unused barrel re-exports and a stale backward-compat re-export (no public API change)

- prettier 3.9 formatting; add .prettierignore for generated CHANGELOGs, config.schema.json and .stan state
- [234] fix(openclaw): gate only tools that read configRoot

Uniform Jeeves rule: only tools whose implementation reads configRoot return the configRoot-not-configured error. watcher_service (install resolves the config path via core getComponentConfigDir) stays gated; the 17 HTTP-only tools (3 core factory tools on defaultPort, 14 domain tools on apiUrl) are registered unwrapped and work without configRoot.
- [234] feat(openclaw): pass lazy apiUrl to createPluginToolset; pin core 0.6.0-4
- [234] fix(openclaw): gate watcher_service install only
- [234] chore(build): zero build and typedoc warnings

- service: drop tsconfig incremental (made the rollup configPlugin warn
  about outputToFilesystem); mark node: builtins external in the d.ts build.
- openclaw: drop only bundled-zod INVALID_ANNOTATION / node_modules-only
  CIRCULAR_DEPENDENCY rollup warnings.
- service: export SquashManagerOptions (typedoc referenced it).
- [234] docs(openclaw): update plugin architecture diagram
- [234] chore(deps): pin @karmaniverous/jeeves 0.6.0-6
- [234] fix(release): use --github.preRelease for release-it 21
- [234] chore: release @karmaniverous/jeeves-watcher-openclaw v0.16.0-0
## [0.15.6] - 2026-06-30

### 💼 Other

- Updated core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.15.6
## [0.15.5] - 2026-06-13

### 🚀 Features

- Add shared endpoint catalog in core package (#196)

### 💼 Other

- Updated core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.15.5
## [0.15.4] - 2026-06-13

### 💼 Other

- Updated core

### 📚 Documentation

- Update VCS and prune documentation for new features

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.15.4
## [0.15.3] - 2026-06-12

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-openclaw v0.15.3
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
