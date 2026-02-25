## Qdrant Filter Syntax

Filters use Qdrant's native JSON filter format, passed as the `filter` parameter to `watcher_search`.

### Basic Patterns

**Match exact value:**
```json
{ "must": [{ "key": "domain", "match": { "value": "email" } }] }
```

**Match text (full-text search within field):**
```json
{ "must": [{ "key": "chunk_text", "match": { "text": "authentication" } }] }
```

**Combine conditions (AND):**
```json
{
  "must": [
    { "key": "domain", "match": { "value": "jira" } },
    { "key": "status", "match": { "value": "In Progress" } }
  ]
}
```

**Exclude (NOT):**
```json
{
  "must_not": [{ "key": "domain", "match": { "value": "repos" } }]
}
```

**Any of (OR):**
```json
{
  "should": [
    { "key": "domain", "match": { "value": "email" } },
    { "key": "domain", "match": { "value": "slack" } }
  ]
}
```

**Nested (combine AND + NOT):**
```json
{
  "must": [{ "key": "domain", "match": { "value": "jira" } }],
  "must_not": [{ "key": "status", "match": { "value": "Done" } }]
}
```

### Key Differences
- `match.value` — exact match (case-sensitive, for keyword fields like `domain`, `status`)
- `match.text` — full-text match (for text fields like `chunk_text`)
