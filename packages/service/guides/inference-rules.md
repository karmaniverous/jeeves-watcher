---
title: Inference Rules
---

# Inference Rules

The inference rules engine automatically enriches document metadata based on file attributes using a declarative JSON Schema-based system with type coercion and runtime values tracking.

## Overview

When a file is processed, the watcher:

1. **Collects attributes** from the file (path, size, modified date, frontmatter, JSON content)
2. **Evaluates rules** against these attributes using JSON Schema matching
3. **Merges schemas** from matching rules (left-to-right, property-level merge)
4. **Resolves `set` templates** and coerces values to declared types
5. **Applies enrichment** from `POST /metadata` API (overrides everything)

This creates a flexible, declarative metadata pipeline with strong type guarantees.

---

## Inference Rules v2 (Schema-Based Metadata)

**v0.5.0** introduces a complete redesign of the inference rules system. The v1 `set` property has been replaced by declarative JSON Schemas with type coercion, UI hints, and runtime values tracking.

### Key Changes from v1

| Aspect | v1 (≤ 0.4.x) | v2 (≥ 0.5.0) |
|--------|-------------|--------------|
| Metadata definition | `set` object with template strings | `schema` arrays referencing global schemas |
| Type handling | All values are strings | Type coercion to declared `type` |
| Rule identity | Anonymous | Requires `name` and `description` |
| Schema definition | Inline only | Global `schemas` collection + inline |
| Property metadata | None | `uiHint`, `description`, `enum` |
| Values tracking | None | Runtime values index per rule |
| Matched rules | Not tracked | `matched_rules` array in payload |

---

## Rule Structure

Each inference rule has these fields:

```json
{
  "name": "jira-issue",
  "description": "Jira issue metadata from JSON exports",
  "match": { /* JSON Schema */ },
  "schema": [
    "base",
    "jira-common",
    { "properties": { "status": { "type": "string", "set": "${json.current.fields.status.name}" } } }
  ],
  "map": { /* Optional JsonMap transform */ },
  "template": "jira-issue"
}
```

- **`name`** (required): Unique identifier for the rule
- **`description`** (required): Human-readable description of the rule's purpose
- **`match`**: JSON Schema object that file attributes must satisfy
- **`schema`**: Array of schema references (named strings or inline objects), merged left-to-right
- **`map`** (optional): JsonMap transformation (inline or named reference)
- **`template`** (optional): Handlebars content template (inline, named ref, or file path)

---

## Global Schemas Collection

Define reusable schemas in the top-level `schemas` config:

```json
{
  "schemas": {
    "base": {
      "type": "object",
      "properties": {
        "domain": {
          "type": "string",
          "description": "Content domain",
          "uiHint": "select"
        },
        "created": {
          "type": "integer",
          "description": "Record creation date as unix timestamp (seconds)",
          "uiHint": "date"
        }
      }
    },
    "jira-common": "schemas/jira-common.json"
  }
}
```

Schema entries can be:
- **Inline objects** - Schema definitions directly in config
- **File paths** - Relative to config directory (e.g., `"schemas/base.json"`)

---

## Schema Arrays on Rules

The `schema` property accepts an array of schema references, merged left-to-right at the property level:

```json
{
  "inferenceRules": [
    {
      "name": "jira-issue",
      "description": "Jira issue metadata",
      "match": { "..." },
      "schema": [
        "base",
        "jira-common",
        {
          "properties": {
            "domain": { "set": "jira" },
            "status": {
              "type": "string",
              "description": "Current workflow status",
              "uiHint": "select",
              "set": "${json.current.fields.status.name}"
            },
            "created": { "set": "${json.current.fields.created}" }
          }
        }
      ]
    }
  ]
}
```

**Merge semantics:**
- Named references (e.g., `"base"`) are resolved from global `schemas` collection
- Inline objects are used directly
- Properties merge left-to-right: later entries override earlier ones
- Each property accumulates: `type`, `description`, `uiHint`, `enum`, `set` from whichever schema last defines them

