---
name: jeeves-watcher
description: >
  Semantic search and metadata enrichment via a jeeves-watcher instance.
  Discover record types and filterable fields at runtime via config introspection.
---

# Jeeves Watcher — Context Discovery (Inference Rules v2)

## Behavioral Directive

Use **`watcher_search`** first when you need to find relevant files or prior context.

When you need to **understand what fields exist**, **what types they are**, or **which filters are valid**, do not guess and do not rely on a flat payload-field dump. Instead, use config introspection:
- `watcher_query` to discover rule names/descriptions and retrieve schemas
- `watcher_schema` when you need the full JSON Schema for the merged virtual document

If search results are empty or low-signal, fall back to filesystem browsing. Not everything is indexed.

---

## Workflow

### 1) Orientation (once per session)

Build a mental model of the deployment (organization + score thresholds + available record types).

Recommended (two calls):

1. Query organizational context and score thresholds:
```json
{ "path": "$.['description','search']" }
```

2. List available record types (inference rules):
```json
{ "path": "$.inferenceRules[*].['name','description']" }
```

Notes:
- The **top-level `description`** explains how this watcher deployment is organized.
- Each rule’s **`description`** explains what that record type represents.

### 2) Query planning (per search task)

1. Identify the relevant rule(s) by name.
2. Retrieve the fully-resolved schema for those rules:
```json
{
  "path": "$.inferenceRules[?(@.name=='<rule>')].schema",
  "resolve": ["files","globals"]
}
```

3. For `select` / `multiselect` fields without `enum`, query the runtime values index:
```json
{ "path": "$.inferenceRules[?(@.name=='<rule>')].values.<field>" }
```

If search results span multiple rules (see `matched_rules` in result payload), query each unique rule’s schema and combine mentally.

### 3) uiHint → Qdrant filter mapping

Use `uiHint` from schema to choose the correct Qdrant filter construction:

| uiHint | Qdrant filter | Notes |
|---|---|---|
| text | `{ "key": "<field>", "match": { "text": "<value>" } }` | substring/token match |
| select | `{ "key": "<field>", "match": { "value": "<enum_value>" } }` | exact match |
| multiselect | `{ "key": "<field>", "match": { "value": "<enum_value>" } }` | any-element match on array |
| date | `{ "key": "<field>", "range": { "gte": <unix_ts>, "lt": <unix_ts> } }` | open-ended ok |
| number | `{ "key": "<field>", "range": { "gte": <n>, "lte": <n> } }` | open-ended ok |
| check | `{ "key": "<field>", "match": { "value": true } }` | boolean match |
| (absent) | do not filter | internal/not intended |

Compose conditions using Qdrant combinators:
- `must` (AND)
- `should` (OR)
- `must_not` (exclude)

### 4) Search execution

Plain semantic search is often sufficient:
```json
{ "query": "authentication flow", "limit": 10 }
```

Add filters to narrow when necessary.

Search results include watcher-managed system fields:
- `file_path`, `chunk_index`, `total_chunks`, `chunk_text`, `content_hash`
- `matched_rules` (inference rules that produced the metadata)

All other payload fields are config-defined via inference rule schemas.

### 5) Path testing

When unsure whether a file is watched or which rules match it:
```json
{ "paths": ["j:/domains/jira/VCN/issue/WEB-123.json"] }
```

The response returns ordered matching rule names and `watched` scope status.

### 6) Diagnostics

If expected content is missing, check current embedding issues:
- Use `watcher_issues` to see the live issues list
- Issues are self-healing: successful reprocessing clears entries

---

## Tools

### `watcher_status`
Health/uptime and collection stats.

### `watcher_search`
Semantic search with optional Qdrant filter.

### `watcher_enrich`
Set/update metadata on a document by file path.

### `watcher_schema`
Get the JSON Schema for the merged virtual document returned by `watcher_query`.

### `watcher_query`
JSONPath query over the merged virtual document (authored config + runtime values). Optional `resolve`:
- `resolve: ["files"]` resolve file references
- `resolve: ["globals"]` expand named schema references
- `resolve: ["files","globals"]` fully inline

### `watcher_match`
Server-evaluated path testing against inference rules and watch scope.

### `watcher_issues`
Get current embedding issues.

---

## References

- JSONPath syntax: https://www.npmjs.com/package/jsonpath-plus
- Qdrant filtering: https://qdrant.tech/documentation/concepts/filtering/
