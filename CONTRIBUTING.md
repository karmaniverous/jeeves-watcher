# Contributing to `jeeves-watcher`

Thanks for contributing!

This project is a Node.js service that watches the filesystem, extracts/chunks text, generates embeddings, and keeps a Qdrant collection in sync.

If you’re new to the codebase, start with:

- `guides/getting-started.md`
- `guides/architecture.md`

---

## Prerequisites

### Node.js

- **Node.js 24+** is recommended for development.
  - The package `engines` field currently allows Node 22.13+, but this repo is developed and tested with modern Node.

Verify:

```bash
node --version
npm --version
```

### Qdrant (no setup needed for tests)

You do **not** need to run Qdrant to run the test suite. Unless you set `QDRANT_URL`, the Vitest global setup (`packages/service/src/test/globalSetup.ts`) starts a **throwaway Qdrant 1.19.1** for the run and removes it afterwards:

1. **Release binary (preferred):** the official Qdrant release archive for your platform (Windows x86_64, Linux x86_64/aarch64 musl, macOS x86_64/aarch64) is downloaded once from GitHub, checked against a pinned SHA-256, extracted with `tar` and cached in `packages/service/node_modules/.cache/qdrant/1.19.1` (override the cache root with `QDRANT_CACHE_DIR`). The cached executable is re-checked against its own pinned SHA-256 on every run (and re-downloaded on a mismatch). Each run starts it on free random `127.0.0.1` ports, with storage, snapshots and temp files in a fresh OS temp directory; `QDRANT__*` variables from your shell are not passed to it.
2. **Docker (fallback):** if the binary cannot be downloaded or started (offline, unsupported platform), `docker run --rm -d -p 127.0.0.1::6333 qdrant/qdrant:v1.19.1` is used instead. The container is labelled with its owner (host and process id); the next start removes containers whose owner process has died.
3. **Neither:** the Qdrant integration suites are skipped with a warning, unless `QDRANT_REQUIRED=true`, which fails the run.

The throwaway instance passes the same shared-instance guard as a `QDRANT_URL` instance. Teardown kills the process (or removes the container) and deletes the temp directory; an interrupted run (Ctrl+C, SIGTERM) cleans up on a best-effort basis. A Qdrant you already run on `localhost:6333` is never contacted unless you point `QDRANT_URL` at it.

