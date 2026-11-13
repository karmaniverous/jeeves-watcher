---
title: Facets
---

# Facets

A facet is a payload field a search UI (or an agent) offers as a filter: "status is Open", "created in March", "tag is billing". The watcher declares facets in inference rule schemas, lists them with [`GET /search/facets`](./api-reference.md#get-searchfacets) (`listFacets`), counts them with [`POST /search/facets/counts`](./api-reference.md#post-searchfacetscounts) (`countFacets`), and filters on them in [`POST /search`](./api-reference.md#post-search) and [`POST /scan`](./api-reference.md#post-scan). This guide follows one field from the rule to the filter.

## What makes a field a facet

A property of a rule's resolved schema is a facet field when it declares a `uiHint` or an `enum` and its type is not `object`. Nothing else is listed: a property without either is metadata, not a filter. An `enum` without a `uiHint` is a `dropdown`.

The hint says how the field is offered and answered. These are the hints the service understands, exported once by watcher-core as `UI_HINTS` (with `ENUMERATED_UI_HINTS`, `RANGE_UI_HINTS` and `OTHER_UI_HINTS`):

<!-- ui-hints:start -->

| `uiHint` | `listFacets` values | `countFacets` answer | Qdrant filter | Typical use |
| --- | --- | --- | --- | --- |
| `dropdown` | `enum`, else recorded values | value counts | `{ "key": "<field>", "match": { "value": "<value>" } }` | One value from a list (the hint of an `enum` without one) |
| `tags` | `enum`, else recorded values | value counts | `{ "key": "<field>", "match": { "any": ["<value>", "..."] } }` | Array field: labels, tags |
| `select` | `enum`, else recorded values | value counts | `{ "key": "<field>", "match": { "value": "<value>" } }` | One value from a list |
| `multiselect` | `enum`, else recorded values | value counts | `{ "key": "<field>", "match": { "any": ["<value>", "..."] } }` | Several values from a list, or an array field |
| `number` | `enum`, else none | `{ min, max }` | `{ "key": "<field>", "range": { "gte": 1, "lte": 9 } }` | Numbers: sizes, scores |
| `date` | `enum`, else none | `{ min, max }` | `{ "key": "<field>", "range": { "gte": 1767225600 } }` (seconds), or ISO bounds on a `datetime` index | Dates (see [Dates](#dates)) |
| `range` | `enum`, else none | `{ min, max }` | `{ "key": "<field>", "range": { "gte": 1, "lt": 10 } }` | Any ordered field shown as a slider |
| `text` | `enum`, else none | value counts | `{ "key": "<field>", "match": { "text": "<words>" } }` (needs a `text` index) | Free text |
| `check` | `enum`, else none | value counts | `{ "key": "<field>", "match": { "value": true } }` | Booleans |

<!-- ui-hints:end -->

- **`listFacets` values**: the `enum` when the property declares one; otherwise, for the four list hints, the values recorded for the rule's documents (the [values index](#the-values-index)); otherwise `[]`.
- **`countFacets` answer**: when every rule in scope that declares the field gives the same hint. When they disagree, or no rule gives one, the field's payload index type decides (`keyword`, `bool`, `integer` are counted; `float`, `datetime` give a range).
- **Any other hint** still loads, and is answered like `text`: no recorded values, value counts. The service logs a warning naming the rule, the property and the hint at start, at each config reload and when a rule is registered, so a typo such as `selct` is found.

## End to end

**1. Declare the fields in a rule.** Each facet is a schema property with a `uiHint` (or an `enum`) and a `set` expression that fills it:

```json
{
  "inferenceRules": [
    {
      "name": "ticket",
      "description": "Support tickets",
      "match": { "properties": { "json": { "required": ["ticketId"] } } },
      "schema": [
        {
          "properties": {
            "tenant": { "type": "string", "set": "{{json.tenant}}" },
            "status": {
              "type": "string",
              "enum": ["Open", "Pending", "Done"],
              "set": "{{json.status}}"
            },
            "labels": {
              "type": "array",
              "uiHint": "tags",
              "set": "{{json json.labels}}"
            },
            "created": {
              "type": "integer",
              "uiHint": "date",
              "set": "{{toUnix json.created}}"
            }
          }
        }
      ]
    }
  ]
}
```

`labels` is an array: the `json` helper writes it as JSON, which the `array` type reads back. `tenant` has neither `uiHint` nor `enum`, so it is not a facet: it is the filter the application always applies (see [Several tenants](#several-tenants)).

**2. Index every facet field.** Counting needs a [payload index](./configuration.md#payload-indexes) on each field: `keyword`, `integer` or `bool` for value counts; `integer`, `float` or `datetime` for a range. Index the tenant field too, as `isTenant`:

```json
{
  "vectorStore": {
    "payloadIndexes": [
      { "field": "tenant", "type": "keyword", "isTenant": true },
      { "field": "status", "type": "keyword" },
      { "field": "labels", "type": "keyword" },
      { "field": "created", "type": "integer" }
    ]
  }
}
```

Indexes are created at the next start, never on a reload. At start and at each config reload the service logs a warning for every facet field of the configured rules with no payload index (`countFacets` answers `400` for it). It never creates one for you.

**3. List the facets.** `GET /search/facets?rules=ticket` answers each field with its type, hint, rules and values:

```json
{
  "facets": [
    {
      "field": "status",
      "type": "string",
      "uiHint": "dropdown",
      "values": ["Open", "Pending", "Done"],
      "rules": ["ticket"]
    },
    {
      "field": "labels",
      "type": "array",
      "uiHint": "tags",
      "values": ["billing", "login"],
      "rules": ["ticket"]
    },
    {
      "field": "created",
      "type": "integer",
      "uiHint": "date",
      "values": [],
      "rules": ["ticket"]
    }
  ]
}
```

**4. Count under the user's scope.** `POST /search/facets/counts` counts each document once (not each chunk) under your filter:

```json
{
  "filter": { "must": [{ "key": "tenant", "match": { "value": "acme" } }] },
  "rules": ["ticket"],
  "fields": ["status", "labels", "created"]
}
```

```json
{
  "counts": {
    "status": [
      { "value": "Open", "count": 41 },
      { "value": "Done", "count": 12 }
    ],
    "labels": [{ "value": "billing", "count": 30 }],
    "created": { "min": 1767225600, "max": 1772409600 }
  }
}
```

**5. Filter on the user's choices.** Build one condition per chosen facet from the table above, and add them to the tenant filter in `must`:

```json
{
  "query": "refund not received",
  "filter": {
    "must": [
      { "key": "tenant", "match": { "value": "acme" } },
      { "key": "status", "match": { "value": "Open" } },
      { "key": "labels", "match": { "any": ["billing"] } },
      { "key": "created", "range": { "gte": 1769904000 } }
    ]
  }
}
```

From the SDK the same steps are `listFacets({ rules })`, `countFacets({ fields, filter, rules })` and `search({ query, filter })` (see the [SDK guide](../../sdk/guides/sdk-guide.md)); from the OpenClaw plugin, the `watcher_list_facets`, `watcher_count_facets` and `watcher_search` tools.

## Dates

A date facet is stored one of two ways. Pick one per field and keep it.

|  | Unix seconds | ISO strings |
| --- | --- | --- |
| Schema | `"type": "integer"`, `"set": "{{toUnix json.created}}"` | `"type": "string"`, `"set": "{{json.created}}"` (an ISO 8601 / RFC 3339 string) |
| Payload index | `integer` | `datetime` |
| `countFacets` range | `{ "min": 1767225600, "max": 1772409600 }` | `{ "min": "2026-01-01T00:00:00Z", "max": "2026-03-02T00:00:00Z" }` (the stored strings) |
| Filter | `{ "range": { "gte": 1767225600, "lt": 1769904000 } }` | `{ "range": { "gte": "2026-01-01T00:00:00Z", "lt": "2026-02-01T00:00:00Z" } }` |

- **Unix seconds** are the convention of the bundled rules and the skill: one numeric type, easy arithmetic ("the last 7 days" is `now - 604800`), and `toUnix` normalises whatever the source sends. Use them unless you have a reason not to. `toUnix` reads a date string without an offset in the host's timezone: run the service with `TZ=UTC` (see [Deployment](./deployment.md)).
- **ISO strings** keep the source's own value and read well in payloads; Qdrant compares them as dates on a `datetime` index. Use them when other systems read the same payloads as strings.

## Several tenants

The values index is kept **per rule, never per tenant**: `listFacets` returns every value any tenant's documents have produced for that rule. A UI serving several tenants must not offer those lists as they are, or one tenant sees another's values.

Fill a multi-tenant UI's value lists from `countFacets` under the tenant filter instead: its answer holds only values present in that tenant's documents, with their counts. Use `listFacets` for the field definitions (which fields, which hints) and for declared `enum` values, which hold no tenant data.

## The values index

The values `listFacets` returns for a list hint without an `enum` are recorded as documents are embedded, per rule (`values.v8` in the state directory). Two limits:

- **Values are never removed when documents go.** A value whose last document was deleted or changed stays listed. A `full` reindex clears the values index and records it again from the documents that remain.
- **Source documents never feed it** (see [Source Documents](./source-documents.md)). Use `countFacets` for their values.

`countFacets` reads Qdrant on every request and has neither limit.

## Counts

- **Approximate.** Value counts come from Qdrant's approximate facet counts (D194: exact counts were too slow at production size). Treat them as sizes for a UI. For an exact count of one value, use `POST /scan` with `countOnly` and `{ "key": "chunk_index", "match": { "value": 0 } }` in the filter. Ranges are exact.
- **`503 WATCHER_NOT_AVAILABLE`** while the `chunk_index` system index builds (after the first 0.21.0 start), with `rules` while `matched_rules` builds, and when the counts exceed their 10 s budget (count fewer fields or narrow the filter). Retry later; `GET /status` shows the system index states.
- **`400 WATCHER_INVALID_REQUEST`** names the fields with no usable payload index.

## Warnings

| Warning | When | Fix |
| --- | --- | --- |
| `Rule "<rule>" property "<property>" has an unknown uiHint ...` | Start, config reload (configured rules), rule registration (the registered rules) | Use one of the hints above |
| `Facet field "<field>" has no payload index ...` | Start and config reload (configured rules) | Add it to `vectorStore.payloadIndexes` and restart |
| `Could not read the payload indexes to check the facet fields` | The vector store could not be read at a reload | None needed; the check runs again at the next start or reload |

The warnings never stop a start or a reload, and the service never adds an index itself.
