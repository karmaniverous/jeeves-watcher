---
title: Inference Rules
---

# Inference Rules

The inference rules engine automatically enriches document metadata based on file attributes using a declarative JSON Schema-based system with type coercion and runtime values tracking.

## Overview

When a file is processed, the watcher:

1. **Collects attributes** from the file (path, size, modified date, Markdown frontmatter, JSON content)
2. **Evaluates rules** in order, matching each rule's `match` JSON Schema against these attributes
3. **For each matching rule:** merges its `schema` array (left-to-right, property-level), resolves `set` templates and coerces values to declared types, runs its `map` (JsonMap) and renders its `template` or `render`
4. **Merges the rule outputs**: later rules override earlier ones on field conflict
5. **Merges stored enrichment** (written by `POST /metadata`) over the rule output
6. **Writes the payload**: reserved system field names are dropped from rule and enrichment metadata, and the watcher writes its own system fields, including `matched_rules`

This creates a flexible, declarative metadata pipeline with strong type guarantees.

---

## Inference Rules v2 (Schema-Based Metadata)

**v0.5.0** introduces a complete redesign of the inference rules system. The v1 `set` property has been replaced by declarative JSON Schemas with type coercion, UI hints, and runtime values tracking.

### Key Changes from v1

| Aspect | v1 (≤ 0.4.x) | v2 (≥ 0.5.0) |
| --- | --- | --- |
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
  "match": {
    "properties": {
      "json": { "required": ["entityKey"] }
    }
  },
  "schema": [
    "base",
    "jira-common",
    {
      "properties": {
        "status": {
          "type": "string",
          "set": "{{json.current.fields.status.name}}"
        }
      }
    }
  ],
  "template": "jira-issue"
}
```

- **`name`** (required): Unique identifier for the rule (duplicate names fail rule compilation)
- **`description`** (required): Human-readable description of the rule's purpose
- **`match`** (required): JSON Schema object that the attributes must satisfy
- **`schema`** (optional): Array of schema references (named strings or inline objects), merged left-to-right
- **`map`** (optional): JsonMap transformation (inline definition, named map reference, or `.json` file path)
- **`template`** (optional): Handlebars content template (inline string, named ref, or `.hbs`/`.handlebars` file path); here `jira-issue` names an entry of the top-level `templates`
- **`render`** (optional): Declarative structured renderer configuration (mutually exclusive with `template`)
- **`renderAs`** (optional): Output file extension override (e.g. `"md"`, `"html"`, `"txt"`). 1–10 lowercase alphanumeric characters, without dot. Requires `template` or `render`.

An `inferenceRules` entry may also be a string: the path of a JSON file holding one rule, resolved relative to the config file's directory when the config is loaded.

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
- **File paths** - JSON files, relative to the config directory (e.g., `"schemas/base.json"`), read when a rule using them is applied

---

## Schema Arrays on Rules

The `schema` property accepts an array of schema references, merged left-to-right at the property level:

```json
{
  "inferenceRules": [
    {
      "name": "jira-issue",
      "description": "Jira issue metadata",
      "match": {
        "properties": {
          "json": { "required": ["entityKey"] }
        }
      },
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
              "set": "{{json.current.fields.status.name}}"
            },
            "created": { "set": "{{json.current.fields.created}}" }
          }
        }
      ]
    }
  ]
}
```

**Merge semantics:**

- Named references (e.g., `"base"`) are resolved from the global `schemas` collection; an unknown name makes the rule's schema step fail (see [Schema Validation at Processing Time](#schema-validation-at-processing-time))
- Inline objects are used directly
- Properties merge left-to-right: later entries override earlier ones
- Each property accumulates its keywords (`type`, `description`, `uiHint`, `enum`, `set`, and any other) from whichever schema last defines them

This pattern promotes DRY: `base` defines that `domain` is `type: "string"` with a description, and each rule's inline tail provides `set: "jira"` or `set: "email"`.

### Array Property Concatenation

For array-typed properties, `set` values from multiple schemas in the merge chain are **concatenated** rather than replaced. This enables composable metadata: a `base` schema can define initial array values, and subsequent schemas can append to them.

**Example — composable `domains`:**

```json
{
  "schemas": {
    "base": {
      "properties": {
        "domains": {
          "type": "array",
          "description": "Content domains",
          "set": ["general"]
        }
      }
    }
  },
  "inferenceRules": [
    {
      "name": "jira-and-engineering",
      "description": "Jira issues in the engineering domain",
      "match": {
        "properties": {
          "json": { "required": ["entityKey"] }
        }
      },
      "schema": [
        "base",
        { "properties": { "domains": { "set": ["jira", "engineering"] } } }
      ]
    }
  ]
}
```

The resolved `domains` value for a matching file would be `["general", "jira", "engineering"]`: the base array concatenated with the inline tail array. Concatenation applies when the property merged so far has `type: "array"` and an array `set`; a later scalar `set` is appended as one element. Otherwise last-write-wins applies. Concatenation happens within one rule's schema array; across rules, a later rule's value replaces an earlier rule's.

Each string element of an array `set` is resolved as a template; array values are not type-coerced.

---

## The `set` Keyword

The `set` keyword within a property schema serves three purposes:

1. **Build time:** Interpolation template for value assignment
2. **Type coercion:** After interpolation, the result is coerced to the declared `type`
3. **Query time:** Provenance metadata — consumers can distinguish static values (`"set": "jira"`) from extracted values (`"set": "{{json.status}}"`)

**Template interpolation:**

```json
{
  "status": {
    "type": "string",
    "set": "{{json.current.fields.status.name}}"
  },
  "domain": {
    "type": "string",
    "set": "jira"
  }
}
```

Templates use Handlebars `{{path.to.field}}` syntax against the attributes object, without HTML escaping; registered `templateHelpers` are available. Undefined paths resolve to an empty string. A non-string `set` value (for example a number) is passed to coercion unchanged. Properties without `set` produce no value.

---

## Type Coercion

After template interpolation, values are automatically coerced to their declared `type`:

| Type | Coercion Rules | Examples |
| --- | --- | --- |
| `string` | Strings unchanged; numbers and booleans stringified; objects and arrays JSON-stringified | `"42"` → `"42"`, `""` → `""` |
| `integer` | The trimmed string must be exactly an integer; numbers must be integers; else `undefined` | `"42"` → `42`, `"42.5"` → `undefined`, `""` → `undefined` |
| `number` | Parse as float (`parseFloat`); non-finite → `undefined` | `"3.14"` → `3.14`, `""` → `undefined` |
| `boolean` | `"true"` / `"false"` (case-insensitive) or a boolean; else `undefined` | `"TRUE"` → `true`, `""` → `undefined` |
| `array` | Parse JSON array string; already array → passthrough | `"[1,2,3]"` → `[1,2,3]`, `[1,2]` → `[1,2]` |
| `object` | Parse JSON object string; already object → passthrough | `"{\"x\":1}"` → `{x:1}` |

**Empty string behavior:** Empty strings (`""`) coerce to `undefined` for all non-string types, and `null` coerces to `undefined` for every type. A property whose value coerces to `undefined` is left out of the metadata, so invalid data never reaches Qdrant.

**Example:**

```json
{
  "created": {
    "type": "integer",
    "description": "Creation date as unix timestamp",
    "set": "{{json.current.fields.created}}"
  }
}
```

If `json.current.fields.created` is the string `"1735689600"`, coercion converts it to the integer `1735689600` for storage in Qdrant.

---

## The `uiHint` Keyword

The `uiHint` keyword tells consuming UIs how to render a property for search filtering:

| Value | Renders as | Use with |
| --- | --- | --- |
| `text` | Free text input | Text fields, substring search |
| `number` | Numeric input / range slider | Numeric fields with range queries |
| `date` | Date picker / date range | Integer timestamps (unix seconds) |
| `select` | Single-value dropdown | Enum fields, known values |
| `multiselect` | Multi-value dropdown | Array fields with enum-like values |
| `check` | Boolean toggle / checkbox | Boolean fields |

**Properties without `uiHint` are not displayed in the UI.** This is an explicit opt-in: removing a `uiHint` hides the field; adding one exposes it.

**`uiHint` also serves as intent metadata for LLM consumers.** It augments the property description by signaling how the property is meant to be used in queries.

`uiHint` and `enum` are only valid on `string`, `number`, `integer`, `boolean` and `array` properties. On any other type (e.g. `object`) the rule's schema step fails (see [Schema Validation at Processing Time](#schema-validation-at-processing-time)).

**Example:**

```json
{
  "created": {
    "type": "integer",
    "description": "Record creation date as unix timestamp (seconds)",
    "uiHint": "date",
    "set": "{{json.current.fields.created}}"
  },
  "priority": {
    "type": "string",
    "description": "Issue priority",
    "enum": ["Highest", "High", "Medium", "Low", "Lowest"],
    "uiHint": "select",
    "set": "{{json.current.fields.priority.name}}"
  }
}
```

**`uiHint` changes take effect immediately on config reload (no reindex needed).**

---

## Schema Validation at Processing Time

Every property in a resolved (merged) rule schema must have a declared `type`. A property that appears in an inline tail with only `set`, and is never given a `type` by any schema in the merge chain, is an error. So is `uiHint` or `enum` on a non-facetable type, or a named schema reference that does not exist.

**Why:** This prevents silent string-defaulting and ensures the resolved schema is always self-describing.

**When it is checked:**

- [`POST /config/validate`](./api-reference.md#post-configvalidate) reports these problems as errors (path `inferenceRules[<rule>]`).
- Loading the config (startup, reload, `jeeves-watcher config validate`) does **not** check them.
- When a matching rule's schema fails during processing, the rule's metadata, `map`, `render` and `template` are skipped, and the failure is recorded as an `interpolation_error` [issue](#issues-file-self-healing-errors). A file is still indexed without that rule's output; a source document fails and nothing is written.

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
      "description": "Example rule",
      "match": { "type": "object" },
      "schema": ["base", { "properties": { "domain": { "set": "jira" } } }]
    }
  ]
}
```

