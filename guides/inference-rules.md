---
title: Inference Rules
---

# Inference Rules

The inference rules engine automatically enriches document metadata based on file attributes. Rules are config-driven — no domain-specific logic is hardcoded in the watcher.

## Overview

When a file is processed, the watcher:

1. **Collects attributes** from the file (path, size, modified date, frontmatter, JSON content)
2. **Evaluates rules** against these attributes using JSON Schema matching
3. **Merges metadata** from all matching rules (later rules override earlier ones)
4. **Applies enrichment** from `POST /metadata` API (overrides everything)

This creates a flexible, declarative metadata pipeline.

---

## Rule Structure

Each inference rule has three parts:

```json
{
  "match": { /* JSON Schema */ },
  "set": { /* Metadata to apply */ },
  "map": { /* Optional JsonMap transform (inline or named reference) */ }
}
```

- **`match`**: A JSON Schema object that the file attributes must satisfy
- **`set`**: Key-value pairs to merge into the document metadata
- **`map`** (optional): A [JsonMap](https://github.com/karmaniverous/jsonmap) definition (or a string reference to a named map)

---

## Attributes Object

The watcher builds an attributes object for each file:

```typescript
interface FileAttributes {
  file: {
    path: string;           // Normalized path (forward slashes, lowercase drive)
    directory: string;      // Directory containing the file
    filename: string;       // File name with extension
    extension: string;      // Extension including dot (e.g., ".md")
    sizeBytes: number;      // File size in bytes
    modified: string;       // ISO-8601 timestamp of last modification
  };
  frontmatter?: Record<string, unknown>;  // YAML frontmatter from .md files
  json?: Record<string, unknown>;         // Parsed content from .json files
}
```

**Example** (for `d:/meetings/2026-02-20/transcript.md`):

```json
{
  "file": {
    "path": "d:/meetings/2026-02-20/transcript.md",
    "directory": "d:/meetings/2026-02-20",
    "filename": "transcript.md",
    "extension": ".md",
    "sizeBytes": 4523,
    "modified": "2026-02-20T08:15:00Z"
  },
  "frontmatter": {
    "title": "Architecture Discussion",
    "author": "jeeves",
    "participants": ["Jason", "Devin"]
  }
}
```

---

## Matching with JSON Schema

Rules use standard **JSON Schema** for matching. The watcher uses [ajv](https://ajv.js.org/) with full support for:

- `properties`, `required`, `type`, `const`, `enum`
- Nested object matching
- Arrays and string patterns
- Custom `glob` format for path matching

### Example: Match by Path Pattern

```json
{
  "match": {
    "properties": {
      "file": {
        "properties": {
          "path": { "type": "string", "glob": "d:/meetings/**" }
        },
        "required": ["path"]
      }
    }
  },
  "set": {
    "domain": "meetings"
  }
}
```

**Matches**: Any file under `d:/meetings/` (recursively).

**Sets**: `{ "domain": "meetings" }`

---

## Custom `glob` Format

The watcher registers a custom `glob` keyword for path matching using [picomatch](https://github.com/micromatch/picomatch):

```json
{
  "file": {
    "properties": {
      "path": { "type": "string", "glob": "**/projects/**/*.md" }
    }
  }
}
```

**Glob syntax:**
- `**` — matches any number of directories
- `*` — matches any characters within a segment
- `{md,txt}` — brace expansion for multiple patterns

This is the **only custom format** — everything else is pure JSON Schema.

---

## JsonMap Transformations (`map`)

In addition to static `set` values, rules can run a **JsonMap** transform to derive metadata from the file attributes.

- `map` can be an **inline JsonMap** object, or a **string reference** to a named map defined in top-level config `maps`.
- When a rule matches, `set` is applied first, then `map` is executed.
- **Merge order:** `map` output overrides `set` output on field conflict.

### Example: Inline `map` extracts a path segment

```json
{
  "match": { "type": "object" },
  "set": { "domain": "docs" },
  "map": {
    "project": {
      "$": [
        { "method": "$.lib.split", "params": ["$.input.file.path", "/"] },
        { "method": "$.lib.slice", "params": ["$[0]", 0, 1] },
        { "method": "$.lib.join", "params": ["$[0]", ""] }
      ]
    }
  }
}
```

For a file path `docs/readme.md`, this produces:

```json
{ "domain": "docs", "project": "docs" }
```

### Example: Named map reference

```json
{
  "maps": {
    "extractProject": {
      "project": {
        "$": [
          { "method": "$.lib.split", "params": ["$.input.file.path", "/"] },
          { "method": "$.lib.slice", "params": ["$[0]", 0, 1] },
          { "method": "$.lib.join", "params": ["$[0]", ""] }
        ]
      }
    }
  },
  "inferenceRules": [
    {
      "match": { "type": "object" },
      "set": {},
      "map": "extractProject"
    }
  ]
}
```

If a rule references a missing named map, the watcher warns and skips the map.

## Template Interpolation in `set`

The `set` object supports template variables referencing the attributes object:

```json
{
  "set": {
    "title": "${frontmatter.title}",
    "author": "${frontmatter.author}",
    "directory": "${file.directory}"
  }
}
```

**Template syntax:**
- `${path.to.field}` — resolves against the attributes object
- Handles nested properties (e.g., `${frontmatter.participants}`)
- Returns empty string if the path is undefined

**Example:**

For a file with:

```json
{
  "frontmatter": {
    "title": "Meeting Notes",
    "author": "jeeves"
  }
}
```

The `set` resolves to:

```json
{
  "title": "Meeting Notes",
  "author": "jeeves",
  "directory": "d:/meetings/2026-02-20"
}
```

---

## Rule Evaluation Order

Rules are evaluated **in order** — later rules override earlier ones on field conflict:

```json
{
  "inferenceRules": [
    {
      "match": { /* all files */ },
      "set": { "category": "general" }
    },
    {
      "match": {
        "properties": {
          "file": {
            "properties": {
              "path": { "glob": "**/important/**" }
            }
          }
        }
      },
      "set": { "category": "important" }  // Overrides "general"
    }
  ]
}
```

Files under `**/important/**` get `category: "important"` (second rule wins).

---

## Practical Examples

### 1. Domain Classification by Directory

```json
{
  "inferenceRules": [
    {
      "match": {
        "properties": {
          "file": {
            "properties": {
              "path": { "glob": "d:/email/archive/**" }
            }
          }
        }
      },
      "set": { "domain": "email" }
    },
    {
      "match": {
        "properties": {
          "file": {
            "properties": {
              "path": { "glob": "d:/meetings/**" }
            }
          }
        }
      },
      "set": { "domain": "meetings" }
    },
    {
      "match": {
        "properties": {
          "file": {
            "properties": {
              "path": { "glob": "d:/projects/**" }
            }
          }
        }
      },
      "set": { "domain": "projects" }
    }
  ]
}
```

### 2. Extract Frontmatter Fields

```json
{
  "match": {
    "properties": {
      "frontmatter": {
        "required": ["title"]
      }
    }
  },
  "set": {
    "title": "${frontmatter.title}"
  }
}
```

If the Markdown file has a YAML frontmatter block with a `title` field, it's extracted into the Qdrant payload.

### 3. Extract JSON Fields

```json
{
  "match": {
    "properties": {
      "json": {
        "required": ["participants"]
      }
    }
  },
  "set": {
    "participants": "${json.participants}"
  }
}
```

For JSON files with a `participants` array, it's copied to the payload.

### 4. Label PDF Files

```json
{
  "match": {
    "properties": {
      "file": {
        "properties": {
          "extension": { "const": ".pdf" }
        }
      }
    }
  },
  "set": {
    "labels": ["binary/pdf"]
  }
}
```

All `.pdf` files get a `labels` array with `"binary/pdf"`.

### 5. Tag Large Files

```json
{
  "match": {
    "properties": {
      "file": {
        "properties": {
          "sizeBytes": { "type": "number", "minimum": 1000000 }
        }
      }
    }
  },
  "set": {
    "labels": ["large-file"]
  }
}
```

Files larger than 1MB get labeled `"large-file"`.

### 6. Combine Multiple Conditions

```json
{
  "match": {
    "properties": {
      "file": {
        "properties": {
          "path": { "glob": "d:/projects/**" },
          "extension": { "const": ".md" }
        },
        "required": ["path", "extension"]
      }
    }
  },
  "set": {
    "domain": "projects",
    "category": "documentation"
  }
}
```

Matches Markdown files under `d:/projects/` and sets both `domain` and `category`.

---

## Metadata Priority

Metadata is derived in layers:

1. **Inference rules** — applied in order, later rules override earlier ones
2. **API enrichment** — `POST /metadata` overrides everything

**Example:**

```json
// Inference rule
{ "set": { "title": "Untitled", "domain": "meetings" } }

// POST /metadata
{ "title": "Architecture Discussion" }

// Final payload
{ "title": "Architecture Discussion", "domain": "meetings" }
```

The API enrichment wins for `title`, but `domain` (not provided via API) comes from the inference rule.

---

## Config Change Handling

When you edit `inferenceRules` in the config file (and `configWatch.enabled` is `true`):

1. The watcher reloads and validates the config
2. Rules are recompiled
3. A **scoped metadata reindex** is triggered (only files matching changed rules)
4. No re-embedding occurs — just metadata upserts to Qdrant

**Debounce:** Config changes are debounced for `configWatch.debounceMs` (default: 10 seconds) to allow editing multiple rules before triggering reindex.

**Pause/resume reindex:**

```bash
# Pause auto-reindex while editing rules
curl -X POST http://localhost:3456/config-reindex -d '{"action": "pause"}'

# Resume (diffs all accumulated changes, single scoped reindex)
curl -X POST http://localhost:3456/config-reindex -d '{"action": "resume"}'
```

---

## Testing Rules

Use `jeeves-watcher validate` to check rule syntax:

```bash
jeeves-watcher validate --config ./my-config.json
```

This compiles the rules and reports any JSON Schema errors.

For runtime testing, add a rule and watch the logs:

```bash
jeeves-watcher start --config ./my-config.json
```

Look for log entries like:

```json
{"level":"info","filePath":"d:/meetings/transcript.md","msg":"File processed successfully"}
```

Then query Qdrant to inspect the payload:

```bash
curl -X POST http://localhost:3456/search \
  -H "Content-Type: application/json" \
  -d '{"query": "test", "limit": 1}'
```

---

## Best Practices

1. **Start simple** — add domain rules first, then layer on complexity
2. **Test incrementally** — add one rule at a time and verify output
3. **Use globs wisely** — prefer specific patterns over broad `**` (reduces reindex scope)
4. **Template carefully** — check that referenced fields exist (undefined → empty string)
5. **Order matters** — put broad rules first, specific overrides last
6. **Document your rules** — add comments in the config (JSON5 supports comments)

---

## Advanced: External Rules File

For complex rule sets, store rules in a separate file:

**`jeeves-watcher.config.json`:**

```json
{
  "watch": { "paths": ["./docs/**"] },
  "embedding": { "provider": "gemini", "model": "gemini-embedding-001" },
  "vectorStore": { "url": "http://localhost:6333", "collectionName": "docs" },
  "inferenceRulesFile": "./rules.json"
}
```

**`rules.json`:**

```json
[
  { "match": { /* ... */ }, "set": { /* ... */ } },
  { "match": { /* ... */ }, "set": { /* ... */ } }
]
```

(Note: `inferenceRulesFile` is a planned feature — currently rules must be inline.)

---

## Reference: Full Schema

```typescript
interface InferenceRule {
  match: Record<string, unknown>; // JSON Schema object
  set: Record<string, unknown>; // Key-value pairs with optional ${template} vars
  map?: Record<string, unknown> | string; // JsonMap definition or named map reference
}
```

See [Configuration Reference](./configuration.md#-metadata-enrichment-rules) for integration into the main config.