This pattern promotes DRY: `base` defines that `domain` is `type: "string"` with a description, and each rule's inline tail provides `set: "jira"` or `set: "email"`.

---

## The `set` Keyword

The `set` keyword within a property schema serves three purposes:

1. **Build time:** Interpolation template for value assignment
2. **Type coercion:** After interpolation, the result is coerced to the declared `type`
3. **Query time:** Provenance metadata — consumers can distinguish static values (`"set": "jira"`) from extracted values (`"set": "${json.status}"`)

**Template interpolation:**
```json
{
  "status": {
    "type": "string",
    "set": "${json.current.fields.status.name}"
  },
  "domain": {
    "type": "string",
    "set": "jira"
  }
}
```

Templates use `${path.to.field}` syntax to reference the file attributes object. Undefined paths resolve to empty string.

---

## Type Coercion

After template interpolation, values are automatically coerced to their declared `type`:

| Type | Coercion Rules | Examples |
|------|----------------|----------|
| `string` | No coercion (interpolation already produces strings) | `"42"` → `"42"` |
| `integer` | Parse as integer; empty/invalid → `undefined` | `"42"` → `42`, `""` → `undefined` |
| `number` | Parse as float; empty/invalid → `undefined` | `"3.14"` → `3.14`, `""` → `undefined` |
| `boolean` | `"true"` → `true`, `"false"` → `false`; else → `undefined` | `"true"` → `true`, `""` → `undefined` |
| `array` | Parse JSON array string; already array → passthrough | `"[1,2,3]"` → `[1,2,3]`, `[1,2]` → `[1,2]` |
| `object` | Parse JSON object string; already object → passthrough | `"{\"x\":1}"` → `{x:1}` |

**Empty string behavior:** Empty strings (`""`) coerce to `undefined` for all non-string types. This prevents invalid data from reaching Qdrant.

**Example:**

```json
{
  "created": {
    "type": "integer",
    "description": "Creation date as unix timestamp",
    "set": "${json.current.fields.created}"
  }
}
```

If `json.current.fields.created` is the string `"1735689600"`, coercion converts it to the integer `1735689600` for storage in Qdrant.

---

## The `uiHint` Keyword

The `uiHint` keyword tells consuming UIs how to render a property for search filtering:

| Value | Renders as | Use with |
|-------|-----------|----------|
| `text` | Free text input | Text fields, substring search |
| `number` | Numeric input / range slider | Numeric fields with range queries |
| `date` | Date picker / date range | Integer timestamps (unix seconds) |
| `select` | Single-value dropdown | Enum fields, known values |
| `multiselect` | Multi-value dropdown | Array fields with enum-like values |
| `check` | Boolean toggle / checkbox | Boolean fields |

**Properties without `uiHint` are not displayed in the UI.** This is an explicit opt-in: removing a `uiHint` hides the field; adding one exposes it.

**`uiHint` also serves as intent metadata for LLM consumers.** It augments the property description by signaling how the property is meant to be used in queries.

**Example:**

```json
{
  "created": {
    "type": "integer",
    "description": "Record creation date as unix timestamp (seconds)",
    "uiHint": "date",
    "set": "${json.current.fields.created}"
  },
  "priority": {
    "type": "string",
    "description": "Issue priority",
    "enum": ["Highest", "High", "Medium", "Low", "Lowest"],
    "uiHint": "select",
    "set": "${json.current.fields.priority.name}"
  }
}
```

**`uiHint` changes take effect immediately on config reload (no reindex needed).**

---

## Schema Completeness Validation

Every property in a resolved (merged) rule schema must have a declared `type`. If a property appears in an inline tail with only `set` and was never declared with a `type` in any named schema in the merge chain, config validation fails on load.