**Example - invalid** (`domain` has no `type` anywhere in the merge chain):

```json
{
  "inferenceRules": [
    {
      "name": "example",
      "description": "Example rule",
      "match": { "type": "object" },
      "schema": [{ "properties": { "domain": { "set": "jira" } } }]
    }
  ]
}
```

---

## Reserved Field Names

The watcher writes these payload fields itself: `file_path`, `source`, `source_rule`, `chunk_index`, `chunk_text`, `total_chunks`, `content_hash`, `matched_rules`, `line_start`, `line_end`, `created_at`, `modified_at`.

A rule or enrichment value under one of these names never reaches the payload: reserved names are dropped from rule (`set` and `map`) and enrichment metadata before every write, and the watcher's own values are written instead.

A rule schema property with a reserved name is reported as a non-fatal warning (the config still loads):

```
inferenceRules[<rule>].schema.<name>: Property "<name>" is a reserved system payload field; the system value overwrites rule metadata on upsert. Rename the property.
```

Warnings are emitted through `loadConfig`'s `onWarning`: printed to the console once at startup (prefixed `[jeeves-watcher]`), and logged as warnings on each config reload. `POST /config/validate` returns them in `warnings`.

---

## Attributes Object

The watcher builds an attributes object for each file:

```typescript
interface FileAttributes {
  file: {
    path: string; // Full path with forward slashes (case preserved)
    directory: string; // Directory containing the file
    filename: string; // File name with extension
    extension: string; // Extension including dot (e.g., ".md")
    sizeBytes: number; // File size in bytes
    modified: string; // ISO-8601 timestamp of last modification
  };
  frontmatter?: Record<string, unknown>; // YAML frontmatter from .md/.markdown files
  json?: Record<string, unknown>; // Parsed content from .json files
}
```

