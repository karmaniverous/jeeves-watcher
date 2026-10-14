# Changelog

All notable changes to this project will be documented in this file.

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