**Why:** This prevents silent string-defaulting and ensures the resolved schema is always self-describing.

**Example - valid:**

```json
{
  "schemas": {
    "base": {
      "properties": {
        "domain": { "type": "string" }
      }
    }
  },
  "inferenceRules": [
    {
      "name": "example",
      "description": "...",
      "match": { "..." },
      "schema": [
        "base",
        { "properties": { "domain": { "set": "jira" } } }
      ]
    }
  ]
}
```

**Example - invalid:**

```json
{
  "inferenceRules": [
    {
      "name": "example",
      "description": "...",
      "match": { "..." },
      "schema": [
        { "properties": { "domain": { "set": "jira" } } }  // ERROR: no type
      ]
    }
  ]
}
```

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

**Example** (for `j:/domains/jira/VCN/issue/WEB-123.json`):

```json
{
  "file": {
    "path": "j:/domains/jira/vcn/issue/web-123.json",
    "directory": "j:/domains/jira/vcn/issue",
    "filename": "web-123.json",
    "extension": ".json",
    "sizeBytes": 8452,
    "modified": "2026-02-24T08:15:00Z"
  },
  "json": {
    "entityKey": "WEB-123",
    "current": {
      "fields": {
        "summary": "Fix login bug",
        "status": { "name": "In Progress" },
        "created": "1735689600"
      }
    }
  }
}
```

---

## Matching with JSON Schema

