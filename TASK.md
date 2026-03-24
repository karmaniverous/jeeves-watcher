## Next Version: 0.15.0 / 0.11.1 — Hot Reload & Bugfixes

### EnrichmentStore not closed on shutdown ([#145](https://github.com/karmaniverous/jeeves-watcher/issues/145))

`EnrichmentStore.close()` exists but is never called in `JeevesWatcher.stop()`. SQLite connection leaks on graceful shutdown. One-line fix: add `this.enrichmentStore?.close()` after queue drain.

### Config hot-reload doesn't update merged document ([#144](https://github.com/karmaniverous/jeeves-watcher/issues/144))

`reloadConfig()` updates `this.config` and calls `processor.updateRules()`, but API handlers created during `startApiServer()` captured the old config object reference via closure. The merged document handler (`GET /config`) and other config-dependent handlers (validate, match, facets) show stale data after hot-reload. Processing pipeline works correctly; the introspection API doesn't.

**Root cause:** `createApiServer()` destructures `options.config` into handler deps as a plain object property. When `reloadConfig()` assigns `this.config = newConfig`, the handlers still hold the old reference.

**Fix:** Pass a config getter (`getConfig: () => JeevesWatcherConfig`) instead of `config` directly to handler factories. Handlers call `getConfig()` at request time to get the current config. Affects: `createConfigQueryHandler`, `createConfigValidateHandler`, `createConfigMatchHandler`, `createFacetsHandler`, `createConfigApplyHandler`, `createMetadataHandler`, `createConfigReindexHandler`.

### Hot-reload config changes without service restart ([#113](https://github.com/karmaniverous/jeeves-watcher/issues/113))

