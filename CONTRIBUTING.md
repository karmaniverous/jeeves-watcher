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
  - The package `engines` field currently allows Node 20+, but this repo is developed and tested with modern Node.

Verify:

```bash
node --version
npm --version
```

### Qdrant (required for tests)

Tests use a **real Qdrant instance** on `http://localhost:6333`.

#### Option A: Docker (recommended)

```bash
docker run -d \
  --name qdrant \
  -p 6333:6333 \
  -p 6334:6334 \
  -v qdrant_storage:/qdrant/storage \
  qdrant/qdrant
```

Verify:

```bash
curl http://localhost:6333/healthz
```

#### Option B: Windows (native binary)

1. Download the latest Windows release from https://github.com/qdrant/qdrant/releases
2. Extract to e.g. `C:\qdrant\`
3. Run:

```powershell
cd C:\qdrant
.\qdrant.exe
```

Verify:

```bash
curl http://localhost:6333/healthz
```

#### Option C: Linux (native binary)

Follow Qdrant’s install docs, or download a release binary from:

https://github.com/qdrant/qdrant/releases

Run `qdrant`, then verify the health endpoint:

```bash
curl http://localhost:6333/healthz
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

### Start Qdrant

Qdrant must be running locally on `6333`:

```bash
curl http://localhost:6333/healthz
```

### Run tests

```bash
npm test
```

Notes:

- Tests use a dedicated collection named **`jeeves_watcher_test`**.
- Integration tests delete/recreate this collection to ensure a clean state.
- Tests create temp directories under your OS temp folder:
  - `.../jeeves-watcher-test/watched`
  - `.../jeeves-watcher-test/metadata`

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

Before opening a PR (and before each commit when working in this repo), run:

```bash
npx stan run --sequential
```

This runs (in order):

- typecheck
- lint
- test
- diagrams
- docs
- build
- knip

All must pass.

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

The `diagrams` STAN job automatically renders all diagrams and verifies outputs.

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

- **Real Qdrant**: `VectorStoreClient` uses `@qdrant/js-client-rest` against a local Qdrant instance.
- **Temp files**: tests write real files to a temp watched directory.
- **Real pipeline**: tests call `DocumentProcessor.processFile()` and verify that Qdrant points/payloads exist.
- **Cleanup**:
  - the `jeeves_watcher_test` collection is deleted and recreated between tests
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
