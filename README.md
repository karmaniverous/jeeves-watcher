# @karmaniverous/jeeves-watcher

Filesystem watcher that keeps a Qdrant vector store in sync with document changes.

## Overview

`jeeves-watcher` monitors a configured set of directories for file changes, extracts text content, generates embeddings, and maintains a synchronized Qdrant vector store for semantic search.

## CLI Commands

- `jeeves-watcher start` — Start the filesystem watcher
- `jeeves-watcher init` — Initialize a new configuration
- `jeeves-watcher status` — Show watcher status
- `jeeves-watcher reindex` — Reindex all watched files
- `jeeves-watcher rebuild-metadata` — Rebuild metadata for all watched files
- `jeeves-watcher search` — Search the vector store
- `jeeves-watcher enrich` — Enrich document metadata
- `jeeves-watcher validate` — Validate the configuration
- `jeeves-watcher service` — Manage the watcher as a system service
- `jeeves-watcher config-reindex` — Reindex configuration files

## License

BSD-3-Clause