`watcher_config_apply` writes config to disk but the running service doesn't pick up all changes. `reloadConfig()` recompiles rules and triggers a scoped reindex, but does NOT:
- Restart the chokidar filesystem watcher (new/removed watch paths are ignored)
- Rebuild the `MoveCorrelator` with updated `moveDetection` config
- Update the gitignore filter for new watch roots
- Rebuild the API server with the new config reference (related to #144)

**Fix:** `reloadConfig()` needs to tear down and rebuild the filesystem watcher, move correlator, and gitignore filter when watch config changes. The API server config reference issue is addressed by #144's getter pattern.

### Virtual rules not applied to files indexed before registration ([#146](https://github.com/karmaniverous/jeeves-watcher/issues/146))

Virtual rules registered via `POST /rules/register` (e.g., jeeves-meta's 3 rules) are auto-reapplied to matching files via `onRulesChanged` → `executeReindex('rules', matchGlobs)`. However, this fails for files under newly added watch paths because `onRulesChanged` captures the config object at server creation time — if watch paths were added after startup, the reindex walks the old path list and misses new paths.

**Root cause:** Same stale config reference as #144. The `onRulesChanged` closure captures `deps.config` which doesn't update when `reloadConfig()` assigns `this.config = newConfig`.

**Fix:** Resolved by #144's config getter pattern. `onRulesChanged` deps should use `getConfig()` instead of a captured `config` reference, so the reindex walks the current watch paths.

### watcher_enrich returns HTTP 500 on valid indexed file ([#116](https://github.com/karmaniverous/jeeves-watcher/issues/116))

**Root cause identified:** `metadataValidation.ts` calls `mergeSchemas()` at request time to validate the enrichment payload. `mergeSchemas` resolves schema file references (e.g., `schemas/content-fields.json`) relative to CWD. The NSSM service runs from `C:\nvm4w\nodejs`, not the config directory (`J:\config`), so schema file resolution fails with ENOENT.

**Fix:** Pass `configDir` to `validateMetadataPayload()` and thread it through to `mergeSchemas()` for file path resolution. The `configDir` is available in the route handler deps (already used by `createConfigValidateHandler`).

### Dev Plan

Dependency graph: #145 is independent. #144 is foundational (#146 and #113 depend on it). #116 is independent but touches the same handler deps pattern. #113 is the largest scope item.

**Step 1 — Trivial fixes (#145, #116)**

Two independent one-liner-class fixes, no architectural impact:

- **#145:** Add `this.enrichmentStore?.close()` to `JeevesWatcher.stop()` after queue drain, before server close.
- **#116:** Add `configDir` parameter to `validateMetadataPayload()` in `metadataValidation.ts`. Thread it through to `mergeSchemas()` for schema file path resolution. Update `createMetadataHandler` to pass `configDir` from route deps (already available — same pattern as `createConfigValidateHandler`).

Tests:
- #145: Update `stop()` test to verify `enrichmentStore.close()` is called.
- #116: Add test for `validateMetadataPayload` with a schema file reference, verifying it resolves relative to `configDir` not CWD.

**Verify:** lint, typecheck, test — all green. Commit: `fix: close EnrichmentStore on shutdown (#145), fix schema path resolution in metadata validation (#116)`.

**Step 2 — Config getter pattern (#144)**

Replace captured config references with a getter function across all API handler factories.

1. Add `getConfig: () => JeevesWatcherConfig` to `ApiServerOptions` (alongside existing `config`).
2. In `createApiServer()`, create the getter: `const getConfig = () => options.getConfig?.() ?? options.config`.
3. Update all handler factory calls to pass `getConfig` instead of `config`:
   - `createConfigQueryHandler` — `getConfig` replaces `config` in deps
   - `createConfigValidateHandler` — same
   - `createConfigMatchHandler` — same
   - `createFacetsHandler` — same
   - `createConfigApplyHandler` — same
   - `createMetadataHandler` — same (also benefits #116's `configDir`)
   - `createConfigReindexHandler` — same
   - `createOnRulesChanged` — same (resolves #146)
4. Update each handler's deps interface: `config` → `getConfig: () => JeevesWatcherConfig`. Each handler calls `getConfig()` at request time instead of referencing a captured object.
5. In `JeevesWatcher.startApiServer()`, pass `getConfig: () => this.config` so handlers always see the current config after `reloadConfig()`.

Tests:
- Unit test: create handler with getter, call `getConfig()`, verify it returns current value after simulated config update.
- Integration test: apply config change via `reloadConfig()`, query `GET /config`, verify new config reflected without restart.

**Verify:** lint, typecheck, test. Commit: `refactor: replace captured config with getter pattern in API handlers (#144, #146)`.

**Step 3 — Full hot-reload (#113)**

Extend `reloadConfig()` to rebuild filesystem infrastructure when watch config changes:

1. **Detect watch config changes:** Compare `newConfig.watch` with `this.config.watch` (deep equality on `paths`, `ignored`, `moveDetection`, `respectGitignore`). Only rebuild if watch config actually changed.

2. **Tear down existing watcher:** Call `this.watcher.stop()` (which flushes the `MoveCorrelator`). Wait for completion.

3. **Rebuild gitignore filter:** Create new `GitignoreFilter` from `newConfig.watch.paths` if `respectGitignore` is enabled.

4. **Rebuild filesystem watcher + correlator:** Call `createWatcher()` from `initialization.ts` with the new config, existing queue, processor, logger, and new gitignore filter. This creates a fresh `FileSystemWatcher` with a new `MoveCorrelator` configured from `newConfig.watch.moveDetection`.

5. **Start the new watcher:** `this.watcher.start()`. This triggers a new initial scan — chokidar's `add` events for all files under the new paths. The `ContentHashCache` and `processFile` skip logic handle files that are already indexed (hash match → skip). New paths get their initial scan.

6. **Update stored references:** `this.watcher = newWatcher`, `this.gitignoreFilter = newGitignoreFilter`.

7. **Existing queue and processor are reused** — no need to rebuild them. The processor already has updated rules from `processor.updateRules()`.

Edge cases:
- If only rules changed (no watch config change), skip the watcher rebuild — existing behavior is sufficient.
- If the new watcher fails to start, log the error but don't leave the service without a watcher — fall back to the old one.
- The initial scan of the new watcher will enqueue events for all files under new paths. The queue's debounce and concurrency settings handle the burst.

Tests:
- Unit test: mock `reloadConfig()` with changed `watch.paths`, verify old watcher stopped and new watcher started.
- Unit test: mock `reloadConfig()` with unchanged `watch`, verify watcher NOT restarted.
- Integration test: start watcher with path A, add path B via config change, verify files under B are indexed after reload.

**Verify:** lint, typecheck, test. Commit: `feat: full hot-reload with filesystem watcher rebuild on watch config change (#113)`.

**Step 4 — Quality gate + PR**

- `npm run lint` — zero errors, zero warnings (both packages)
- `npm run typecheck` — clean (both packages)
- `npm run test` — all green (both packages)
- `npm run knip` — no unused exports
- PR to `main`, request review from `karmaniverous`

