---
title: Source Documents
---

# Source Documents

**v0.20.0+**

Files are not the only thing the watcher can index. A **source document** is a record that lives in another system (a database row, a chat thread, a ticket) and that the watcher retrieves by calling back to that system over HTTP. The owning application tells the watcher that a record changed; the watcher fetches the current record, renders it with an inference rule, embeds it and keeps its Qdrant points in sync, exactly as it does for a modified file.

The watcher keeps no copy of a source document beyond the Qdrant points themselves (vectors, `chunk_text` and projected metadata). The source system remains the single copy of the record.

This guide covers the model, configuration and callback contract. For the HTTP endpoints, see the [API Reference](./api-reference.md#post-documents). For a typed client, see the [SDK](#sdk).

---

## Files and Source Documents

Every point carries exactly one identity field:

|  | File point | Source point |
| --- | --- | --- |
| Identity field | `file_path` | `source`: a reference `<name>://<id>` |
| Retrieved by | Reading the file from disk | `GET` to the source's configured callback URL |
| Triggered by | Filesystem events | `POST /documents` notifications |
| Point ID | UUIDv5 of the **normalised** path + chunk index (case-insensitive) | UUIDv5 of the **exact** reference + chunk index (case-sensitive) |
| Extra system fields | none | `source_rule` (the designated rule) |

File points are unchanged by source support: same point IDs, same payload fields, no reindex on upgrade. A file point never carries `source`, and a source point never carries `file_path`. Consumers that need "the document key" can read `file_path ?? source`.

`source` and `source_rule` are reserved payload fields, alongside `file_path`, `chunk_index`, `chunk_text`, `total_chunks`, `content_hash`, `matched_rules`, `line_start`, `line_end`, `created_at` and `modified_at`. Rule and enrichment metadata can never overwrite them, and config validation warns when a rule schema declares a property with a reserved name.

### References

A reference is `<name>://<id>`:

- **`<name>`** is a configured source name: a lowercase letter followed by 1 to 31 of `[a-z0-9-]` (at least two characters, so a reference can never be mistaken for a Windows drive letter).
- **`<id>`** is opaque to the watcher: 1 to 512 non-whitespace characters. `/`-separated segments are allowed, but an empty segment (leading, trailing or doubled `/`) or a `.` / `..` segment is rejected as `invalid_id`.

Example: `app://chat/thread/6710c3a9`.

References are compared exactly. `app://chat/thread/ABC` and `app://chat/thread/abc` are two different documents with two different sets of point IDs.

---

## Configuring Sources

Sources are declared in config under `sources`. Callers never send URLs; they send references, and the watcher builds the URL from config.

```json
{
  "sources": {
    "app": {
      "url": "https://app.internal.example/watcher/documents/{id}",
      "headers": {
        "Authorization": "Bearer ${APP_CALLBACK_TOKEN}"
      },
      "timeoutMs": 10000,
      "concurrency": 8
    }
  }
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `url` | `string` | **Required** | Callback URL template. Must contain `{id}`, which is replaced with the document id: each `/`-separated segment is URL-encoded and the slashes are kept. Must be an absolute `http`/`https` URL with `{id}` outside the scheme, host and port. |
| `headers` | `Record<string, string>` | none | Headers sent with every callback request (for example `Authorization`). |
| `timeoutMs` | `number` | `10000` | Callback timeout in milliseconds. The clock starts when the request is sent, not while it waits for a concurrency slot. |
| `concurrency` | `number` | `8` | Maximum concurrent callbacks to this source, across notify processing, reindex and render. |

For the reference `app://chat/thread/6710c3a9`, the example above requests `https://app.internal.example/watcher/documents/chat/thread/6710c3a9`.

Rules for `sources`:

- `url` and `headers` support `${ENV_VAR}` substitution. If any of them still contains an unresolved `${...}` after substitution, loading the config fails and the service does not start. The error names the config path, never the value.
- A `url` that is not an absolute http(s) URL, or that places `{id}` in the scheme, host or port, also stops the service at startup.
- `sources` is read **at startup only**. Changing it requires a restart.
- `sources` never appears in `GET /config` or the merged document queried by `POST /config/query`, so URLs and header values cannot leak through the API.
- A notification naming a source that is not configured is rejected (`unknown_source`) and no request is made. The watcher only ever requests URLs built from this config, and never follows a URL to another origin.

---

## The Callback Contract

The source owner implements one read-only endpoint. For each reference, the watcher sends:

```
GET <url with {id} replaced>
<configured headers>
```

| Response | Outcome |
| --- | --- |
| `200`, `Content-Type: application/json` (parameters such as `charset` allowed), body is a JSON object | The document. Processed with its designated rule. |
| `200` with a JSON object that has no keys (`{}`) | Failure `no_content`; points untouched. |
| `200` with any other content type, or JSON that is not an object (an array, a string, ...) | Failure `unsupported_content_type`; points untouched. |
| `200` with a body that is not valid JSON | Failure `source_unavailable`; points untouched. |
| `404` | The document no longer exists. Its points, enrichment metadata and issues are removed (`deleted`). |
| Anything else: `3xx`, `401`, `403`, other `4xx`, `5xx`, timeout, network error | Failure `source_unavailable`; points untouched. |

Notes:

- The body is the record **as the owner stores it**, with no envelope and no pre-rendering. Turning it into embeddable text is the designated rule's job (see [Rendering](#rendering)).
- Only `GET` is used. Redirects are **not** followed: a `3xx` is a failure.
- Only `404` ever deletes. A misconfigured or failing source (wrong token, outage, timeout) records an issue and leaves existing points alone, so a source outage can never empty the index.
- Failure messages carry the source name and the HTTP status (or `timed out` / `network error (<code>)`), never the URL or header values.
- Callbacks do not draw from the embedding rate limiter; each source is limited only by its own `concurrency`.
- The callback sits on the indexing path for every notification, so keep it fast (one indexed lookup) and available. An outage delays indexing but loses nothing: the next notification or a reindex catches up.

The [SDK](#sdk) exports the `SourceDocument` type and the `SOURCE_DOCUMENT_GONE_STATUS` constant (`404`) for implementing the callback.

---

## The Designated Rule

Every notification names a **designated rule**: `{ "source": "app://chat/thread/6710c3a9", "rule": "chat-thread" }`.

- Only the designated rule is applied to the document. Other rules are not evaluated, even if their `match` would accept it.
- The rule must exist in the watcher's current rule set; otherwise the notification is rejected (`rule_missing`). If the rule disappears later (for example after a config change), processing records a `rule_missing` issue and leaves the points alone.
- The rule's name is stored on every point as `source_rule` and reused by reindex, `POST /render`, `POST /metadata` and `POST /reindex { scope: "path", source }`. Re-notifying a reference with a different rule switches it.
- The rule's `match` is evaluated and acts as the **input contract**: if the retrieved record does not match, nothing is written and a `match_failed` failure is reported with the AJV errors in `details`. A failed match is never an HTTP error on `POST /documents`: asynchronously it becomes a `match_failed` issue, and with `?wait=true` a `failed` result.

### Attributes

Source rules match and resolve against these attributes:

```typescript
interface SourceAttributes {
  source: {
    ref: string; // "app://chat/thread/6710c3a9"
    name: string; // "app"
    id: string; // "chat/thread/6710c3a9"
    rule: string; // designated rule name
    retrievedAt: string; // ISO 8601, server clock
  };
  json: Record<string, unknown>; // the callback body
}
```

There is no `file` key, and file attributes have no `source` key. Write source rules so their `match` requires `source` (and `json`), so the rule can never match a file during normal file processing.

### Example Rule

A record served by the callback:

```json
{
  "threadId": "6710c3a9",
  "userId": "u-123",
  "title": "Resetting a password",
  "updatedAt": "2026-10-12T09:30:00Z",
  "messages": [
    { "role": "user", "text": "How do I reset my password?" },
    { "role": "assistant", "text": "Open Settings, then Security." }
  ]
}
```

A designated rule for it:

```json
{
  "name": "chat-thread",
  "description": "One chat thread from the application.",
  "match": {
    "type": "object",
    "required": ["source", "json"],
    "properties": {
      "source": {
        "type": "object",
        "properties": {
          "name": { "const": "app" },
          "id": { "type": "string", "pattern": "^chat/thread/[^/]+$" }
        }
      },
      "json": {
        "type": "object",
        "required": ["userId", "messages"],
        "properties": {
          "userId": { "type": "string", "minLength": 1 },
          "messages": { "type": "array", "minItems": 1 }
        }
      }
    }
  },
  "schema": [
    {
      "properties": {
        "type": { "type": "string", "set": "chat_thread" },
        "user_id": { "type": "string", "set": "{{json.userId}}" },
        "title": { "type": "string", "set": "{{json.title}}" },
        "updated_at": { "type": "integer", "set": "{{toUnix json.updatedAt}}" }
      }
    }
  ],
  "template": "# {{title}}\n{{#each messages}}\n\n**{{role}}:** {{{text}}}\n{{/each}}\n"
}
```

`set` expressions resolve against the attributes, so they read `json.*`. Named schemas, `map`, `template` and `render` work exactly as for JSON files; see the [Inference Rules Guide](./inference-rules.md).

---

## Rendering

The embedded text is chosen like this:

- **The rule has a `template` or `render`:** its output is embedded and split with the Markdown splitter. The template context holds the JSON record's top-level fields, plus `source` (the identity object above), `json` (the whole record) and the rule's metadata. A record field named `source` is shadowed by the identity object; read it as `json.source`.
- **Neither:** the JSON is extracted and split exactly as a `.json` file would be.

Chunking follows the instance-wide `embedding.chunkSize` and `embedding.chunkOverlap`. A long record becomes several points, all carrying the same `source`; when it shrinks, the surplus chunks are removed.

`POST /render { "source": "..." }` shows the result without writing anything (see the [API Reference](./api-reference.md#post-render)).

> **Dates use host time.** Template and `set` helpers such as `dateFormat` (and `toUnix` on date strings without an offset) use the host's local timezone. Run the watcher with `TZ=UTC` (or another fixed zone) if rendered dates must not depend on the host. See [Deployment](./deployment.md#source-documents).

---

## Processing Outcomes

Each run retrieves the current record and ends in one of four outcomes (the `status` reported by `POST /documents?wait=true`):

| Status | When | Effect |
| --- | --- | --- |
| `indexed` | Content changed (or the document is new); or the content is unchanged but the projected metadata differs. | Content change: re-chunk, re-embed, upsert, remove surplus chunks. Metadata-only change: `setPayload` on every chunk, **no embedding call**. |
| `unchanged` | Same rendered-text hash (`content_hash`) and same metadata. | Nothing written, no embedding call. Clears open issues for the reference, except an `upsert_error` (a partial upsert can leave the new hash on chunk 0, so a matching hash does not prove success). |
| `deleted` | The callback answered `404`. | Points, enrichment metadata and issues for the reference are removed. |
| `failed` | Any failure (see [Issue codes](./api-reference.md#issue-codes)). | Nothing written; points untouched. An issue is recorded under the reference. |

Details:

- A metadata-only change that drops a previously projected property cannot be expressed with `setPayload`, so the document is rewritten in full (re-embedded).
- `created_at` is kept from the existing chunk 0 when present, otherwise set to the processing time; `modified_at` is the processing time. Business dates belong in rule metadata (as `updated_at` in the example).
- Enrichment metadata set with `POST /metadata { source }` is stored under the exact reference and merged on every later run, as for files.
- Issues are keyed by the exact reference in `GET /issues`. A later successful run clears them.

---

## Notifications, Queuing and Coalescing

`POST /documents` validates each notification synchronously and, by default, answers `202` after queuing the accepted references. Processing happens on an in-memory notify queue keyed by reference:

- A notification for a reference that is already **pending** is merged into it (the latest rule wins; the reference keeps its place in line).
- A notification for a reference that is **in flight** marks it dirty: when the current run ends, the reference is processed exactly once more, however many notifications arrived meanwhile.
- Runs for the same reference never overlap, and every run retrieves current state, so a burst of notifications for one reference costs at most two retrievals and the final state always wins.
- Up to `embedding.concurrency` references (default `5`) are processed at once.
- The queue is paused during a prune, like the file event queue.
- The queue is not persisted. On shutdown it is drained for up to `shutdownTimeoutMs`; anything still pending after that is dropped, and new notifications are rejected with `queue_stopped`. Re-notify, or run a reindex, after a restart if that matters.

With `?wait=true`, the same queue processes the notifications (so concurrency and coalescing still apply) and the response carries one result per document. Use it for backfills and tests; the asynchronous path is the normal one, and its failures surface in `GET /issues`.

There is no push mode: the watcher always retrieves content through the callback.

---

## Reindex, Prune and Deletion

Reindex discovers source documents from Qdrant (chunk-0 points carrying `source` and `source_rule`). A document that was never notified is never found: notifications are the only entry point, as filesystem events are for files.

| `POST /reindex` scope | Source documents |
| --- | --- |
| `full` | Every indexed source document is retrieved and **re-embedded**, even when its content is unchanged. |
| `rules` (no `path`) | Every indexed source document is retrieved and its stored rule re-applied. Unchanged content: metadata is updated with `setPayload`, no embedding call. If the rule now renders different text, the document is re-embedded. |
| `rules` with `path` | Files only. |
| `issues` | Source references with open issues whose documents are indexed (their stored rule is known). |
| `path` with `source` | The listed references, re-processed with their stored rule through the notify queue. References that are not indexed are skipped. |
| `prune` | Never selects source points. Prune only deletes file points. |

Retrieval outcomes are the same in every scope: `404` deletes the document; any other failure records an issue and leaves its points untouched. Source documents are retrieved with up to `reindex.concurrency` documents in flight, each source still capped by its own `concurrency`.

A **config-triggered** reindex (`configWatch.reindex`) covers files only. To re-apply changed rules to source documents, call `POST /reindex` explicitly (`rules` or `full`).

To remove source documents, use `POST /documents/delete` with explicit references or a Qdrant filter. The filter is always constrained to points carrying `source`, so it can never delete a file point. See the [API Reference](./api-reference.md#post-documentsdelete).

---

## Indexes and Multi-Tenant Search

The watcher always creates `keyword` payload indexes on `source` and `source_rule`. When many users' documents share one collection, index the tenant field as well and filter on it in every search:

```json
{
  "vectorStore": {
    "url": "http://localhost:6333",
    "collectionName": "app_documents",
    "payloadIndexes": [
      { "field": "user_id", "type": "keyword", "isTenant": true },
      { "field": "updated_at", "type": "integer", "isPrincipal": true }
    ]
  }
}
```

See [`vectorStore.payloadIndexes`](./configuration.md#payload-indexes). The watcher does not know who the end user is: the calling application is responsible for adding the tenant filter to every search.

---

## Securing the API

When the API is reachable from another host, set `api.apiKey`. Every route except `GET /status` then requires `Authorization: Bearer <key>`. See [API Authentication](./api-reference.md#authentication).

---

## SDK

[`@karmaniverous/jeeves-watcher-sdk`](https://github.com/karmaniverous/jeeves-watcher/tree/main/packages/sdk#readme) is a thin, typed TypeScript client for the application-facing API (`status`, `search`, `scan`, `render`, `metadata`, `reindex`, `issues`, `documents.notify`, `documents.delete`), plus the callback-contract types. Request and response types come from `@karmaniverous/jeeves-watcher-core`, the same schemas the service validates with.

```ts
import { createWatcherClient, f } from '@karmaniverous/jeeves-watcher-sdk';

const watcher = createWatcherClient({
  baseUrl: 'http://watcher.internal.example:1936',
  apiKey: process.env.WATCHER_API_KEY,
});

await watcher.documents.notify([
  { source: `app://chat/thread/${threadId}`, rule: 'chat-thread' },
]);

const hits = await watcher.search({
  query: 'password reset',
  limit: 8,
  filter: f.and(f.eq('type', 'chat_thread'), f.eq('user_id', userId)),
});
```

---

## Next Steps

- [API Reference](./api-reference.md) — `POST /documents`, `POST /documents/delete` and the source forms of `/render`, `/metadata` and `/reindex`
- [Configuration Reference](./configuration.md) — `sources`, `api.apiKey`, `vectorStore.payloadIndexes` and rate limiting
- [Inference Rules](./inference-rules.md) — schemas, `set`, `map`, templates
- [Deployment](./deployment.md#source-documents) — operating a watcher that serves source documents
