# Changelog

All notable changes to this project will be documented in this file.

## [0.22.0] - 2026-11-12

### 💼 Other

- [0-22] fix(service): read the stability clock before the stats (#306)

A stall between a stat and its continuation can now only delay a file settling, never settle it early.

Fixes #306
- [0-22] fix(service): index a moved file that had no points at its new path (#305)

A file never indexed, rejected or failed, moved alone or with its folder, used to log 'No points found for move' and stay unindexed. Its new path is now processed as a create, its enrichment moves with it, and the old path's issue is dropped.

Fixes #305
- [0-22] feat!: adopt Fastify's standard error body with WATCHER_* codes (#312)

Every watcher error is a jeeves defineError class answered by jeeves 0.11's catalog error handler: { statusCode, code, error, message }, fixed messages, no details. Unexpected failures are masked 500s. POST /vcs/exclude over the threshold without confirm is now 200 { confirmRequired, untracked }; prune without a vector store is 503. watcher-core drops API_ERROR_* for WATCHER_ERROR_CODES/STATUS; SDK WatcherError carries the body's code and message. Wire overlay wire-errors-0.22.0.json pins every error reply.

BREAKING CHANGE: error codes and bodies change; see guides/upgrading.md#0220.

Fixes #312
- [0-22] fix: address review of the 0.22.0 error contract (#312, #305, #306)

StabilityTicker measures a size changed during a stall from after the stat; a moved file with no points drops its issue and hash entry in one place; the plugin's exclude tool explains confirmRequired; tests pin every class message, a handler-result Retry-After, an empty JSON body, the render log without the error text, and every code-table outcome.
- Updated core
## [0.21.1] - 2026-11-07

### 🐛 Bug Fixes

- *(embedding)* Keep a search reserve in the item rate window so indexing cannot starve search (#309)
- *(embedding)* Default rateLimitPerMinute is 4000 items per minute (was 300) (#309)

### 💼 Other

- *(vcs)* Default commit message model claude-haiku-5-5; warn once on 404
- *(embedding)* Behaviour change: rateLimitPerMinute counts embedded items per minute; 429s wait out the quota minute
- Embedding rate limit counts items per minute; 429 pause rules and ceiling (#309)
- *(wire)* Approve the commitMessage.model default change as a config-schema departure (#308)
- *(embedding)* End the 429 retry loop inside the loop
- *(config)* The default rate limit leaves the search reserve free (#309)
- *(embedding)* The search-reserve test fails without the reserve; internal retries keep the reserve (#309)
- Updated core

### 📚 Documentation

- The embedding 429 backoff is capped at max(maxBackoffMs, 65 s); default rate limit slowdown note (#309)

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.21.1
## [0.21.0] - 2026-11-07

### 🚀 Features

- *(service)* Delete an indexed file's points when it fails extraction (D201)

### 🐛 Bug Fixes

- *(service)* Keep an indexed file's points on a system read error (D201 review)
- *(service)* Keep points on Node ERR_ errors; prove it through the real FileResolver (D201 review 2)
- *(service)* A file over 2 GiB is a content failure; Node-error wording in every guide (D201 review 3)

### 💼 Other

- Updated core

### 📚 Documentation

- RC guide fixes F1-F4, F6, F7 and an accurate over-cap log line (D201)

### 🧪 Testing

- *(service)* Judge the slow-copy test only on files whose premise held (D201)
- *(service)* Fix three desktop-load flakes and run git/Qdrant-bound tests in their own io project

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.21.0
## [0.21.0-0] - 2026-11-06

### 🚀 Features

- *(service)* Parse front matter with yaml (#203)
- *(core)* Schemas for the remaining catalog routes (A1)
- *(core)* Catalog entries for every route (A2)
- *(service)* Serve every route from the catalog (A3)
- *(vcs)* Staging, untracking, squash plumbing, git process layer (0.21.0 B2, B3)
- *(logging)* Rotate log files with pino-roll and log refusals durably (D171)
- *(vcs)* Bounded RootGitLock wait for API routes (D102)
- *(vcs)* VCS-only exclusion through .git/info/exclude (spec B4)
- *(sdk)* [**breaking**] SDK 0.3.0 on jeeves's catalog client (D36, D53, D60, D78)
- *(cli)* CLI on the SDK with a 60 s timeout; vcs and walk commands (#213); reindex --dry-run (#257)
- *(config)* Processing ceilings, embedding.alertUrl and the too_large issue type (B5a, B6; D44, D64)
- *(processor)* Per-document FIFO locks on a lock primitive shared with RootGitLock (B5a; D98, D118)
- *(processor)* Lock every document operation; API routes wait 10 s then 503 Retry-After: 10 (B5a; D98, D118)
- *(vectorStore)* File_path system index built in the background, by-filter payload writes and existing-ID reads; health.collection.systemIndexes (B5a; D74, D154)
- *(processor)* Metadata writes by filter on a ready keyword index, else by existing IDs (claim-state safe) (B5a; D139, D154)
- *(processor)* Stream embeddings one window at a time under a chunk-0 claim, finalised after orphan cleanup (B5a; D87, #255)
- *(processor)* Processing ceilings: stat before extraction, text bytes and chunk count; too_large deletes the document's points (B5a; D44, D64, D76)
- *(embedding)* Embedding health with transition alerts, 5-minute back-off cap, health.embedding and status degraded (B6; D86, D88, D89)
- *(service)* Chunk_index and matched_rules system indexes (D74, D155)
- *(service)* Facet reads on the vector store (exact counts, range bounds, index types)
- ListFacets rules scoping (A8, D117, D123)
- CountFacets (POST /search/facets/counts, A8)
- *(service)* CountFacets uses approximate facet counts (D194)
- *(service)* Inventory with child-set directory index in FileSystemWatcher (C1, D99, D127, D150)
- *(service)* Drop events under each root's .git (C1, D152)
- *(service)* Process-wide walk limiter and UV_THREADPOOL_SIZE 16 (D170)
- *(core,service)* Health.changeSource in D133's whole shape (B5b, D133, D157)
- *(service)* Shared stability ticker for synthetic events (B5b, D128, D142)
- *(service)* Reconciliation against the inventory (B5b, D90, D91, D179)
- *(core,service)* Periodic reconciliation, watch.reconcileIntervalMs (B5b, D111)
- *(service)* /walk served from the inventory (B5b, D83)
- *(service)* WatchConfigChanged compares usePolling, pollIntervalMs, stabilityThresholdMs (B5b, D100)
- *(service)* ParcelSource with per-root subscriptions and recovery (C2, D109, D131, D156, D179)
- *(service)* Parcel batch pipeline, walk-based initial set and directory pairing (C2, C3, D58, D62, D126, D127, D149, D150, D179)
- *(service)* Parcel load refusal at start and reload, changeSource rebuild key, Linux renewal health (C2, C3, D100, D125, D129, D156, D157, D165, D176, D177)
- *(service)* On Windows parcel never unsubscribes; rebuilds and subscription recoveries exit for a service-manager restart (D196)
- *(core)* Watch.indexCheckOnStart (default true) and the health.indexCheck schema (D197)
- *(service)* The watcher's view for the index check: unwatched and walk-failed roots, inventory membership (D197)
- *(service)* The index check at start: one chunk-0 listing, per-root cap, stat-confirmed deletes through the delete-event path (D197)
- *(service)* Run the index check once after the first initial scan and report health.indexCheck on /status (D197)
- *(service)* The index check's 10% cap applies only once more than 20 of a root's documents are missing; 1,000 unchanged (D198)

### 🐛 Bug Fixes

- *(vcs)* Print non-ASCII paths unescaped in every git call (#252)
- *(vcs)* A timed-out git read is not git saying no (untrack marker recovery, HEAD read)
- *(vcs)* Only a call that takes the index lock removes it after a timeout
- *(vcs)* One staging budget per batch across index.lock retries (D72)
- *(vcs)* A batch that throws keeps its files and the commit chain alive
- *(vcs)* Count paths in git error messages; warn when only the Windows launcher is available
- *(vcs)* Squash keeps non-UTF-8 commits byte for byte
- *(vcs)* Health.vcs.oldestTrippedAt is the first trip, not the last re-arm
- *(api)* Health.vcs is absent when no root has VCS enabled
- *(logger)* A log stream error goes to stderr instead of crashing; flush the log file on stop
- *(vcs)* A failed squash update-ref with the branch unchanged is an error, not 'the branch moved'
- *(vcs)* A batch that throws counts as a breaker failure and is retried at the next throttle
- *(vcs)* A squash whose update-ref fails after moving the branch to the new tip completes and pushes
- *(vcs)* Exclude drops trailing spaces and refuses whole-root globs before the root lookup
- *(openclaw)* Watcher_reindex keeps 0.17.0's default scope (rules)
- Independent review findings on the clients
- *(embedding)* A success clears only pauses requested before it started; a 429 still pauses every caller
- *(api)* Rebuild-metadata writes each entry under the file's document lock from chunk 0 re-read inside it; state stores built in app/stateStores
- *(embedding)* A success never lifts a stored pause; the capped back-off expires
- *(api)* Rebuild-metadata locks through the processor's own document locks (sourceOperations().withLock)
- *(service)* Resolve facet rule schemas per rule; cache key includes named schemas (review #1, #7, #9)
- *(service)* CountFacets budget covers the index-type read; nothing starts past the deadline; split handler tests (review #2, #5, #8, #1)
- *(service)* Re-review nits: accuracy TSDoc wrap and tail-error note, 503 names the budget in use, helper TSDoc
- *(core,service)* Regenerate openapi.json as written; plain docs for the sink methods
- *(service)* Keep each watch root's case
- *(service)* Review fixes for the change-source seam and reconciliation
- *(service)* Re-review fixes for the reconcile schedule, walk guard and root case
- *(service)* Drop a batch of absences when the root itself is gone (rm -rf of a root, D109); initialWalk test never walks a real /a
- *(service)* Review of D196: hard exit deadline, record kept until the start succeeds, later reindex merged, sticky restartsToRebuild after a release, config-watch scopes only; docs: deletes in the gap need prune
- *(service)* A restart during start keeps the deferred reindex; the exit deadline holds the process open (D196 re-review)
- *(service)* A batch that removes paths waits for its root to settle, so a root deleted with its contents unlinks nothing (D109; failing on Linux since 18a4a54)
- *(service)* Restore the root settle before removals (D109): rm -rf of a root reports a file's delete while the root still exists; the spec-correct D109 test shows the unlink on Linux
- *(service)* Index check re-reads the inventory after the stat, reports a rebuild as stale, names filtered files in the cap warning; tests for removed totals and running (review #301)
- *(service)* An index check a watcher rebuild interrupts runs again after the new initial scan; shutdown waits for it at most shutdownTimeoutMs (review #301)
- *(service)* The index check runs over the watcher that reported the scan; a timed-out stop keeps the stores open; stop re-checked after each stat (review #301)
- *(service)* The scan signal always carries the view; tests reach the stop guard; producer stop typed; runIndexCheck races in their own test file (review #301)

### 💼 Other

- [281] test: capture 0.20.0 wire and 0.17.0 plugin-surface baselines for the catalog slice (#281)

Wire scenarios for every slice route and outcome (status, config, config apply, render, search, scan, vcs/show) replayed through the real server against a recorded fixture, and the plugin's 18 tool definitions and prompt rules recorded from untouched code. Later steps list each accepted change explicitly.
- [281] chore(deps): pin @karmaniverous/jeeves 0.8.0-1 and add catalog plumbing (#281)

Exact 0.8.0-1 pin in core, service and plugin; fastify-type-provider-zod for the service's catalog routes; zod-openapi and openapi-types for core's OpenAPI writer. Rollup externals match jeeves and dependency sub-paths by prefix so no second copy of core is bundled. The plugin pin test accepts a prerelease. Core's generated status tool schema now closes additionalProperties (accepted baseline change).
- [281] feat: prompt rules and skill live in watcher-core (#281)

WATCHER_PROMPT_RULES (moved verbatim from the plugin) and WATCHER_SKILL (compiled from packages/core/skills/jeeves-watcher/SKILL.md by npm run skill, with a drift test) are exported from watcher-core and set on both descriptors. The plugin injects the descriptor's promptRules and its build writes the skill to dist/skills/jeeves-watcher, the folder its manifest lists. The injected rules stay byte-identical to 0.17.0.
- [281] feat: WATCHER_CATALOG in watcher-core (#281)

The slice catalog: core's standard status/config/configApply (status health typed by the new loose watcherHealthSchema, config routes bearer-authenticated), render, search, scan and the non-JSON vcsShow (vcsShowQuerySchema). Search and scan request fields carry descriptions for tools and OpenAPI. WATCHER_ENDPOINTS is unchanged and a test holds the catalog to it on method and path. Core's declaration build keeps jeeves sub-paths external too.
- [281] chore(deps): re-pin @karmaniverous/jeeves to 0.8.0-4 (#281)

G1/G2 already present at this pin (route logger option, Zod params on validation issues); this is the step 5 core loop-back re-pin.
- [281] feat: service catalog handlers for every slice entry (#281)

errorResult, wrapCatalogHandler/catalogErrorFromThrown, withCatalogCache (shared store, TTL and clearCache with withCache), notFoundBody, and catalog handlers for status, config, configApply, render, search, scan and vcsShow (createCatalogHandlers). Not wired into routes yet; the legacy routes still serve (route switch is step 7). Shared with the legacy handlers rather than duplicated: renderSourceDocument, SEARCH_EMBED_BUDGET/retryAfterSeconds, contentTypeFor, createCoreConfigQueryHandler, redactConfig.
- [281] feat: serve the slice routes from the catalog in 'log' mode (#281)

status, config, config apply, render, search, scan and vcs/show are now catalog routes, registered in a child plugin (createApiServer stays sync) with formatValidationError (400 invalid_request, first issue as error, issues as details), the watcher logger and responseValidation 'log'. A preValidation shim keeps POST /config/apply's deprecated { config } alias and empty body; with VCS off, GET /vcs/show still answers the unregistered-route 404 whatever its query. GET /openapi.json serves WATCHER_OPENAPI_DOCUMENT without auth. Wire baseline: only the nine request-validation 400 bodies change (wire-catalog-400.json). New tests: 400 per input slot, catalog auth per entry, serialised response equals handler result over every wire scenario, typed catalog client round trip over HTTP, zero 'log'-mode mismatches across the wire suite.
- [281] refactor: delete the legacy slice route handlers (#281)

The catalog now serves status, config, config apply, render, search, scan and vcs/show, so their Fastify factories are dead: handlers/render, renderSource, withCacheUnlessSource, search, scan, configQuery, configApply and vcs/vcsShow are deleted. What they still owned moves into the catalog modules (HybridSearchConfig, SEARCH_EMBED_BUDGET, retryAfterSeconds, the scan and config deps, the merged-document config query, redactConfig, the vcs/show content types; renderSourceDocument moves to api/catalog). Their unit tests are ported to the catalog handlers where they covered behaviour the catalog tests didn't (search plumbing and budget, scan cursor/defaults, config empty result and error propagation, config apply against a real file, render issueType tagging and public fields, render cache bypass for sources), the Qdrant search regression test now drives the catalog handler, and the slice rows of requestValidation/errorCodes move to catalogRoutes.test. New: a throwing catalog handler answers a logged, generic 500 (catalogErrors.test).
- [281] chore: pin @karmaniverous/jeeves 0.8.0-5 (#281)

0.8.0-5 adds #151 (runnable argument parser additions); nothing the watcher uses changes. One copy of jeeves and of zod; all gates pass.
- [281] feat: validate catalog responses in 'strict' mode (#281)

Before the switch, a probe on the catalog logger recorded zero 'log'-mode mismatches across the whole service suite (2053 tests, unit and Qdrant integration); a forced mismatch confirmed the probe records them. Every JSON entry's serialised body already equals its handler body (catalogRoutes.test). Now a response that doesn't match its entry's schema is never sent: the client gets 500 { error: 'Response validation failed' } and the issues are logged as an error. New responseValidation.test forces one through the real server (a string point count on /status) and fails if the mode goes back to 'log'. The wire suite now asserts no mismatch is logged in either mode.
- [281] docs: document the catalog slice (#281)

API reference: which routes are in WATCHER_CATALOG, the catalog's 400 details shape ({ slot, path, code, message, params }), response validation and its 500, the new GET /openapi.json (open, like /status), /config/apply's catalog schema with the deprecated config alias and the replace check, the /vcs/show 400 change, and the 401 wording of catalog-built tools. Root README: /openapi.json row, alias deprecated, plugin on jeeves 0.8 with catalog-built tools. watcher-core README: catalog, OpenAPI and agent-content exports. Plugin README and guide: which tools core builds from the catalog, the two error formats, generated parameter bounds, replace on config_apply, vcs_show returning text. Skill: tool errors, API key, and a troubleshooting entry for a catalog tool's 401 and the response-validation 500 (D31); WATCHER_SKILL regenerated. npm run docs has zero warnings.
- [281] refactor: one withErrorCode for core handler error results (#281)

configHandler and configApplyHandler each added a code to a core 4xx body that lacked one. Both now call withErrorCode (catalog/errorResult.ts), unit-tested for every branch: 2xx unchanged, a body with a code unchanged, a body without one gets codeForStatus first, a non-object body gets just the code. Behaviour preserved: src/api 653/653 before the new tests. Mutants (drop the code check, drop the 2xx check) both fail the tests.
- [281] test: cover a missing file named only in the error message; give the serialisation test room (#281)

renderHandler.test covers isMissingFile's message fallback (an error whose cause says 'no such file', with no errno code); dropping that check fails it. catalogRoutes.test's serialised-equals-handler test replays every wire scenario in one test and timed out at the default 5 s on a loaded host; it now has 30 s.
- [281] chore: update dependencies (patch and minor) (#281)

npm-check-updates --peer --target minor in the root and all four packages, then npm audit fix (non-breaking): audit 17 -> 14. One zod (4.6.7). All gates pass. Left for the owner (major): chokidar 6, unpdf 2, typescript 7 (blocked by typescript-eslint's peer range), mdast-util-from-adf 2.2 and release-it 19 (the remaining audit highs).
- [281] fix: answer HEAD /vcs/show with the not-found 404 when VCS is off (#281)

Independent review finding 1 (D28). The VCS-off preValidation hook matched GET only, so the HEAD route Fastify derives from it fell through to query validation: HEAD /vcs/show without a query was 400 instead of 404. The hook now matches GET and HEAD. vcsShowWithoutVcs.test covers GET and HEAD with and without a query; it failed before the fix (HEAD without a query: 400) and passes with it.
- [281] refactor: delete sendResult and build every generic 500 once (#281)

Independent review findings 3 and 4. sendResult had no callers left (its job is withErrorCode's) and is deleted with its tests. errorResult now leaves out undefined extras (renderSourceDocument's issueType: undefined no longer reaches the body). The generic 500 internal_error body was built three times in the catalog handlers (configApply, search, wrapCatalogHandler); internalErrorResult() builds it once. src/api 662/662.
- [281] refactor: review nits on the catalog handlers (#281)

Independent review findings 11, 13, 14 and 15. registerVcsRoutes' module doc had a BEL control character for a backtick. withCache: CacheEntry is module-private and the 'cache' alias of sharedResponseCache is gone. renderHandler returns errorResult directly instead of building a RequestError to convert back. withCatalogCache recognises Cache-Control: no-cache under any header-name case (new test; it fails with the old exact-case check). src/api 663/663.
- [281] refactor: take the tracker status types from watcher-core (#281)

Independent review finding 5. ReindexStatus and InitialScanStatus were hand-written copies of watcher-core's reindexStatusSchema/initialScanStatusSchema types, kept equal only by a type test. The trackers now re-export the core types; healthTypes.test keeps the run-time half (real tracker output parses unchanged).
- [281] refactor: source renders run live through no-cache alone (#281)

Independent review finding 6. render's source target replies Cache-Control: no-cache on every path, so it is never written to the cache, and the shouldBypass predicate was redundant. It is removed from withCatalogCache, with its test. The index test now renders a source successfully (200) twice and expects two live renders; dropping no-cache from the source success fails it.
- [281] test: assert status sends no key (#281)

Independent review finding 7. The spec's 'status sends none' was never asserted. catalogRoutes.test now records the Authorization header of each request a keyed catalog client makes: none for status, the bearer for config. auth.test checks watcher_status sends no header even with a key configured.
- [281] feat: name the missing /vcs/show query parameter (#281)

Independent review finding 12. vcsShowQuerySchema had no messages of its own, so a missing parameter read 'Invalid input: expected string, received undefined'. Like the admin schemas, it now says 'Missing required query parameter: path' (or commit), for a missing or an empty value. New catalog.test case; the recorded catalog 400 bodies for the two vcsShow scenarios are updated to match. OpenAPI document unchanged.
- [281] test: lock malformed JSON and 415 on catalog routes to the legacy handler (#281)

Independent review finding 16. Catalog routes now pass through core's scope error handler, so the spec's 'malformed JSON and 415 keep the existing error handler' needed a test. catalogBodyErrors.test sends malformed JSON to /search, /scan, /render and /config/apply, and an unsupported content type to /search and /config/apply, and expects exactly what POST /walk (outside the catalog) answers: 400 or 415 invalid_request.
- [281] docs: review fixes for auth exemptions, error formats and key order (#281)

Independent review findings 9 and 10. The API reference summary and the skill now say GET /openapi.json needs no key, and the skill's endpoint table lists it. The error-format line covers the catalog-built tools' HTTP <status>: <body>. Catalog error bodies list error before code, so the config-apply 400 examples in the skill and the plugin guide now match the real text. WATCHER_SKILL regenerated.
- [281] chore: point service and plugin at watcher-core 0.5.0-0 (#281)

The service imports WATCHER_CATALOG from watcher-core at run time, and ^0.4.0 resolved to the registry 0.4.0 published before the slice, so a packed service failed to load. Service and plugin now take ^0.5.0-0 (the owner's prerelease from this branch); in the workspace both link to packages/core. The SDK keeps ^0.4.0 (unchanged in the slice, D30). All gates pass.
- [281] chore: pin jeeves 0.8.0-6; drop fastify-type-provider-zod, zod-openapi, openapi-types

jeeves 0.8.0-6 makes fastify, fastify-type-provider-zod and zod-openapi its own dependencies (jeeves Decision 88), so the service and core no longer supply them.
- [281] chore: pin jeeves 0.8.0
- [281] chore: patch/minor deps, prettier-ignore generated baselines, squash test timeout
- [281] refactor: wrap the search call in withFilterErrors once (#281)
- [281] test: lock catalog error key order and kill the surviving mutants (#281)

Independent review: a raw-text test holds 'error before code' on catalog error bodies (config apply, render), as the docs quote it. errorResult's undefined-extras test now checks keys (toEqual ignored them); the search 500 test compares with internalErrorResult(); withCatalogCache caches a max-age response. Mutants M3, M6, M16 now killed. New InitialScanTracker lifecycle test and withCache hashObject/error-reply tests bring both touched files to full branch coverage.
- [281] docs: review fixes for the skill, API reference and plugin README (#281)

SKILL.md: watcher_scan cursor is a string or a number (D34); WATCHER_SKILL regenerated. API reference: the /vcs/show 400 error text. Plugin README: one list. registerCatalog TSDoc: one preValidation hook, HEAD included. vcsShowHandler: say why its VCS-off guard stays.
- [281] test: drop an unneeded cast in the error-reply cache test (#281)
- [281] test: the client round trip decodes exactly what the handler returned (#281)

Finishing pass (weak-test list): 'searches, scans and renders' asserted only an array, a cursor and a content property; it now compares each client result with the handler's recorded body.
- [281] test,docs: second-review nits on the fix commits (#281)

Fresh review of faf2fe9..e0cfae6: test names now say what they prove (hashObject, InitialScanTracker without start); errorResult keys compared in any order (M3 still KILLED); skill scan response cursor is a string, number or null (WATCHER_SKILL regenerated); catalogTools module TSDoc lists the four standard tools and registerCatalogTool.
- [281] test: catalog registration errors surface from ready() (D29) (#281)
- [281] test: lint fix for the D29 registration test (#281)
- Release guard for dependents' core range (#277)
- Pin @karmaniverous/jeeves 0.9.0-0 (D42)
- Patch and minor dependency updates
- *(deps)* Chokidar 6 with the backend pinned to 0.20.0's behaviour; service needs Node 22.22
- *(deps)* Unpdf 2
- Require Node >=24.22.2 (D188)
- Updated core
- Merge remote-tracking branch 'origin/main' into feature/p9-processing-at-scale
- *(service)* Pin @parcel/watcher 2.6.0 with its loader, selection and CI binary check (C2, D125)
- Revert "fix(service): a batch that removes paths waits for its root to settle, so a root deleted with its contents unlinks nothing (D109; failing on Linux since 18a4a54)"

This reverts commit b96160f02f7b950f3e57d5bc8d436dde0fd54d37.
- *(service)* The D72 staging-timeout test stages data git cannot finish within 1 ms, asserts no commit and commits the re-queued batch (flaky on Linux CI at 56f93de, 75c0df9)
- *(deps)* Fastify ^5 in the service (R3, D42); undici ^7.30.2 under @qdrant/js-client-rest (npm audit)
- Updated core

### 🚜 Refactor

- *(service)* DRY and file-size pass over the catalog completion
- *(service)* Metadata handler returns core's MetadataResponse
- *(vcs)* One HEAD-ref reader, runGit for the git check, drop duplicate buffer caps, initInfrastructure out of app (P5 SOLID/DRY)
- *(vcs)* Remove hasDirtyTrackedFiles and indexLockExists, unused since squash dropped its preconditions; test headRef
- *(vcs)* SquashHooks are internal, not public API
- *(vcs)* Exclude-file module and untrack beforeWrite hook
- *(vcs)* Exclude nits (threshold constant, remove text, commit message template, VcsManager doc)
- [**breaking**] Verb-first operation names (D77); retire WATCHER_ENDPOINTS (D41)
- *(util)* PostWithRetry with a 10 s timeout per attempt, shared by the reindex callback (B6; D138, D180)
- *(service)* Facet reads as VectorStoreClient.facets (QdrantFacetStore; index.ts under 300 lines)
- *(service)* One rule-scope selection for both facet routes (selectSchemas)
- *(service)* ChangeSource seam with chokidar behind it (C1, D120)
- *(service)* One keyWithin for every at-or-under key check
- *(service)* Pipeline builder, subscription context and one config-reindex runner; split the D196 reload tests (files under 300 lines)
- *(service)* Stop relies on release dropping the Windows handle (D196)
- *(service)* Share the scroll page retry (prune) as vectorStore/scrollRetry for the index check (D197)
- *(service)* SystemHealth.run and applyClassified keep FileSystemWatcher under 300 lines

### 📚 Documentation

- Core README describes the full catalog; walk no longer 500s without a body
- Every error body lists error before code, including the gated 404
- Log rotation in deployment, logging file naming and pruning, size cap per root and GitHub limits, squash encoding note, upgrade notes for 0.21.0 so far
- *(logging)* MaxFiles keeps that many rotated files plus the active one (D184); cite D182/D183 in the API reference
- P5 upgrade and rollback notes per Design 11; vcs.branch rows; 10 MiB
- Cite D185 for the watch.paths[].vcs.maxFileBytes config-schema departure
- Upgrading notes for unpdf 2 (Node 22 EBADENGINE warning) and chokidar held at 5
- *(vcs)* RootBreaker doc comments on the right methods
- VCS-only exclusion (API reference, version-control and upgrading guides, READMEs, plugin tool descriptions)
- Rollback step for .git/info/exclude, absolute vs root-relative globs, core skill
- *(vcs)* Leading-slash glob with root in the upgrade guide, tool and skill text; stronger remove test
- Clients on the catalog (SDK guide, CLI reference, plugin guide, upgrading)
- Processing ceilings, document locks, streamed write, system indexes and embedding health (B5a, B6)
- Fix health doc-comment order and decision citations (D86, D87, D88)
- Custom factories need the new VectorStore members and withLock; back-off clearing
- Facets (countFacets, listFacets rules, chunk_index and matched_rules system indexes)
- *(service)* Exact single-value counts need chunk_index = 0; accuracy threshold wording (review #3, #6)
- *(service)* Export the types public signatures reference (typedoc 0 warnings)
- Change source, inventory and reconciliation (P11: C1, B5b)
- Parcel change source, directory pairing, switching and native binary (C2, C3)
- Windows restart-on-exit requirement under parcel, restart record and health fields (D196)
- The index check at start (D197): configuration, architecture, API reference, upgrading, deployment, skill
- One 0.20.0 -> 0.21.0 upgrade guide with the full rollback (D95, D171, D173, D180), skill troubleshooting, deployment (inotify limits, NSSM restart on exit, long paths reconcile-only per D199); anchors fixed and docs build at zero warnings (R2)
- *(upgrading)* Rollback commands run as written: PowerShell 5.1-safe over-cap listing with UTF-8 git output, .gitignore ends with a newline before patterns move in, Set-Location $root; D198 floor in First start; wider !!float finder (review 5796658844)
- *(upgrading)* Rollback PowerShell takes the root literally and stops on a wrong one (brackets, fresh window), step 3 without Set-Location; !!float finder allows tabs and CRLF (review 5796908702)
- *(upgrading)* Rollback PowerShell clears $root before resolving it, so a mistyped root never falls back to the last one; test comment says which walk came after the changes (review 5797110354)

### 🧪 Testing

- *(service)* Stabilise integration setup on Windows CI
- *(service)* 0.20.0 wire baseline for the remaining 22 routes (A1, Design 2)
- *(service)* Cover the catalog handlers' remaining branches
- *(service)* Unknown-key wire scenarios for vcs/diff and vcs/check-exclusion
- *(vcs)* Assert a timed-out git call is killed, not left to finish; skill: health.vcs
- *(wire,logger)* Config-schema departure is watch.paths[].vcs.maxFileBytes only; maxFiles bound both ways, pino-roll count explained
- *(vcs,logger)* Cover health.vcs trips, squash git failure and commit log, raw commit parsing, marker discard without an exclude file, default log level
- *(vcs)* Branch-state warning on the configured branch with a leftover orphan branch, and on another branch
- *(vcs)* GitAdd reads glob characters literally
- *(api)* Coordinator fakes provide getRoots (vcsHealthSource)
- *(vcs)* Give the real cherry-pick conflict test 30 s (timed out on the Windows CI runner)
- *(vcs)* Commit and the untrack write-tree name their index lock
- *(vcs)* Exclude untracks exactly 100 files without confirm
- *(vcs)* 20 s timeout for the real-git exclude suites (loaded hosts)
- *(reindex)* Count the chunk-0 finalise of a re-embedded source document
- *(rules)* A document-lock timeout in rule reapply is rethrown after earlier files are updated
- Cover startup wiring and indexFile; build the embedding alert in initInfrastructure
- *(processor)* Each processing ceiling is read per document (reload applies)
- *(locks)* Hold the first run in embedding so the overlap test fails without document locks
- *(api)* Unit tests for deleteSourceDocuments
- *(metadata)* Harness-in-test integration cases get the 30 s hook budget
- *(service)* Integration expectations include the chunk_index and matched_rules system indexes
- *(service)* CountFacets dependencies in the registerCatalog error tests
- *(service)* Rule schemas without inferenceRules; range bound of a point without payload
- *(service)* CountFacets counts 4 fields at a time; bounded runs never time a task under 1 s
- *(service)* FileSystemWatcher with the real chokidar source on a temp directory
- *(service)* Cover the change-source seam, queue actions, walk and reconcile edges
- *(service)* Pin the walk limit at 8, a directory kept by its child, and pendingStability
- *(service)* Build integration collections in hooks and wait for their index builds
- *(service)* Parcel recovery on the real filesystem; paired-move handlers (D62, D109, D126, D129, D131, D176)
- *(service)* Give the wire baseline scenarios 15 s (the prune dry run walks the package's files and passed 5 s under full-suite load)
- *(service)* Fast wire prune scenario and a serial heavy project, instead of a timeout raise
- *(service)* Subscription error reading (codeOf, isWatchLimitError)
- *(service)* D109 recovery test follows the spec: nothing unlinked while the root is gone, reconciliation unlinks only what really went when it is back
- *(service)* P13 verification leftovers: slow 1,000-file copy under parcel and chokidar (D128), VCS with parcel on Linux and the 20,000-file commit (D129, D146, D152), Windows long paths reconcile-only (D153, D199)
- *(service)* The new watcher tests sleep through node:timers/promises (DRY)
- *(service)* The D128 slow copy writes from a child process, 10 files at a time, and checks its gaps stayed under the window (chokidar emitted early when stats queued on the thread pool)
- *(service)* The D129/D146 test initialises its repo before VcsManager starts (Linux CI: not in a git directory)
- *(service)* Slow copy reads each file as its job is enqueued and expects one read of the final content; D129/D146 commits only at flushes and waits for a renew-and-reconcile after the changes (review 5796658844)
- *(service)* D129/D146 waits for a reconcile that started after the changes (review 5796908702)
- *(service)* The 20,000-file commit test gets 600 s (240-260 s on green Windows CI, over 300 s once)
- *(service)* Wire replay resets git only when the repo changed, one test per scenario, and handler records scoped per test (no leakage after a timeout)

### ⚙️ Miscellaneous Tasks

- *(schema)* Regenerate config.schema.json for the D184 maxFiles description
- *(service)* Regenerate config.schema.json (processing, embedding.alertUrl)
- *(service)* Facet latency gate script (D104, D155)
- *(service)* Facet gate measures approximate against exact counts (D194)
- *(service)* Facet gate records host CPU and can wait for a quiet host
- *(service)* Drop unused facet type re-exports (knip)
- *(service)* Index-check:cost measures the index check on a throwaway copy of a live collection (D197)
- *(service)* Index-check:cost census in its own module, under 300 lines (review #301)
- Release @karmaniverous/jeeves-watcher v0.21.0-0

### ◀️ Revert

- Hold chokidar at major 5 (owner ruling D186)
## [0.20.0] - 2026-10-14

### 🚀 Features

- *(core)* Config schema for payload indexes, API key and sources
- *(core)* Request/response schemas for public API endpoints
- *(service)* Record processing failures as typed issues
- *(service)* Shared embedding rate limiter with Retry-After
- *(service)* API bearer auth, configured payload indexes, integration harness
- *(service)* Source callback client
- *(service)* Notification queue for source documents
- *(service)* POST /documents, POST /documents/delete, source references on render/metadata/reindex
- *(service)* Reindex scopes cover source documents
- *(sdk)* @karmaniverous/jeeves-watcher-sdk 0.1.0
- CLI and OpenClaw plugin send the API bearer key
- Machine-readable error codes on API error responses

### 🐛 Bug Fixes

- Harden delete filters, issue records and config schemas
- *(service)* Bound embedding retries, payload index flags and callback size
- *(service)* Harden source processing, reindex routing and shutdown
- *(cli)* Report unreadable or malformed config patches cleanly
- *(service)* Client-input errors are 4xx; reindex prepares once
- One source-point predicate, redacted config apply, never-throwing reindex callback, separator-aware path scopes
- *(service)* A failed Qdrant read is an error, never "not indexed"
- *(service)* Issues reindex tolerates a failed stored-rule lookup
- *(service)* Gemini requests the configured dimensions; init template uses 3072
- *(service)* GET /config/schema derives from the core config schema
- *(service)* Reindex plans group files by each watch root's static glob prefix
- *(service)* Enrich --json accepts only a JSON object
- *(service)* An over-limit Retry-After fails every caller fast until it has fully passed
- *(release)* GitHub release notes and changelog use the new version tag

### 💼 Other

- [256] fix(service): resolve file-based schemas against config dir in /config/validate

validateInferenceRuleSchemas now receives deps.configDir and passes it to mergeSchemas, so relative global schema paths resolve against the config file's directory instead of process.cwd(). Adds regression tests for the resolved and missing-file cases.

Closes #256. Part of #273 (S1). ([#274](https://github.com/karmaniverous/jeeves-watcher/pull/274))
- Updated core

### 🚜 Refactor

- *(service)* Resolver layer for file and source documents; prune guard
- *(service)* Split executeReindex by scope
- One HTTP client contract in core; error status comes from the code
- Shared reindex deps, defaults and work policy; admin route schemas; route handlers wrapped
- Core owns defaults, limits and index-type guards; uniform route registrars
- *(service)* One metadata write path, shared rule options, core defaults, one failure recorder
- *(service)* Per-kind document behaviour, one hash, options object for embed-and-upsert
- *(service)* Retried Qdrant writes, queue idle signals, one source-operations path for the notify queue
- *(service)* Split app wiring below 300 lines; config warnings emitted once by loadConfig
- *(service)* Source rules without file access, one render result, test-support wiring from production
- *(service)* One render-result builder, no file reader for source rules, shared test Qdrant helpers
- *(service)* One WatcherProcessor type, adapter for file-only processors, no source guards in the API

### 📚 Documentation

- Source documents, notify API, auth, payload indexes, SDK
- Typedoc covers core, sdk and service; fix docs warnings
- Document review fixes, error bodies and status shape
- *(service)* Verification citations for the review-2 test changes
- *(service)* Configuration reference matches the config schema and runtime
- *(service)* API reference matches the handlers
- *(service)* Architecture and deployment guides match the code
- *(service)* Inference rules, getting started and CLI reference match the code
- *(service)* Source documents and version control guides match the code
- Root README, CONTRIBUTING and package READMEs match the code
- *(core)* StateDir description names values.v8
- *(service)* VERIFICATION shutdown order and stray punctuation
- Neutral example paths and names in guides, skill and tests
- *(service)* Prettier formatting in api-reference

### 🧪 Testing

- Harden integration harness collection hygiene
- Integration lifecycle for source documents
- Neutral example names; remove client wording from tests and docs
- Provision a throwaway Qdrant for local test runs
- Build the PDF extractor fixture with correct xref offsets
- Route-wide auth, shared limiter, reload and deletion proofs
- Harden throwaway Qdrant provisioning and harness guards
- Split oversized suites and add module docs
- VERIFICATION.md covers Decision 18 and the review fixes
- Prove ingest embedding exhaustion, rate-limit defaults, notify concurrency and CLI key source
- Rule handlers, plugin config tools, CLI helpers and edges
- Reindex guards, prune retries, callback errors, source scopes, config-apply trigger, vcs edges
- *(service)* Cover enrichment merge, prepare, rule errors, render stage, maps, failed deletes, file render fallbacks
- *(service)* Cover limiter back-off cap, attempt override and config wiring, payload deletes, shutdown timeouts, queue stop
- *(service)* Cover test Qdrant provisioning: global setup, binary download, binary and Docker start failures, sweep and URL guard
- *(service)* Strengthen processor, source client, embedding, vector store and config tests
- *(service)* Pin startup warnings to the console, reload reindex deps, stop order, PDF warning and load-time warning suppression
- *(service)* Count embeddings, assert issues and AJV details, isolate integration cases, synchronous notify burst
- *(service)* Keep documents-integration within 300 lines
- *(service)* Split the rules engine suite into matching, set and JsonMap suites

### ⚙️ Miscellaneous Tasks

- Ship LICENSE in every package; core README and license metadata
- Service resolves the SDK from the workspace, not as a dependency
- Tsdoc config for core; real-git reconciliation tests get the suite's 30 s budget
- Release @karmaniverous/jeeves-watcher v0.20.0
## [0.19.1] - 2026-09-30

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
- [249] refactor(vcs): address #251 review, SOLID/DRY pass and test hardening

Review fixes:
- Treat only ENOENT/ENOTDIR as "missing" when partitioning a batch;
  other stat errors propagate so the batch is retained and retried.
- Re-queue a failed batch in full (no cap); flush commits the backlog
  in maxBatchSize chunks, so no chunk exceeds the batch size.
- breaker.pendingCount includes files taken for an in-flight commit.
- isIndexLockError requires "index.lock"; a bare EEXIST is not retried.
- Narrow unknown rejection values via getErrorCode before reading code.

Structure:
- Extract CommitCircuitBreaker (pure, injectable clock), batchStaging
  (classify + stage), gitIndex (index ops), gitRepoState (stale ops,
  dirty tree, index.lock), watchScope (glob + ignored scope), cronMatch,
  and runGit (single pinned-argv git runner used by VcsManager,
  SquashManager, vcsBootstrap, CommitMessageBuilder and VCS handlers).
- Fix /vcs/status lastCommit when the subject contains "|".

Tests:
- Split resilience tests into VcsManager.staging / VcsManager.breaker,
  squash guards into SquashManager.guards, coordinator reconciliation
  into its own file; shared fixtures in test/vcsRepo and test/squashRepo.
- Replace the mocked cherry-pick failure (and its type cast) with a real
  merge-commit failure; drop the trivial 52s re-queue-cap test.
- New unit tests: CommitCircuitBreaker, batchStaging, gitIndex,
  gitRepoState, retry, watchScope, cronMatch, SquashManager scheduler,
  vcsStatus.
- [249] test(vcs): split oversized VcsManager, SquashManager and VCS handler test files

Pure moves along existing describe boundaries; all 80 test names preserved.

- VcsManager.test.ts (1275) -> VcsManager.{commitBasics, lifecycle,
  lockHandling, circuitBreaker, messages, aiMessages, remotePush}.test.ts
- SquashManager.test.ts (460) -> SquashManager.{retention, mechanism,
  pushAndPause}.test.ts
- api/handlers/vcs/vcs.test.ts (793) -> vcs{Status, History, Show, Diff,
  CheckExclusion, Revert, Exclude}.handler.test.ts
- Shared fixtures: test/vcsHandlers.ts (mock reply, repo + coordinator
  setup); test/vcsRepo.ts gains makeFastVcsConfig.
- Drop a gitIndex timeout test that raced a 1 ms timer against git and
  flaked under parallel load.
- [249] test(vcs): make pathKey test independent of host OS

resolve() follows the host platform, so a Windows drive path is relative on Linux. Test lowercasing with a path absolute on both; run the backslash case on Windows only.
- Updated core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.19.1
## [0.19.0] - 2026-09-29

### 💼 Other

- [234] updated jeeves
- Updated core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.19.0
## [0.19.0-3] - 2026-09-28

### 💼 Other

- [234] chore(deps): pin @karmaniverous/jeeves 0.6.0-9
- [234] updated core
- [234] chore: release @karmaniverous/jeeves-watcher v0.19.0-3
## [0.19.0-2] - 2026-09-27

### 💼 Other

- [234] [244] fix(service): make git network calls non-interactive

Route push and squash force push through execGitNetwork: -c credential.helper= plus GIT_TERMINAL_PROMPT=0, GCM_INTERACTIVE=never, GIT_ASKPASS/SSH_ASKPASS=echo, so system/global credential helpers (Git Credential Manager) can never block. Tests use loopback 127.0.0.1:9 instead of github.com / invalid.example.com.
- [234] [244] fix(service): clear credential helpers only for injected tokens; drop-at-once test remote

Adopt findings from the parked w243 attempt: always -c core.askPass= with empty GIT_ASKPASS/SSH_ASKPASS, GIT_TERMINAL_PROMPT=0, GCM_INTERACTIVE=never; reset credential.helper only when a token is injected so stored credentials still work. gitPushNonInteractive centralises push URL + policy (SquashManager 471 -> 468 lines). Tests use a local TCP server that drops connections (~ms) instead of 127.0.0.1:9 (~2 s on Windows).
- [234] [245] fix(service): keep the access token off the git command line and out of errors

Send the token to git as a URL-scoped http.<remote>.extraHeader (Basic x-access-token) via GIT_CONFIG_COUNT/KEY/VALUE env for that push only, instead of embedding it in the push URL (which Node echoes in exec error messages/cmd, reaching logs and pushErrors / GET /vcs/status). Credential helpers are still cleared when a token is used (#244). Defence in depth: sanitizeGitError redacts raw, URL-encoded and base64 forms from message, stack, cmd, stderr and stdout. Remove buildAuthenticatedPushUrl.

Closes #245
- [234] chore(deps): pin @karmaniverous/jeeves 0.6.0-8
- [234] updated core
- [234] test(vcs): make git tests hermetic (ignore system credential helpers)
- [234] Merge branch 'feature/234-core-060-lazy-config-root' of https://github.com/karmaniverous/jeeves-watcher into feature/234-core-060-lazy-config-root
- [234] chore: release @karmaniverous/jeeves-watcher v0.19.0-2
## [0.19.0-1] - 2026-09-27

### 💼 Other

- [234] fix: tests and typecheck read watcher-core from source, not dist

Service and openclaw vitest configs alias @karmaniverous/jeeves-watcher-core
to packages/core/src, and their tsconfigs map it via paths, so typecheck
and tests pass on a clean checkout with no dist/. Rollup builds override
paths ({}) so bundling and typing still use the built core package with
no TS warnings. Root npm test now also runs the openclaw package tests.

Closes #242
- [234] chore: update root package-lock in release-it after:bump hooks
- [234] fix(deps): require watcher-core ^0.2.6-0 (no fallback to 0.2.5)
- [234] [243] test(service): warm Fastify cold start in hooks, close apps

The first onRulesChanged test paid Fastify's lazy require of ~250 CJS
modules (ajv-compiler/ajv/fast-json-stringify), light-my-request's lazy
load on first inject(), and the first ajv rule compile inside its 5s test
budget, which timed out on a slower Windows machine during release:pre.

Warm the full register path in beforeAll, close every app in afterEach,
and drop the unneeded 50ms settle sleeps (executeReindex is invoked
synchronously by the handler). Apply the same warm-up and server close to
integration.test.ts.

Closes #243
- [234] chore: release @karmaniverous/jeeves-watcher v0.19.0-1
## [0.19.0-0] - 2026-09-27

### 💼 Other

- [234] chore(deps): ncu --peer across all packages (keep @karmaniverous/jeeves pinned)
- [234] chore(deps): audit fix, transitive overrides, hold extra-typings@14, drop @types/js-yaml

- npm audit fix, then overrides for type-only transitive chain of mdast-util-from-adf (linkify-it ^5.0.2, uuid ^14.0.2); lockfile regenerated so overrides apply

- @commander-js/extra-typings held at ^14: peer-coupled to commander 14 used by @karmaniverous/jeeves 0.5.x (held via --reject)

- @types/js-yaml removed: js-yaml 5 ships its own types
- [234] fix: migrate vector search to Qdrant query API; drop meaningless void operators

- @qdrant/js-client-rest 1.19 removed QdrantClient.search; use client.query (same params, results in .points)

- typescript-eslint 8.70 no-meaningless-void-operator: remove unused params instead of voiding them
- [234] chore: knip and prettier clean-up

- knip 6.38: remove unused barrel re-exports and a stale backward-compat re-export (no public API change)

- prettier 3.9 formatting; add .prettierignore for generated CHANGELOGs, config.schema.json and .stan state
- [234] feat!: move core and service to @karmaniverous/jeeves 0.6.0-4

Drop the v0.x workspace-writer descriptor fields (sectionId,
refreshIntervalSeconds, generateToolsContent) removed in core 0.6.
- [234] chore(service): update @commander-js/extra-typings to 15

Unblocked by core 0.6.0-4 (commander 15).
- [234] chore(build): zero build and typedoc warnings

- service: drop tsconfig incremental (made the rollup configPlugin warn
  about outputToFilesystem); mark node: builtins external in the d.ts build.
- openclaw: drop only bundled-zod INVALID_ANNOTATION / node_modules-only
  CIRCULAR_DEPENDENCY rollup warnings.
- service: export SquashManagerOptions (typedoc referenced it).
- [234] chore(deps): pin @karmaniverous/jeeves 0.6.0-6
- [234] fix(release): use --github.preRelease for release-it 21
- [234] refactor(service): migrate EnrichmentStore to node:sqlite

Replace better-sqlite3 with the built-in node:sqlite DatabaseSync. Behaviour and EnrichmentStoreInterface are unchanged (WAL, busy_timeout 5000, startup wal_checkpoint(TRUNCATE) busy warning, schema, path normalisation, merge-on-set, atomic move). Adds a fixture written by the better-sqlite3 13.0.3 build and a test proving it opens, reads and updates correctly. Externalise node: built-ins in the service rollup library/CLI builds (matches jeeves-runner) so node:sqlite does not warn as unresolved. Refs #237.
- [234] chore(deps): remove better-sqlite3

Drop better-sqlite3 and @types/better-sqlite3 from packages/service and the better-sqlite3 entry from root allowScripts. Docs: note node:sqlite (no native build) and align stale Node 20+ prerequisites with engines >=22. Closes #237.
- [234] fix: post-e2e fixes for core 0.6 (#238, #239, #240, #241)

- deps: openclaw/service depend on watcher-core ^0.2.5 || ^0.2.6-0 so the core-0.6 prerelease resolves (#238)

- service: pin @qdrant/js-client-rest ^1.19.0; real-QdrantClient regression test for POST /search (#239)

- service: /config/apply merges into the running config file and deep-merges patches (#240)

- engines.node >=22.13 everywhere; docs say 22.13+ (#241)
- [234] chore(deps): pin @karmaniverous/jeeves 0.6.0-7
- [234] chore: release @karmaniverous/jeeves-watcher v0.19.0-0
## [0.18.12] - 2026-09-22

### 🐛 Bug Fixes

- Use named imports for js-yaml (closes #232)

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.18.12
## [0.18.11] - 2026-06-30

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

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher v0.18.11
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
