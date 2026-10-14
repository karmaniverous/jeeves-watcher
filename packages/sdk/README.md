# @karmaniverous/jeeves-watcher-sdk

Typed TypeScript client for the [jeeves-watcher](https://www.npmjs.com/package/@karmaniverous/jeeves-watcher) HTTP API.

The SDK is thin by design. Request and response types come from [`@karmaniverous/jeeves-watcher-core`](https://www.npmjs.com/package/@karmaniverous/jeeves-watcher-core), the same Zod schemas the service validates against, so your types cannot drift from the server. Every request body is validated client-side before it is sent, and every response is checked against the core response schema.

- ESM only, Node.js ≥ 22.13 (uses the global `fetch`).
- One runtime dependency: `@karmaniverous/jeeves-watcher-core` (and its own dependencies).
- One error type, `WatcherError`. No retries: the watcher owns rate limiting.
- Application-facing surface only: `status`, `search`, `scan`, `render`, `metadata`, `reindex`, `issues`, and `documents.notify` / `documents.delete`. Admin endpoints (config, rules, VCS) are not covered.

For the concepts behind source documents (configured `sources`, the callback contract, designated rules, notify and coalescing) and the full HTTP reference, see the service guides: [Source Documents](https://docs.karmanivero.us/jeeves-watcher/documents/Service_Guides.Source_Documents.html) and [API Reference](https://docs.karmanivero.us/jeeves-watcher/documents/Service_Guides.API_Reference.html) (sources in [`packages/service/guides`](https://github.com/karmaniverous/jeeves-watcher/tree/main/packages/service/guides)).

## Install

```bash
npm install @karmaniverous/jeeves-watcher-sdk
```

## Quick start

```ts
import { createWatcherClient, f } from '@karmaniverous/jeeves-watcher-sdk';

const watcher = createWatcherClient({
  baseUrl: 'http://watcher.internal.example:1936',
  apiKey: process.env.WATCHER_API_KEY, // watcher config api.apiKey; omit if unset
  timeoutMs: 10_000, // default
});

// 1. A chat thread changed: notify the watcher. It queues and coalesces the
//    reference, then retrieves the current record through your source callback.
const { accepted, rejected } = await watcher.documents.notify([
  { source: `app://chat/thread/${threadId}`, rule: 'chat-thread' },
]);

// 2. Search one user's history. Always carry the tenant filter.
const hits = await watcher.search({
  query: 'how do I reset my password?',
  limit: 8,
  filter: f.and(f.eq('type', 'chat_thread'), f.eq('user_id', userId)),
});
for (const hit of hits)
  console.log(hit.score, hit.payload.source, hit.payload.chunk_text);

// 3. Remove documents: by reference, or by filter (the server constrains a
//    filter to source documents, so it can never delete file points).
//    A filter without any condition ({}, { must: [] }, ...) is refused
//    client-side (invalid_request, nothing sent) and by the server (400).
//    `sources` takes 1 to 1000 references (core MAX_DELETE_SOURCES_PER_REQUEST).
await watcher.documents.delete({ sources: [`app://chat/thread/${threadId}`] });
await watcher.documents.delete({ filter: f.eq('user_id', userId) });
```

### Notify synchronously

`notify` resolves with the `202` body (`accepted` references and synchronously `rejected` notifications). Processing failures then surface in `watcher.issues()`. For backfill and tests, pass `{ wait: true }` to process synchronously and get one result per document; the return type follows the option:

```ts
const { results } = await watcher.documents.notify(batch, { wait: true });
// results: Array<{ source, status: 'indexed' | 'unchanged' | 'deleted' | 'failed', chunks?, matched_rules?, error? }>
```

A request carries 1 to `MAX_DOCUMENTS_PER_REQUEST` (100) notifications.

### Other methods

```ts
await watcher.status(); // open even when an API key is configured
await watcher.scan({ filter: f.eq('user_id', userId), limit: 100 }); // filter-only, cursor paging
await watcher.render({ source: 'app://chat/thread/123' }); // or { path }
await watcher.metadata({
  source: 'app://chat/thread/123',
  metadata: { priority: 2 },
});
await watcher.reindex({ scope: 'path', source: ['app://chat/thread/123'] }); // at most 1000 references
await watcher.issues();
```

### Filter helpers

`f` builds native Qdrant filter objects; you can always pass a raw Qdrant filter instead.

| Helper | Produces |
| --- | --- |
| `f.eq(key, value)` | `{ must: [{ key, match: { value } }] }` |
| `f.any(key, values)` | `{ must: [{ key, match: { any: values } }] }` |
| `f.range(key, { gt, gte, lt, lte })` | `{ must: [{ key, range }] }` (numbers, or RFC 3339 strings on datetime indexes) |
| `f.isEmpty(key)` | `{ must: [{ is_empty: { key } }] }` |
| `f.and(...filters)` | merged `must` / `must_not` lists |
| `f.or(...filters)` | merged `should` list |
| `f.not(filter)` | `must_not`, simplified where the logic allows |

## Error handling

Every failure is a `WatcherError` with `code`, optional `status` and optional `details`:

| `code` | When | `status` |
| --- | --- | --- |
| `invalid_request` | The body failed the core request schema; nothing was sent. `details` holds the Zod issues. | — |
| `invalid_response` | A 2xx body was not JSON or did not match the core response schema. | 2xx |
| `timeout` | No response within `timeoutMs`. | — |
| `network_error` | `fetch` rejected (connection refused, DNS, …); see `cause`. | — |
| `invalid_options` | `createWatcherClient` options are invalid (e.g. a `baseUrl` that is not http(s) or carries a query string or fragment). | — |
| server code | A non-2xx response: an `ApiErrorCode` (below) from a 0.20.0+ service; from older services `body.code`, else `body.error`, else `http_<status>`. `details` is `body.details` or the body. | 4xx / 5xx |

A 0.20.0+ service answers every non-2xx with `{ code, error, message?, details? }`. `code` is one of `API_ERROR_CODES` (exported, with the `ApiErrorCode` type): `invalid_request`, `unauthorized`, `path_not_watched`, `not_found`, `source_not_indexed`, `source_not_found`, `unsupported_content_type`, `pipeline_error`, `source_unavailable`, `not_available`, `scan_in_progress`, `embedding_unavailable`, `internal_error`. The SDK copies it to `err.code`; `err.message` is the body's `error` text, with `: <message>` appended when the body's `message` is present and different. Branch on `code`, never on the message. A filter the server's Qdrant rejects comes back as `invalid_request` with `error` `Invalid filter` (Qdrant's reason in `message`); a `5xx` body never carries the server's internal error, only generic text, so check the service log. Per-document `error.code` values of `documents.notify` results are typed by core's `documentFailureCodeSchema` (rejection codes plus issue types). The server's `invalid_request` (a `400`, `status` set) shares its name with the SDK's client-side `invalid_request` (nothing sent, no `status`). See the service API reference for what each code means.

```ts
import { isWatcherError } from '@karmaniverous/jeeves-watcher-sdk';

try {
  await watcher.search({ query, filter });
} catch (err) {
  if (isWatcherError(err) && err.code === 'embedding_unavailable') {
    // embedding provider exhausted its retry budget: back off and retry later
  }
  throw err;
}
```

The SDK never retries. Retry `timeout`, `network_error` and `503` at your own discretion; a notification is idempotent, so re-sending one is always safe.

## Implementing the callback side

The watcher retrieves source documents from you. Each source is declared in watcher config (`sources.<name>.url`, with an `{id}` placeholder and optional headers); callers never send URLs. For a reference `app://chat/thread/123` the watcher calls:

```
GET {url with {id} = chat/thread/123}
  200 + application/json → the document itself: any JSON object, as you store it (no envelope)
  404                    → the document no longer exists; the watcher deletes its points
  anything else          → transient failure; recorded as a source_unavailable issue, points untouched
```

Only `application/json` bodies are accepted. The designated rule's template turns the record into embeddable text, so you never render for the watcher. The types are exported for your handler:

```ts
import type { SourceDocument } from '@karmaniverous/jeeves-watcher-sdk';
import { SOURCE_DOCUMENT_GONE_STATUS } from '@karmaniverous/jeeves-watcher-sdk';

app.get('/watcher/threads/*', async (req, res) => {
  const thread = await loadThread(req.params[0]); // e.g. "chat/thread/123"
  if (!thread) return res.status(SOURCE_DOCUMENT_GONE_STATUS).end();
  const body: SourceDocument = thread;
  res.type('application/json').send(body);
});
```

Keep the callback fast (one indexed query) and available: it sits on the indexing path for every notification. An outage delays indexing but loses nothing; the next notification or a reindex catches up.

## License

BSD-3-Clause
