# @karmaniverous/jeeves-watcher-core

Shared Zod schemas, derived TypeScript types, defaults and constants for the [jeeves-watcher](https://www.npmjs.com/package/@karmaniverous/jeeves-watcher) ecosystem.

This package is the single source of truth for the watcher's contracts. The service validates with these schemas, and the [SDK](https://www.npmjs.com/package/@karmaniverous/jeeves-watcher-sdk) and the [OpenClaw plugin](https://www.npmjs.com/package/@karmaniverous/jeeves-watcher-openclaw) type against them, so clients cannot drift from the server.

- **Config:** `jeevesWatcherConfigSchema` and its section schemas (watch, embedding, vector store, inference rules, API key, payload indexes, sources), plus defaults such as `EMBEDDING_DEFAULTS` and `API_DEFAULTS`.
- **API:** request and response schemas for the public HTTP endpoints, the endpoint catalogue (`WATCHER_ENDPOINTS`, `getEndpoint`) and the error body with its machine-readable `code`.
- **Source documents:** the `<name>://<id>` reference schema (`sourceReferenceSchema`) and the callback record contract (`sourceDocumentSchema`).
- **Payload:** reserved system payload fields (`RESERVED_PAYLOAD_FIELDS`, `isReservedPayloadField`).

ESM only, Node.js >= 22.13. Most applications should use the SDK rather than depend on this package directly.

## Install

```bash
npm install @karmaniverous/jeeves-watcher-core
```

## Documentation

API reference: [docs.karmanivero.us/jeeves-watcher](https://docs.karmanivero.us/jeeves-watcher). Source and guides: [github.com/karmaniverous/jeeves-watcher](https://github.com/karmaniverous/jeeves-watcher).

## License

BSD-3-Clause