**Example** (for `j:/domains/jira/VCN/issue/WEB-123.json`):

```json
{
  "file": {
    "path": "j:/domains/jira/VCN/issue/WEB-123.json",
    "directory": "j:/domains/jira/VCN/issue",
    "filename": "WEB-123.json",
    "extension": ".json",
    "sizeBytes": 8452,
    "modified": "2026-02-24T08:15:00.000Z"
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

**Source documents (v0.20.0+)** are matched against different attributes: a `source` object (`ref`, `name`, `id`, `rule`, `retrievedAt`) and `json` (the callback body), with no `file` key. Only the document's designated rule is applied to it. See [Source Documents](./source-documents.md#the-designated-rule).

---

## Matching with JSON Schema

Rules use standard **JSON Schema** for matching. The watcher uses [ajv](https://ajv.js.org/) (all errors collected, non-strict mode, standard formats from `ajv-formats`) with full support for `properties`, `required`, `type`, `const`, `enum`, nested objects, arrays, and string patterns.

### Custom `glob` Keyword

The watcher registers a custom `glob` keyword for path matching using [picomatch](https://github.com/micromatch/picomatch). Matching is case-insensitive and `*`/`**` also match dotfiles and dot-directories:

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

This is the **only custom keyword** — everything else is pure JSON Schema.

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
        {
          "properties": { "category": { "type": "string", "set": "important" } }
        }
      ]
    }
  ]
}
```