To run Qdrant yourself (for the service, not the tests), see the [Qdrant installation guide](https://qdrant.tech/documentation/guides/installation/) or use Docker:

```bash
docker run -d --name qdrant -p 6333:6333 -v qdrant_storage:/qdrant/storage qdrant/qdrant
```

---

## Development Setup

### 1) Clone

```bash
git clone https://github.com/karmaniverous/jeeves-watcher.git
cd jeeves-watcher
```

### 2) Install dependencies

```bash
npm install
```

### 3) Create a local config (optional)

For local manual testing:

```bash
npx jeeves-watcher init --output ./jeeves-watcher.config.json
npx jeeves-watcher validate --config ./jeeves-watcher.config.json
```

Then start:

```bash
npx jeeves-watcher start --config ./jeeves-watcher.config.json
```

Configuration reference:

- `guides/configuration.md`

---

## Running Tests

### Run tests

```bash
npm test
```

No running Qdrant is needed: see [Qdrant](#qdrant-no-setup-needed-for-tests) above.

Environment variables:

- `QDRANT_URL`: use this existing Qdrant instead of starting a throwaway one (CI does this with a service container). The instance must hold **no collections other than `jeeves_watcher_it_*`**: the global setup refuses to run against anything that looks shared or production, unless `QDRANT_ALLOW_SHARED=true`. `QDRANT_API_KEY` is sent when set.
- `QDRANT_REQUIRED=true`: fail instead of skipping when no Qdrant is available (set in CI).
- `QDRANT_ALLOW_SHARED=true`: accept a `QDRANT_URL` instance that already holds other collections (not recommended).
- `QDRANT_CACHE_DIR`: cache root for the downloaded Qdrant binary.

Notes:

- Integration tests only ever create, use and drop collections named **`jeeves_watcher_it_*`** (`jeeves_watcher_it_<label>_<run>_<worker>_<nonce>`, see `packages/service/src/test/harness/qdrant.ts`), and only on the Qdrant the global setup provisioned or guarded for this run. The harness refuses any other name or URL, and the global teardown sweeps leftover collections of **this run only** (never a concurrent run's): defence in depth should `QDRANT_URL` ever point at an instance with other data.
- Tests create temp directories under your OS temp folder:
  - `.../jeeves-watcher-test/watched`
  - `.../jeeves-watcher-test/metadata`
  - `.../jeeves-watcher-qdrant-*` (throwaway Qdrant state, removed at teardown)

---

## Mock Embedding Provider (no API keys needed)

CI and local tests do **not** require a Gemini/OpenAI key.

The test configuration uses:

- `embedding.provider = "mock"`
- deterministic vectors derived from a SHA-256 hash of chunk text

Implementation:

- `src/embedding/index.ts` — `createMockProvider()`
- `src/test/helpers.ts` — `createTestConfig()` sets `provider: "mock"`

This keeps tests stable and fast while still exercising the full Qdrant integration.

---

## Code Quality / Required Checks

Before opening a PR (and before each commit when working in this repo), run all code quality checks, including:

- typecheck
- lint
- test
- diagrams
- docs
- build
- knip

All must pass with no errors or warnings.

---

## Diagrams

Architecture diagrams are created with **PlantUML** and embedded in documentation.

### Directory Structure

- **Source files**: `diagrams/*.pu` — PlantUML source code
- **Rendered output**: `assets/*.png` — Generated PNG images

### VS Code Extension (Recommended)

The [jebbs.plantuml](https://marketplace.visualstudio.com/items?itemName=jebbs.plantuml) extension is configured in `.vscode/settings.json` for live preview and rendering.

Install it for:

- Live diagram preview (Alt+D)
- Export to PNG/SVG directly from the editor
- Syntax highlighting and validation

### Rendering from CLI

To render all diagrams:

```bash
plantuml -tpng -o "../assets" diagrams/*.pu
```

To render a single diagram:

```bash
plantuml -tpng -o "../assets" diagrams/my-diagram.pu
```

### Embedding in Documentation

Use relative paths from the doc file to the rendered diagram:

```markdown
![Diagram Description](../assets/diagram-name.png)
```

Example (from `guides/architecture.md`):

```markdown
![System Architecture](../assets/system-architecture.png)
```

### Style Guidelines

- Use clean, readable PlantUML (not overly complex)
- Apply consistent `skinparam` styling across diagrams
- Keep diagrams focused — one concept per diagram
- Use proper diagram types (activity, component, sequence, etc.)

---

## Commit Conventions

Use **Conventional Commits**:

- `feat: ...` — new feature
- `fix: ...` — bug fix
- `docs: ...` — documentation only
- `refactor: ...` — behavior-preserving refactor
- `test: ...` — tests only
- `chore: ...` — tooling/maintenance

Examples:

```text
docs: add configuration guide
fix: handle empty extracted text in processor
feat: add openai embedding provider
```

---

## How the Test Infrastructure Works

The test suite is intentionally integration-heavy.

- **Real Qdrant**: `VectorStoreClient` uses `@qdrant/js-client-rest` against the throwaway Qdrant started by the global setup (or the instance named by `QDRANT_URL`).
- **Temp files**: tests write real files to a temp watched directory.
- **Real pipeline**: tests call `DocumentProcessor.processFile()` and verify that Qdrant points/payloads exist.
- **Cleanup**:
  - each suite works in its own throwaway `jeeves_watcher_it_*` collection, dropped when the suite ends
  - temp dirs are removed after each test and at the end of the suite

Start points:

- `src/test/integration.test.ts`
- `src/test/helpers.ts`

---

## Project Structure (high-level)

- `src/app/` — app composition / start-from-config
- `src/cli/` — CLI entry points (`jeeves-watcher ...`)
- `src/config/` — config types + loader
- `src/watcher/` — chokidar filesystem watcher
- `src/processor/` — core pipeline (extract → hash → rules → chunk → embed → upsert)
- `src/extractors/` — format-specific text extraction
- `src/rules/` — inference rules engine (ajv + custom `glob` keyword + template interpolation)
- `src/vectorStore/` — Qdrant wrapper
- `src/api/` — Fastify API server routes

For deeper detail, see:

- `guides/architecture.md`

---

## Getting Help

If something is unclear or you hit an edge case:

1. Check `guides/` first.
2. Search issues: https://github.com/karmaniverous/jeeves-watcher/issues
3. Open a new issue with:
   - OS + Node version
   - config snippet (redact secrets)
   - logs (redact secrets)
   - steps to reproduce
