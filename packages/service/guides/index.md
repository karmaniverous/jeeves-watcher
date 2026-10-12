---
title: Service Guides
children:
  - ./getting-started.md
  - ./configuration.md
  - ./architecture.md
  - ./inference-rules.md
  - ./source-documents.md
  - ./api-reference.md
  - ./cli-reference.md
  - ./deployment.md
  - ./version-control.md
  - ../CHANGELOG.md
---

# Service Guides

- [Getting Started](./getting-started.md) — Installation, prerequisites, initial config, and first run.
- [Configuration Reference](./configuration.md) — Complete config schema: watch paths, embedding and rate limiting, vector store and payload indexes, API key, sources, inference rules, search, and logging.
- [Architecture](./architecture.md) — Data flow pipeline, component diagram, two-source-of-truth model, and processing stages.
- [Inference Rules](./inference-rules.md) — Rule matching, schema merging, `set` expressions, JsonMap transforms, Handlebars templates, and `renderDoc`.
- [Source Documents](./source-documents.md) — Indexing records from other systems by callback: `sources` config, the callback contract, designated rules, notify and coalescing, reindex, and the SDK.
- [API Reference](./api-reference.md) — HTTP endpoint reference for search, documents, config, reindex, scan, metadata, authentication, rate limiting, and diagnostics.
- [CLI Reference](./cli-reference.md) — All `jeeves-watcher` commands: core standard commands and domain-specific commands.
- [Deployment](./deployment.md) — Running as a service (NSSM/systemd), production config, log management, and updates.
- [Version Control (VCS)](./version-control.md) — Git-backed content versioning, commit batching, squash retention, remote push, and reversion.
- [Changelog](../CHANGELOG.md) — Release history for `@karmaniverous/jeeves-watcher`.
