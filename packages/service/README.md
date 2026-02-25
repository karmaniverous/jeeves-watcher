# @karmaniverous/jeeves-watcher

Filesystem watcher that keeps a [Qdrant](https://qdrant.tech/) vector store in sync with document changes. Extract text from files, chunk it, generate embeddings, and query your documents with semantic search.

## Features

- **Filesystem watching** — monitors directories for file changes via [chokidar](https://github.com/paulmillr/chokidar)
- **Multi-format extraction** — PDF, HTML, DOCX, Markdown, plain text, and more
- **Configurable chunking** — token-based text splitting with overlap control
- **Embedding providers** — Gemini, OpenAI, or mock (for testing)
- **Qdrant sync** — automatic upsert/delete keeps the vector store current
- **Rules engine** — glob-based inference rules for metadata enrichment
- **REST API** — Fastify server for search, status, config, and management
- **CLI** — `jeeves-watcher init`, `validate`, `start`, and more

## Install

```bash
npm install @karmaniverous/jeeves-watcher
```

## Quick Start

```bash
# Generate a config file
npx jeeves-watcher init --output ./jeeves-watcher.config.json

# Validate it
npx jeeves-watcher validate --config ./jeeves-watcher.config.json

# Start the watcher
npx jeeves-watcher start --config ./jeeves-watcher.config.json
```

## Documentation

Full docs, guides, and API reference:

**[docs.karmanivero.us/jeeves-watcher](https://docs.karmanivero.us/jeeves-watcher)**

## License

BSD-3-Clause
