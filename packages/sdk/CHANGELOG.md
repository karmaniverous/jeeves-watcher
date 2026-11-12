# Changelog

All notable changes to this project will be documented in this file.

## [0.4.1] - 2026-11-12

### 💼 Other

- Updated dependencies
- Updated core
## [0.4.0] - 2026-11-12

### 💼 Other

- [0-22] feat!: adopt Fastify's standard error body with WATCHER_* codes (#312)

Every watcher error is a jeeves defineError class answered by jeeves 0.11's catalog error handler: { statusCode, code, error, message }, fixed messages, no details. Unexpected failures are masked 500s. POST /vcs/exclude over the threshold without confirm is now 200 { confirmRequired, untracked }; prune without a vector store is 503. watcher-core drops API_ERROR_* for WATCHER_ERROR_CODES/STATUS; SDK WatcherError carries the body's code and message. Wire overlay wire-errors-0.22.0.json pins every error reply.

BREAKING CHANGE: error codes and bodies change; see guides/upgrading.md#0220.

Fixes #312
- Updated core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-sdk v0.4.0
## [0.3.1] - 2026-11-07

### 💼 Other

- Updated core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-sdk v0.3.1
## [0.3.0] - 2026-11-07

### 💼 Other

- Updated core

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-sdk v0.3.0
## [0.3.0-2] - 2026-11-06

### 💼 Other

- Merge remote-tracking branch 'origin/main' into feature/p9-processing-at-scale
- *(sdk)* Mark @karmaniverous/jeeves external (no unresolved-dependency warning)
- Updated core

### 📚 Documentation

- Facets (countFacets, listFacets rules, chunk_index and matched_rules system indexes)

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-sdk v0.3.0-2
## [0.3.0-1] - 2026-11-04

### 🚀 Features

- *(core)* Catalog entries for every route (A2)
- *(sdk)* [**breaking**] SDK 0.3.0 on jeeves's catalog client (D36, D53, D60, D78)

### 🐛 Bug Fixes

- Independent review findings on the clients

### 💼 Other

- [281] chore: update dependencies (patch and minor) (#281)

npm-check-updates --peer --target minor in the root and all four packages, then npm audit fix (non-breaking): audit 17 -> 14. One zod (4.6.7). All gates pass. Left for the owner (major): chokidar 6, unpdf 2, typescript 7 (blocked by typescript-eslint's peer range), mdast-util-from-adf 2.2 and release-it 19 (the remaining audit highs).
- [281] chore: patch/minor deps, prettier-ignore generated baselines, squash test timeout
- Release guard for dependents' core range (#277)
- Patch and minor dependency updates
- Require Node >=24.22.2 (D188)
- Updated core

### 🚜 Refactor

- [**breaking**] Verb-first operation names (D77); retire WATCHER_ENDPOINTS (D41)
- Finishing passes on the clients

### 📚 Documentation

- VCS-only exclusion (API reference, version-control and upgrading guides, READMEs, plugin tool descriptions)
- Clients on the catalog (SDK guide, CLI reference, plugin guide, upgrading)

### ⚙️ Miscellaneous Tasks

- Release @karmaniverous/jeeves-watcher-sdk v0.3.0-1
## [0.2.0] - 2026-10-14

### 🚀 Features

- *(sdk)* @karmaniverous/jeeves-watcher-sdk 0.1.0
- Machine-readable error codes on API error responses

### 🐛 Bug Fixes

- Harden delete filters, issue records and config schemas
- *(sdk)* Reject a baseUrl carrying a query string or fragment
- *(release)* GitHub release notes and changelog use the new version tag

### 💼 Other

- Updated core

### 🚜 Refactor

- One HTTP client contract in core; error status comes from the code
- Core owns defaults, limits and index-type guards; uniform route registrars

### 📚 Documentation

- Source documents, notify API, auth, payload indexes, SDK
- Typedoc covers core, sdk and service; fix docs warnings
- Document review fixes, error bodies and status shape
- Root README, CONTRIBUTING and package READMEs match the code
- Neutral example paths and names in guides, skill and tests

### 🧪 Testing

- Integration lifecycle for source documents
- Neutral example names; remove client wording from tests and docs
- Route-wide auth, shared limiter, reload and deletion proofs
- Rule handlers, plugin config tools, CLI helpers and edges

### ⚙️ Miscellaneous Tasks

- Ship LICENSE in every package; core README and license metadata
- Release @karmaniverous/jeeves-watcher-sdk v0.2.0