Files under `**/important/**` get `category: "important"` (second rule wins).

Rules registered at runtime through [`POST /rules/register`](#runtime-rules) are evaluated after the config rules, so they win on conflict.

---

## Matched Rules in Metadata

Every embedded point includes a `matched_rules` field: an array of the names of the inference rules that matched the document, in evaluation order. Only the watcher writes it.

**Benefits:**

- **Schema lookup:** Consumers can query which rules produced a result's metadata
- **Impact analysis:** `{ "key": "matched_rules", "match": { "value": "jira-issue" } }` returns all documents processed by that rule
- **Diagnostics:** Which rules touched this document?

**Example Qdrant payload (excerpt):**

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

The watcher maintains a **values index** (`values.v8` in `stateDir`, a V8-serialized file) tracking distinct values per rule. For each rule that matched a document, the distinct values of the document's metadata fields are recorded under that rule's name. Only trackable primitives (string, number, boolean) are indexed; arrays contribute their primitive elements.

**Purpose:** Populate dropdowns for `select` and `multiselect` fields when no `enum` is declared in the schema.

**Shape** (as returned per rule in `GET /config`):

```json
{
  "jira-issue": {
    "status": ["Done", "In Progress", "In Review", "To Do"],
    "priority": ["High", "Highest", "Low", "Lowest", "Medium"],
    "assignee": ["Devin Becker", "Jason Williscroft"]
  },
  "slack-message": {
    "channel_name": ["general", "project-jeeves-watcher"],
    "userName": ["Jason Williscroft", "Jeeves"]
  }
}
```

Values are kept sorted.

**Update dynamics:**

- **On each embed, rules re-application and file move:** Values are upserted (set-add) for the matched rules
- **Prior to full reindex:** Entire values index is cleared, then rebuilt from scratch
- **Prior to issues reindex:** Values index is not cleared (only issue files are re-processed)

**Deletion behavior:** When a file is deleted, its chunks are removed from Qdrant but the values index is **not updated** (no reference counting). Stale values persist until the next full reindex. This is acceptable: a stale value in a dropdown is cosmetic, not a correctness issue.

**Queryable via JSONPath:**

```
$.inferenceRules[?(@.name=='jira-issue')].values.status
```

Returns `[["Done", "In Progress", "In Review", "To Do"]]` in `result` when queried through `GET /config?path=...`.

---

## Issues File (Self-Healing Errors)

**Location:** `{stateDir}/issues.json`

A persistent, self-healing ledger of documents that failed to process. Keyed by file path (or source reference, for source documents), with a list of issue records per document.

**Structure:**

```json
{
  "j:/domains/email/archive/msg-456.json": [
    {
      "type": "interpolation_error",
      "message": "Rule \"email-archive\" schema failed: Property \"author_email\" in rule \"email-archive\" has no declared type. Every property must have a type.",
      "timestamp": 1771865100,
      "operation": "Rule interpolation",
      "rules": ["email-archive"],
      "details": [
        {
          "rule": "email-archive",
          "stage": "schema",
          "message": "Property \"author_email\" in rule \"email-archive\" has no declared type. Every property must have a type."
        }
      ]
    }
  ]
}
```

**Rule-related issue types:**

- `interpolation_error` - a matching rule's schema step (merging, completeness, `set` resolution), `render` or `template` failed. A file is still indexed without the failed output (raw content is embedded when a template or render failed); a source document fails with this code and nothing is written (v0.20.0+). `details` lists each failed step (`rule`, `stage`, `message`).
- `type_collision` - defined in the issue code list, but not recorded by the current rule engine: when two rules set the same property, the later rule's value wins.

Since v0.20.0 processing failures are recorded too (`extraction_error`, `embedding_error`, `upsert_error`), as are source-document failures (`match_failed`, `rule_missing`, `no_content`, `source_unavailable`, `unsupported_content_type`). See [Issue Codes](./api-reference.md#issue-codes) for the full list.

**Behavior:**

- A processing failure is recorded and the document is not (re)indexed; an interpolation error is recorded alongside the indexed file
- When a document is re-processed successfully (config fix, file edit, reindex), its entry is **cleared**
- The file always represents the **current** set of unresolved problems: a live todo list

**API:** `GET /issues` returns `{ "count": <documents with issues>, "issues": { ... } }`.

---

## Config Watch Reindex

When `configWatch.enabled` is true (the default), the watcher monitors its config file. On config change:

1. Debounce for `configWatch.debounceMs` (default: 1000ms)
2. Reload and validate config (reserved field warnings are logged)
3. Recompile inference rules and rebuild templates and helpers
4. Rebuild the filesystem watcher if the `watch` settings changed
5. Trigger reindex based on `configWatch.reindex` setting

A reload that fails validation is logged and the previous config stays in effect.

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
| --- | --- |
| `"issues"` (default) | Re-process only files in the issues file (cheap, targeted) |
| `"rules"` | Re-apply inference rules to all files (no re-embedding) |
| `"full"` | Full reindex of all watched files (use when changes affect the embedded text) |

> **Note:** `"path"` and `"prune"` are NOT valid for config-watch auto-trigger (config validation rejects them). They can only be triggered via explicit API calls.

> **Note:** A config-triggered reindex covers **files only**. To re-apply changed rules to [source documents](./source-documents.md), call `POST /reindex` with scope `rules` or `full`.

**Issues reindex** is the default because config changes typically fix issues: an interpolation error is resolved by editing a rule, and re-processing just the affected file is sufficient.

**Rules reindex** is enough when only metadata changes, for example:

- Renaming a property across all rules
- Changing a type on a widely-matched rule
- Adding a new global schema that should apply to already-indexed files

Re-applying rules writes the changed values and **removes payload keys the rules no longer project** (system fields and stored enrichment are kept). Moving a file does the same against its new path.

**Full reindex** is needed when a `template`, `render` or other change alters the text that is embedded.

---

## JsonMap Transformations (`map`)

In addition to schema-based `set` values, rules can run a **JsonMap** transform to derive metadata from the attributes.

- `map` can be an **inline JsonMap** object, a **string reference** to a named map defined in top-level config `maps`, or a path ending in `.json` (resolved relative to the config directory)
- **Merge priority:** `map` output overrides schema `set` output on field conflict
- The transform must return an object; any other result is logged and skipped. A transform that throws is logged and its output skipped.
- A map that cannot be resolved (unknown name, unreadable file) is logged, and the rule's map, `render` and `template` are skipped

The `$.lib` functions are `split`, `slice`, `join`, `toLowerCase`, `replace`, `get`, `lookupJson`, `mapLookup` and `fetchSiblings`, plus every function exported by a `mapHelpers` module as `<namespace>_<export>`. `fetchSiblings` reads neighbouring files of a file document. Source rules get no file reader, so for a source document `fetchSiblings` returns an empty array.

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

Rules can include a `template` field — a Handlebars template that renders the document's data into embeddable markdown. When a template is present, the rendered output replaces the raw content for embedding.

**Why:** Raw JSON from API responses embeds poorly. Templates transform structured data into clean, readable markdown at index time.

- **Reference resolution:** a value ending in `.hbs` or `.handlebars` is a file path (relative to the config directory); a key of the top-level `templates` is a named template; anything else is an inline template.
- **Context:** the fields of `json` spread at the top level, then the attributes (`file`, `frontmatter`, `json`, or `source`), then the metadata merged so far (including this rule's `set` and `map` output).
- **`render`** is the declarative alternative: YAML frontmatter keys plus ordered Markdown body sections. A rule has `template` or `render`, never both.
- **Several matching rules:** the last rule whose output is non-empty supplies the content.
- **Empty output** is logged and the raw content is used. **A failure** is recorded as an `interpolation_error` and the raw content is used (a source document fails instead).

See [Configuration Reference](./configuration.md) for `templates` and `templateHelpers`.

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

Enrichment written via the `POST /metadata` API is stored in the SQLite enrichment store (`<stateDir>/enrichments.sqlite`, built-in `node:sqlite`) and merged over the inference rule output on every write:

- Scalars (and mixed scalar/array values) from the enrichment replace the inferred value
- When both values are arrays, they are merged as a union without duplicates
- Keys only in the enrichment are added; inferred keys not in the enrichment are kept

**Note:** Enrichment metadata is **validated** against the declared types of the rules matching the file's path. Invalid metadata is rejected with descriptive errors; properties no rule declares are allowed.

### 3. System Fields

Reserved names are dropped from the merged metadata, and the watcher writes its own system fields (see [Reserved Field Names](#reserved-field-names)).

### Final Merge Order

```
inferred (from rules) → enrichment (from enrichments.sqlite) → system fields → final payload
                        ↑ wins conflicts                       ↑ always win
```

---

## Practical Examples

### 1. Domain Classification by Directory

```json
{
  "schemas": {
    "base": {
      "properties": {
        "domain": {
          "type": "string",
          "description": "Content domain",
          "uiHint": "select"
        }
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
      "schema": ["base", { "properties": { "domain": { "set": "email" } } }]
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
      "schema": ["base", { "properties": { "domain": { "set": "meetings" } } }]
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
          "set": "{{frontmatter.title}}"
        },
        "created": {
          "type": "integer",
          "description": "Creation date as unix timestamp",
          "uiHint": "date",
          "set": "{{frontmatter.created}}"
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
          "set": "{{json.entityKey}}"
        },
        "status": {
          "type": "string",
          "description": "Current workflow status",
          "uiHint": "select",
          "set": "{{json.current.fields.status.name}}"
        },
        "priority": {
          "type": "string",
          "description": "Issue priority",
          "enum": ["Highest", "High", "Medium", "Low", "Lowest"],
          "uiHint": "select",
          "set": "{{json.current.fields.priority.name}}"
        }
      }
    }
  ]
}
```

### 4. Combine Multiple Conditions

This rule uses the `base` schema from example 1.

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

## Runtime Rules

Besides the config file, rules can be registered at runtime (for example by a plugin). They are held in memory, evaluated after the config rules, and lost on restart. See the [API Reference](./api-reference.md#post-rulesregister) for full request and response details.

| Endpoint | Request body | Response |
| --- | --- | --- |
| `POST /rules/register` | `{ "source": "<non-empty string>", "rules": [ { "name": "<non-empty>", ... } ] }` | `{ source, registered, totalVirtualRules }` |
| `DELETE /rules/unregister` | `{ "source": "<non-empty string>" }` | `{ source, removed }` |
| `DELETE /rules/unregister/:source` | none (source in the path) | `{ source, removed }` |
| `POST /rules/reapply` | `{ "globs": ["<non-empty string>", ...] }` (at least one) | `{ matched, updated }` |

- A body that does not match its schema is `400 invalid_request` (`error` is the first problem, for example `Missing required field: source`, `Missing required field: rules (array)`, `Every rule must be an object with a name` or `Missing required field: globs (non-empty string array)`; `details` lists every Zod issue).
- `POST /rules/register` also returns `400 invalid_request` (`error: "Invalid rules"`) when the rules have duplicate names or a `match` schema does not compile; nothing is registered. Registering again under the same `source` replaces that source's rules.
- After a register, or an unregister that removed rules, the rules are recompiled. When any registered rule has a `match.properties.file.properties.path.glob` string, a `rules` reindex runs for those globs (files only).
- `POST /rules/reapply` re-applies the current rules, without re-embedding, to every indexed file whose path matches a glob (case-insensitive, dotfiles included), removing payload keys the rules no longer project. Source documents are never matched. A file that fails is logged and skipped.

---

## Testing Rules

Use `jeeves-watcher config validate` to check the config file against the schema:

```bash
jeeves-watcher config validate -c ./my-config.json
```

This is a schema check only. To also check merged rule schemas, helper files and reserved field names, call `POST /config/validate` on a running watcher. With `testPaths` (files that exist) it also returns the matched rules and metadata per path, computed from each file's path and stats only (frontmatter and JSON content are not read):

```bash
curl -X POST http://localhost:1936/config/validate \
  -H "Content-Type: application/json" \
  -d '{"testPaths": ["j:/domains/jira/VCN/issue/WEB-123.json"]}'
```

For runtime testing, check logs:

```bash
jeeves-watcher start --config ./my-config.json
```

Query Qdrant to inspect payloads:

```bash
curl -X POST http://localhost:1936/search \
  -H "Content-Type: application/json" \
  -d '{"query": "test", "limit": 1}'
```

Use `POST /config/match` to test paths against rules without indexing (matching uses the path only):

```bash
curl -X POST http://localhost:1936/config/match \
  -H "Content-Type: application/json" \
  -d '{"paths": ["j:/domains/jira/VCN/issue/WEB-123.json"]}'
```

---

## Best Practices

1. **Define global schemas for shared properties** — `domain`, `created`, `updated` belong in `base` schema
2. **Use schema arrays effectively** — global schemas for shape, inline tail for `set` wiring
3. **Declare types explicitly** — `POST /config/validate` catches missing types before files do
4. **Add `uiHint` deliberately** — Every exposed filter field is a conscious decision
5. **Test type coercion** — Verify integer/number fields parse correctly (check logs)
6. **Order rules intentionally** — Later rules override earlier ones on conflict
7. **Monitor issues file** — `GET /issues` surfaces problems before they become mysteries
8. **Use values index for dropdowns** — Pair `uiHint: "select"` with runtime values for dynamic enums
9. **Avoid reserved names** — Never name a property after a system payload field

---

## Migration from v1 to v2

**Before (v0.4.x, no longer valid):**

```json
{
  "inferenceRules": [
    {
      "match": { "type": "object" },
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
      "match": { "type": "object" },
      "schema": [
        "base",
        {
          "properties": {
            "domain": { "set": "jira" },
            "status": {
              "type": "string",
              "description": "Current workflow status",
              "set": "{{json.current.fields.status.name}}"
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
6. Test with `jeeves-watcher config validate -c <path>`, then `POST /config/validate`

---

## Content Rendering (`renderAs`)

When a rule includes `template` or `render`, the `renderAs` field declares the output content type as a file extension (without dot):

```json
{
  "name": "slack-message",
  "description": "Slack channel messages",
  "match": { "type": "object" },
  "schema": ["base", "slack-common"],
  "render": {
    "frontmatter": ["channelName", "userName"],
    "body": [{ "path": "text", "heading": 2 }]
  },
  "renderAs": "md"
}
```

**Resolution order** for files (used by `POST /render`):

1. `renderAs` from the last matching rule that declares it
2. File extension of the source file (e.g. `.md` → `"md"`)
3. `"txt"` for extensionless files

A source document renders as `"md"` when its rule produced content, else `"json"`.

**Validation:** `renderAs` must be 1–10 lowercase alphanumeric characters (`/^[a-z0-9]{1,10}$/`). The config rejects `renderAs` if neither `template` nor `render` is present on the rule.

---

## Reference: Full Schema

```typescript
interface InferenceRule {
  name: string; // Required unique identifier
  description: string; // Required human-readable description
  match: Record<string, unknown>; // Required JSON Schema object
  schema?: SchemaReference[]; // Array of named refs and inline objects
  map?: Record<string, unknown> | string; // JsonMap definition, named map ref, or .json file path
  template?: string; // Handlebars template (inline, named ref, or file path)
  render?: RenderConfig; // Declarative structured renderer (mutually exclusive with template)
  renderAs?: string; // Output file extension override (requires template or render)
}

type SchemaReference =
  | string // Named reference to a global schema
  | { type?: 'object'; properties?: Record<string, ResolvedProperty> };

interface ResolvedProperty {
  type?: string; // JSON Schema type (required after merging)
  description?: string; // Human-readable description
  uiHint?: string; // UI rendering hint
  enum?: unknown[]; // Enum values
  items?: Record<string, unknown>; // Items schema for arrays
  set?: string | unknown[]; // Interpolation template or array value
  [keyword: string]: unknown; // Other JSON Schema keywords
}
```

See [Configuration Reference](./configuration.md) for integration into the main config.
