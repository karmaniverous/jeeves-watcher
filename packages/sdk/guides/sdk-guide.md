---
title: SDK Guide
---

# SDK Guide

`@karmaniverous/jeeves-watcher-sdk` is a typed client for the watcher's HTTP API. Since 0.3.0 it is jeeves's catalog client over the watcher's endpoint catalog (`WATCHER_CATALOG` in `@karmaniverous/jeeves-watcher-core`): every route is a method, inputs and responses are checked against the route's Zod schemas, and every failure is a `WatcherError`.

## Creating a client

```ts
import { createWatcherClient } from '@karmaniverous/jeeves-watcher-sdk';

const watcher = createWatcherClient({
  baseUrl: 'http://watcher.internal.example:1936',
  apiKey: process.env.WATCHER_API_KEY, // the service's api.apiKey; never sent to status
  timeoutMs: 10_000, // default
});
```

`baseUrl` may carry a path prefix but no query string or fragment. Pass `fetch` to use a custom agent or a test double; it must return real `Response` objects. A bad option throws `WatcherError` `invalid_options`.

## Methods

The client has one method per catalog entry, named by the entry (D77): each name is also the route's OpenAPI `operationId` and, as `watcher_<name in snake_case>`, its plugin tool. The two source-document entries form the `documents` group.

| Method | Route | Kind |
| --- | --- | --- |
| `status()` | `GET /status` (no key) | read |
| `config({ path? })` | `GET /config` | read |
| `configApply({ patch, replace? })` | `POST /config/apply` | write |
| `getConfigSchema()` | `GET /config/schema` | read |
| `matchConfig({ paths })` | `POST /config/match` | read |
| `validateConfig({ config?, testPaths? })` | `POST /config/validate` | read |
| `search({ query, ... })` | `POST /search` | read |
| `scan({ filter, ... })` | `POST /scan` | read |
| `listFacets({ rules? })` | `GET /search/facets` | read |
| `countFacets({ fields, filter?, rules?, limit? })` | `POST /search/facets/counts` | read |
| `render({ path } \| { source })` | `POST /render` | read |
| `walk({ globs })` | `POST /walk` | read |
| `listIssues()` | `GET /issues` | read |
| `setMetadata({ path \| source, metadata })` | `POST /metadata` | write |
| `reindex({ scope?, path?, dryRun? })` | `POST /reindex` | write |
| `registerRules({ source, rules })` | `POST /rules/register` | write |
| `reapplyRules({ globs })` | `POST /rules/reapply` | write |
| `rebuildMetadata({})` | `POST /rebuild-metadata` | write |
| `unregisterRules({ source })` | `DELETE /rules/unregister` | destructive |
| `unregisterRulesBySource({ source })` | `DELETE /rules/unregister/:source` | destructive |
| `deletePoints({ filter })` | `POST /points/delete` | destructive |
| `getVcsStatus()` | `GET /vcs/status` | read |
| `listVcsHistory({ glob, since?, until?, limit? })` | `GET /vcs/history` | read |
| `showVcsFile({ path, commit })` | `GET /vcs/show` (text) | read |
| `diffVcs({ glob, commit, commitEnd? })` | `GET /vcs/diff` (text) | read |
| `checkVcsExclusion({ path })` | `GET /vcs/check-exclusion` | read |
| `revertVcs({ glob, commit, existingOnly? })` | `POST /vcs/revert` | destructive |
| `excludeVcsPath({ glob, root?, remove?, confirm? })` | `POST /vcs/exclude` | destructive |
| `documents.notify(documents, { wait? })` | `POST /documents` | write |
| `documents.delete({ sources } \| { filter })` | `POST /documents/delete` | destructive |

Request and response types are inferred from the catalog's schemas, so they always match the service the catalog describes. A method whose input has no required field can be called without one (`watcher.listIssues()`, `watcher.reindex()`).

**Inputs are in their wire form.** Query fields are strings, as they travel: `listVcsHistory({ glob: '/data/docs/**', limit: '20' })`. Bodies are JSON values.

**Responses are parsed** by the entry's response schema; fields a newer service adds are dropped. A new enum value from a newer service fails validation (`invalid_response`) until the SDK is upgraded: upgrade the SDK with the service. `showVcsFile` and `diffVcs` resolve with the raw text.

The VCS methods answer `WATCHER_NOT_FOUND` while version control is off (`vcs.enabled: false`).

`excludeVcsPath` resolves with one of two shapes (service 0.22.0+): the written exclusion `{ ok, file, action, untracked }`, or, when more than 100 files would be untracked and `confirm` is not `true`, `{ confirmRequired: true, untracked }` with nothing written. Check `'confirmRequired' in result`, confirm the count with the user, then call again with `confirm: true`.

**Types of inputs and outputs** follow from the client: `Parameters<WatcherClient['excludeVcsPath']>[0]` is the input of `excludeVcsPath`, `Awaited<ReturnType<WatcherClient['excludeVcsPath']>>` its result.

