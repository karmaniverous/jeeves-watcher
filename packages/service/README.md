# @karmaniverous/jeeves-watcher

Filesystem watcher that keeps a [Qdrant](https://qdrant.tech/) vector store in sync with document changes. Extract text from files, chunk it, generate embeddings, and query your documents with semantic search.

## Requirements

- **Node.js** ≥ 22

## Features

- **Filesystem watching** — monitors directories for file changes via [chokidar](https://github.com/paulmillr/chokidar)
- **Multi-format extraction** — PDF, HTML, DOCX, Markdown, plain text, and more
- **Configurable chunking** — token-based text splitting with overlap control
- **Embedding providers** — Gemini (default) or mock (for testing); extensible via provider registry
- **Qdrant sync** — automatic upsert/delete keeps the vector store current
- **Rules engine** — glob-based inference rules for metadata enrichment
- **REST API** — Fastify server for search, status, config, and management
- **CLI** — `jeeves-watcher init`, `validate`, `start`, and more

## JsonMap Built-in Helpers

The following helpers are available in every JsonMap `lib` context:

| Helper | Description |
|--------|-------------|
| `split(str, sep)` | Split a string into an array |
| `slice(arr, start, end?)` | Slice an array |
| `join(arr, sep)` | Join an array into a string |
| `toLowerCase(str)` | Lowercase a string |
| `replace(str, search, replacement)` | String replacement |
| `get(obj, path)` | Dot-path property access |
| `lookupJson(filePath, key, field?)` | Load a JSON file and look up a value by key |
| `mapLookup(filePath, keys, field)` | Map keys through a JSON lookup, collecting a field from each |
| `fetchSiblings(filePath, options?)` | Extract text from neighboring files for contextual embedding |

### `fetchSiblings`

Retrieves extracted text from sibling files in the same directory, useful for contextual embedding (e.g., injecting surrounding email thread messages).

**Options:** `{ before?: number (default 3), after?: number (default 1), sort?: "name" | "mtime" (default "name") }`

Returns `string[]` of extracted text. Files that fail extraction are silently skipped.

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