Rules use standard **JSON Schema** for matching. The watcher uses [ajv](https://ajv.js.org/) with full support for `properties`, `required`, `type`, `const`, `enum`, nested objects, arrays, and string patterns.

### Custom `glob` Format

The watcher registers a custom `glob` keyword for path matching using [picomatch](https://github.com/micromatch/picomatch):

```json
{
  "match": {
    "properties": {
      "file": {
        "properties": {
          "path": { "type": "string", "glob": "j:/domains/jira/**/*.json" }
        }
      }
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

## Rule Processing Order

When multiple rules match a file, they are processed **in order** with **last-match-wins** semantics at the property level:

```json
{
  "inferenceRules": [
    {
      "name": "default-category",
      "description": "Default category for all files",
      "match": { "type": "object" },
      "schema": [
        { "properties": { "category": { "type": "string", "set": "general" } } }
      ]
    },
    {
      "name": "important-override",
      "description": "Override category for important files",
      "match": {
        "properties": {
          "file": {
            "properties": {
              "path": { "glob": "**/important/**" }
            }
          }
        }
      },
      "schema": [
        { "properties": { "category": { "type": "string", "set": "important" } } }
      ]
    }
  ]
}
```

Files under `**/important/**` get `category: "important"` (second rule wins).

---

## Matched Rules in Metadata

Every embedded point includes a `matched_rules` field: a keyword array of the inference rule names that matched the file.

**Benefits:**
- **Schema lookup:** Consumers can query which rules produced a result's metadata
- **Impact analysis:** `{ "key": "matched_rules", "match": { "value": "jira-issue" } }` returns all documents processed by that rule
- **Diagnostics:** Which rules touched this document?

**Example Qdrant payload:**

```json
{
  "file_path": "j:/domains/jira/VCN/issue/WEB-123.json",
  "chunk_index": 0,
  "matched_rules": ["jira-issue", "json-subject"],
  "domain": "jira",
  "status": "In Progress",
  "created": 1735689600
}
```

---

## Values Index (Runtime)

The watcher maintains a **values index** (`values.json` in `stateDir`) tracking distinct values per property per rule. Only trackable primitives (string, number, boolean) are indexed.

**Purpose:** Populate dropdowns for `select` and `multiselect` fields when no `enum` is declared in the schema.

**Storage structure:**

```json
{
  "jira-issue": {
    "status": ["To Do", "In Progress", "In Review", "Done"],
    "priority": ["Highest", "High", "Medium", "Low", "Lowest"],
    "assignee": ["Jason Williscroft", "Devin Becker"]
  },
  "slack-message": {
    "channel_name": ["general", "project-jeeves-watcher"],
    "userName": ["Jason Williscroft", "Jeeves"]
  }
}
```

**Update dynamics:**
- **On each embed:** Values are upserted (set-add) for matched rules' properties
- **Prior to full reindex:** Entire values index is cleared, then rebuilt from scratch
- **Prior to issues reindex:** Values index is not cleared (only issue files are re-processed)

**Deletion behavior:** When a file is deleted, its chunks are removed from Qdrant but the values index is **not updated** (no reference counting). Stale values persist until the next full reindex. This is acceptable: a stale value in a dropdown is cosmetic, not a correctness issue.

**Queryable via JSONPath:**

```
$.inferenceRules[?(@.name=='jira-issue')].values.status
```

Returns `["To Do", "In Progress", "In Review", "Done"]` when queried through `POST /config/query`.

---

## Issues File (Self-Healing Errors)

**Location:** `{stateDir}/issues.json`

A persistent, self-healing ledger of files that failed to embed. Keyed by file path, with one entry per issue per file.

**Structure:**

```json
{
  "j:/domains/jira/VCN/issue/WEB-123.json": [
    {
      "type": "type_collision",
      "property": "created",
      "rules": ["jira-issue", "frontmatter-created"],
      "types": ["integer", "string"],
      "message": "Type collision on 'created': jira-issue declares integer, frontmatter-created declares string",
      "timestamp": 1771865063
    }
  ],
  "j:/domains/email/archive/msg-456.json": [
    {
      "type": "interpolation_error",
      "property": "author_email",
      "rule": "email-archive",
      "message": "Failed to resolve ${json.from.email}: 'from' is null",
      "timestamp": 1771865100
    }
  ]
}
```

**Issue types:**
- `type_collision` — Multiple rules declare the same property with incompatible types
- `interpolation_error` — `set` template path doesn't resolve (null, undefined, wrong structure)

**Behavior:**
- When a file hits an issue, it is logged to the issues file and **embedding is skipped**
- When a file is re-processed successfully (config fix, file edit, reindex), its entry is **cleared**
- The file always represents the **current** set of unresolved problems: a live todo list

**API:** `GET /issues` returns the issues file contents.

---

## Config Watch Reindex

When `configWatch.enabled` is true, the watcher monitors its config file. On config change:

1. Debounce for `configWatch.debounceMs` (default: 1000ms)
2. Reload and validate config
3. Recompile inference rules
4. Trigger reindex based on `configWatch.reindex` setting

**Reindex modes:**

```json
{
  "configWatch": {
    "enabled": true,
    "debounceMs": 10000,
    "reindex": "issues"
  }
}
```

| Mode | Behavior |
|------|----------|
| `"issues"` (default) | Re-process only files in the issues file (cheap, targeted) |
| `"full"` | Full reindex of all watched files (use when broad config changes affect already-embedded files) |
| `"none"` | No automatic reindex (manual `POST /reindex` required) |

**Issues reindex** is the default because config changes typically fix issues: a type collision is resolved by editing a rule, and re-processing just the affected file is sufficient.

**Full reindex** is needed when:
- Renaming a property across all rules
- Changing a type on a widely-matched rule
- Adding a new global schema that should apply to already-indexed files

---

## JsonMap Transformations (`map`)

In addition to schema-based `set` values, rules can run a **JsonMap** transform to derive metadata from the file attributes.

- `map` can be an **inline JsonMap** object, or a **string reference** to a named map defined in top-level config `maps`
- **Merge priority:** `map` output overrides schema `set` output on field conflict

### Example: Inline `map` extracts a path segment

```json
{
  "name": "extract-project",
  "description": "Extract project name from path",
  "match": { "type": "object" },
  "schema": [
    { "properties": { "domain": { "type": "string", "set": "docs" } } }
  ],
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

See [Configuration Reference](./configuration.md) for details on maps.

---

## Content Templates

Rules can include a `template` field — a Handlebars template that renders the file's data into embeddable markdown. When a template is present, the rendered output replaces the raw file content for embedding.

**Why:** Raw JSON from API responses embeds poorly. Templates transform structured data into clean, readable markdown at index time.

See the v0.4.0 section in [Inference Rules Guide (legacy)](./inference-rules.md#content-templates) for template details.

---

## Metadata Priority

Metadata is built in layers with clear precedence:

### 1. Inference Rules (Base Layer)

Rules are evaluated **in order**. For each matching rule:
- Schema is merged (left-to-right, property-level)
- `set` templates are resolved and coerced
- `map` (JsonMap) transformation runs (if present)
- `map` output overrides `set` output on field conflict

Later rules override earlier rules on field conflict.

### 2. Enrichment Metadata (Override Layer)

Metadata from `.meta.json` sidecars (written via `POST /metadata` API) **overrides** all inference rule output.

**Note:** Enrichment metadata is now **validated** against the resolved schema for the file's matched rules. Invalid metadata is rejected with descriptive errors.

### Final Merge Order

```
inferred (from rules) → enrichment (from .meta.json) → final payload
                        ↑ wins conflicts
```

---

## Practical Examples

### 1. Domain Classification by Directory

```json
{
  "schemas": {
    "base": {
      "properties": {
        "domain": { "type": "string", "description": "Content domain", "uiHint": "select" }
      }
    }
  },
  "inferenceRules": [
    {
      "name": "email-domain",
      "description": "Email archive messages",
      "match": {
        "properties": {
          "file": {
            "properties": {
              "path": { "glob": "j:/domains/email/archive/**" }
            }
          }
        }
      },
      "schema": [
        "base",
        { "properties": { "domain": { "set": "email" } } }
      ]
    },
    {
      "name": "meetings-domain",
      "description": "Meeting transcripts and notes",
      "match": {
        "properties": {
          "file": {
            "properties": {
              "path": { "glob": "j:/domains/meetings/**" }
            }
          }
        }
      },
      "schema": [
        "base",
        { "properties": { "domain": { "set": "meetings" } } }
      ]
    }
  ]
}
```

### 2. Extract Frontmatter Fields with Type Coercion

```json
{
  "name": "frontmatter-metadata",
  "description": "Extract metadata from YAML frontmatter",
  "match": {
    "properties": {
      "frontmatter": {
        "required": ["title"]
      }
    }
  },
  "schema": [
    {
      "properties": {
        "title": {
          "type": "string",
          "description": "Document title",
          "uiHint": "text",
          "set": "${frontmatter.title}"
        },
        "created": {
          "type": "integer",
          "description": "Creation date as unix timestamp",
          "uiHint": "date",
          "set": "${frontmatter.created}"
        }
      }
    }
  ]
}
```

If frontmatter has `created: "1735689600"`, type coercion converts it to integer `1735689600`.

### 3. Extract JSON Fields with Enum and UI Hint

```json
{
  "name": "jira-issue",
  "description": "Jira issue metadata from JSON exports",
  "match": {
    "properties": {
      "json": {
        "required": ["entityKey"]
      }
    }
  },
  "schema": [
    {
      "properties": {
        "issue_key": {
          "type": "string",
          "description": "Jira issue key",
          "uiHint": "text",
          "set": "${json.entityKey}"
        },
        "status": {
          "type": "string",
          "description": "Current workflow status",
          "uiHint": "select",
          "set": "${json.current.fields.status.name}"
        },
        "priority": {
          "type": "string",
          "description": "Issue priority",
          "enum": ["Highest", "High", "Medium", "Low", "Lowest"],
          "uiHint": "select",
          "set": "${json.current.fields.priority.name}"
        }
      }
    }
  ]
}
```

### 4. Combine Multiple Conditions

```json
{
  "name": "project-docs",
  "description": "Markdown documentation under projects",
  "match": {
    "properties": {
      "file": {
        "properties": {
          "path": { "glob": "j:/domains/projects/**" },
          "extension": { "const": ".md" }
        },
        "required": ["path", "extension"]
      }
    }
  },
  "schema": [
    "base",
    {
      "properties": {
        "domain": { "set": "projects" },
        "category": { "type": "string", "set": "documentation" }
      }
    }
  ]
}
```

---

## Testing Rules

Use `jeeves-watcher validate` to check rule syntax:

```bash
jeeves-watcher validate --config ./my-config.json
```

For runtime testing, check logs:

```bash
jeeves-watcher start --config ./my-config.json
```

Query Qdrant to inspect payloads:

```bash
curl -X POST http://localhost:3456/search \
  -H "Content-Type: application/json" \
  -d '{"query": "test", "limit": 1}'
```

Use `POST /config/match` to test paths against rules without indexing:

```bash
curl -X POST http://localhost:3456/config/match \
  -H "Content-Type: application/json" \
  -d '{"paths": ["j:/domains/jira/VCN/issue/WEB-123.json"]}'
```

---

## Best Practices

1. **Define global schemas for shared properties** — `domain`, `created`, `updated` belong in `base` schema
2. **Use schema arrays effectively** — global schemas for shape, inline tail for `set` wiring
3. **Declare types explicitly** — Schema completeness validation catches missing types
4. **Add `uiHint` deliberately** — Every exposed filter field is a conscious decision
5. **Test type coercion** — Verify integer/number fields parse correctly (check logs)
6. **Order rules intentionally** — Later rules override earlier ones on conflict
7. **Monitor issues file** — `GET /issues` surfaces problems before they become mysteries
8. **Use values index for dropdowns** — Pair `uiHint: "select"` with runtime values for dynamic enums

---

## Migration from v1 to v2

**Before (v0.4.x):**

```json
{
  "inferenceRules": [
    {
      "match": { "..." },
      "set": {
        "domain": "jira",
        "status": "${json.current.fields.status.name}"
      }
    }
  ]
}
```

**After (v0.5.0+):**

```json
{
  "schemas": {
    "base": {
      "properties": {
        "domain": { "type": "string", "description": "Content domain" }
      }
    }
  },
  "inferenceRules": [
    {
      "name": "jira-issue",
      "description": "Jira issue metadata",
      "match": { "..." },
      "schema": [
        "base",
        {
          "properties": {
            "domain": { "set": "jira" },
            "status": {
              "type": "string",
              "description": "Current workflow status",
              "set": "${json.current.fields.status.name}"
            }
          }
        }
      ]
    }
  ]
}
```

**Key migration steps:**
1. Add `name` and `description` to every rule
2. Define global schemas for shared properties
3. Replace `set` object with `schema` array
4. Declare `type` for every property
5. Add `uiHint` for search-filterable fields
6. Test with `jeeves-watcher validate`

---

## Reference: Full Schema

```typescript
interface InferenceRule {
  name: string;                    // Required unique identifier
  description: string;             // Required human-readable description
  match: Record<string, unknown>;  // JSON Schema object
  schema: SchemaReference[];       // Array of named refs and inline objects
  map?: Record<string, unknown> | string; // JsonMap definition, named map ref, or file path
  template?: string;               // Handlebars template (inline, named ref, or file path)
}

interface SchemaReference {
  // Either a named string reference or an inline schema object
}

interface ResolvedProperty {
  type?: string;                   // JSON Schema type
  description?: string;            // Human-readable description
  uiHint?: string;                 // UI rendering hint
  enum?: unknown[];                // Enum values
  set?: string;                    // Interpolation template
}
```

See [Configuration Reference](./configuration.md) for integration into the main config.