## Source documents

```ts
await watcher.documents.notify([
  { source: 'app://chat/thread/123', rule: 'chat-thread' },
]);
```

`notify` resolves with the `202` body: the accepted references and the notifications the server rejected synchronously (a malformed reference, an unknown rule). The watcher then retrieves each document through its source callback; processing failures show up in `listIssues()`.

`notify(documents, { wait: true })` processes synchronously and resolves with one result per document. It is not bounded on the server: it returns when every document has been processed, which can take minutes behind document locks and embedding rate limits (D137). Use it for backfill and tests, with a `timeoutMs` sized for the batch.

`documents.delete({ sources })` or `documents.delete({ filter })` removes source documents (never file points). A filter without a condition is refused before sending.

## Errors

Every method throws `WatcherError` (`isWatcherError(e)` narrows):

| `code` | When | `status` |
| --- | --- | --- |
| the server's `code` (`WATCHER_INVALID_REQUEST`, `WATCHER_NOT_FOUND`, `WATCHER_NOT_AVAILABLE`, `WATCHER_UNAUTHORIZED`, ..., `FST_ERR_VALIDATION`, `JEEVES_CONFIG_INVALID`, ...) | a non-2xx reply carrying one | the HTTP status |
| `http_<status>` | a non-2xx reply without a code (a masked `500`, a proxy) | the HTTP status |
| `invalid_request` | the input failed the entry's request schema; nothing was sent | none |
| `invalid_response` | a 2xx reply that is not JSON or fails the response schema | the HTTP status when parsed |
| `timeout` | no reply within `timeoutMs` | none |
| `network_error` | the request could not be sent or the connection failed | none |
| `invalid_options` | `createWatcherClient` options are invalid | none |

A 0.22.0+ server answers every error with Fastify's standard body `{ statusCode, code?, error, message }`; `WATCHER_ERROR_CODES` (exported, type `WatcherErrorCode`) lists the watcher's own codes. `message` is the server's `message` or the SDK's description; `details` carries the whole server body or the Zod issues. The SDK's own codes are lower case, so they never collide with a server code.

**`retryAfterMs`** is the delay the server asked for (`Retry-After`, sent with `503 WATCHER_NOT_AVAILABLE` when a root's git lock or a document lock stays busy, and with `503 WATCHER_EMBEDDING_UNAVAILABLE` when the provider's back-off is known), in milliseconds, clamped to 0..`MAX_RETRY_AFTER_MS` (3,600,000, exported). The SDK never retries: wait at least that long before calling again.

## Timeouts and state changes

The default timeout is 10 s. Some calls wait inside the service longer than that: `excludeVcsPath` and `revertVcs` wait up to 30 s for the root's git lock, and `notify(..., { wait: true })` processes the whole batch. Raise `timeoutMs` for them (the CLI uses 60 s).

**A timeout does not cancel the operation** (D119). The service keeps running a state-changing call after the client gives up, so a timed-out `excludeVcsPath`, `revertVcs`, `setMetadata` or `documents.notify` may still complete. Check before retrying: `checkVcsExclusion` for an exclusion, `listVcsHistory` or `getVcsStatus` for a revert, `listIssues` or a `search` for documents.

## Filters

`f` builds Qdrant filters for `search`, `scan`, `deletePoints` and `documents.delete`:

```ts
import { f } from '@karmaniverous/jeeves-watcher-sdk';

await watcher.scan({
  filter: f.and(f.eq('type', 'chat_thread'), f.eq('user_id', userId)),
});
```

## Facets

`listFacets` gives the facet fields of the rules (a property with a `uiHint` or `enum`), `countFacets` their document counts under a filter, and `f` the filter for the user's choices. A multi-tenant application fills its value lists from `countFacets` under the tenant filter, because `listFacets` values are recorded per rule, never per tenant:

```ts
const tenant = f.eq('tenant', tenantId);

// The facet fields, their hints and declared values (for the UI controls).
const { facets } = await watcher.listFacets({ rules: 'ticket' });

// Count the fields that have a counting payload index: 1 to 20 per call, and
// one field without an index fails the whole call with 400.
const { counts } = await watcher.countFacets({
  fields: ['status', 'created'],
  filter: tenant,
  rules: ['ticket'],
});
// counts.status: [{ value: 'Open', count: 41 }, ...]; counts.created: { min, max }

const results = await watcher.search({
  query: 'refund not received',
  filter: f.and(
    tenant,
    f.eq('status', 'Open'),
    f.range('created', { gte: 1769904000 }),
  ),
});
```

Each counted field needs a payload index (`keyword`, `bool` or `integer` for value counts; `float`, `datetime` or `integer` for a range), so pick the fields to count rather than passing every facet. The [Facets guide](../../service/guides/facets.md) has the `uiHint` table (which hints count values and which give a range, and the filter for each), the date conventions and the rest.
