# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0-0] - 2026-11-04

### 💼 Other

- [281] chore: update dependencies (patch and minor) (#281)

npm-check-updates --peer --target minor in the root and all four packages, then npm audit fix (non-breaking): audit 17 -> 14. One zod (4.6.7). All gates pass. Left for the owner (major): chokidar 6, unpdf 2, typescript 7 (blocked by typescript-eslint's peer range), mdast-util-from-adf 2.2 and release-it 19 (the remaining audit highs).
- [281] chore: patch/minor deps, prettier-ignore generated baselines, squash test timeout
- [281] updated core
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
