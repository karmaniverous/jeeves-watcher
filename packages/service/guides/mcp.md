---
title: MCP
---

# MCP

**Unreleased.** The watcher serves its tools to any MCP client or agent harness (Claude Code, OpenCode, Codex, Cursor and others) at `POST /mcp` on its own port, over Streamable HTTP. (OpenClaw has its own [plugin](../../openclaw/guides/openclaw-integration.md), which stays its interface: jeeves spec Decision 78.)

```bash
claude mcp add --transport http jeeves-watcher http://127.0.0.1:1936/mcp
# With api.apiKey set:
claude mcp add --transport http jeeves-watcher http://127.0.0.1:1936/mcp --header "Authorization: Bearer <api.apiKey>"
```

Or in a project `.mcp.json`:

```json
{
  "mcpServers": {
    "jeeves-watcher": {
      "type": "http",
      "url": "http://127.0.0.1:1936/mcp",
      "headers": { "Authorization": "Bearer ${JEEVES_WATCHER_API_KEY}" }
    }
  }
}
```

## How it works

Every tool is generated from the endpoint catalog (`WATCHER_CATALOG`), as the [SDK](../../sdk/guides/sdk-guide.md)'s methods are, and every tool call runs through the watcher's own routes:

| Module (`src/mcp/`) | Role |
| --- | --- |
| `catalogMcpServer.ts` | Any catalog to an MCP server: one tool per selected entry, defined by jeeves's `catalogToolDefinition` (name `<prefix>_<snake_case entry>`, input schema from the entry's Zod schemas, hints from its `kind`). A call is built with `toolInputToRequest`, the credential attached, sent through a `CatalogTransport` and mapped with `toolResultFromResponse`. Nothing in it is watcher-specific. |
| `injectTransport.ts` | The `CatalogTransport`: jeeves's `httpTransport` (which builds every request) over a `fetch` answered by Fastify `inject` into the watcher's own app, so a tool call passes the auth hook, validation, handlers, caching and error mapping exactly as an HTTP request does. |
| `watcherMcpServer.ts`, `toolDescriptions.ts`, `mcpContent.ts` | The watcher's tool selection and descriptions, instructions and skill. |
| `registerMcpRoute.ts` | `POST /mcp`: one stateless MCP server per request. `GET` and `DELETE /mcp` answer `405`. |

## Authentication

`/mcp` is a route like any other: with `api.apiKey` set, the [API-key hook](./api-reference.md#authentication) answers `401 WATCHER_UNAUTHORIZED` to a request without `Authorization: Bearer <key>`, before any tool is listed or called. The caller's key is then sent on every tool call, which the hook checks again on the route the call reaches. Without `api.apiKey` the endpoint is open, as the watcher is.

## Tools

Hints come from the catalog entry's `kind`: `read` sets `readOnlyHint`, `destructive` sets `destructiveHint`, which clients use for approval prompts.

| Tool | Route | Kind |
| --- | --- | --- |
| `watcher_status` | GET /status | read |
| `watcher_config` | GET /config | read |
| `watcher_config_apply` | POST /config/apply | write |
| `watcher_match_config` | POST /config/match | read |
| `watcher_validate_config` | POST /config/validate | read |
| `watcher_search` | POST /search | read |
| `watcher_scan` | POST /scan | read |
| `watcher_list_facets` | GET /search/facets | read |
| `watcher_count_facets` | POST /search/facets/counts | read |
| `watcher_render` | POST /render | read |
| `watcher_walk` | POST /walk | read |
| `watcher_list_issues` | GET /issues | read |
| `watcher_get_vcs_status` | GET /vcs/status | read |
| `watcher_list_vcs_history` | GET /vcs/history | read |
| `watcher_show_vcs_file` | GET /vcs/show | read |
| `watcher_diff_vcs` | GET /vcs/diff | read |
| `watcher_check_vcs_exclusion` | GET /vcs/check-exclusion | read |
| `watcher_set_metadata` | POST /metadata | write |
| `watcher_reindex` | POST /reindex | write |
| `watcher_revert_vcs` | POST /vcs/revert | destructive |
| `watcher_exclude_vcs_path` | POST /vcs/exclude | destructive |

Not tools: `deletePoints`, `deleteDocuments`, `unregisterRules`, `unregisterRulesBySource` (destructive housekeeping), `notifyDocuments`, `registerRules` (called by source-owning applications), `rebuildMetadata` and `getConfigSchema`. Managing the OS service is not a tool either: use the `jeeves-watcher service` CLI.

As the skill documents:

- `watcher_config_apply` takes the patch as `config` (sent as `patch`).
- `watcher_reindex` sends scope `rules` when none is given (the HTTP API's own default is `issues`).
- `watcher_status` stops waiting after 5 s; every other tool after 120 s (jeeves's `DEFAULT_FETCH_TIMEOUT_MS`). The route keeps running: a timeout never cancels work the watcher has started.

Descriptions say what each tool is for and when to prefer it (`toolDescriptions.ts`), beyond the catalog's one-line entry descriptions. The same text is in the OpenClaw plugin; moving it into watcher-core's catalog would let both generate it from one copy.

## Instructions and skill

- **Instructions** (sent on connect): the watcher's always-on rules, written for any agent: search before grep or file reads in indexed paths, scan or count facets for structural questions, score thresholds, where the inventory is, and the skill resource to read before configuring or diagnosing.
- **Resource** `skill://jeeves-watcher/SKILL.md`: watcher-core's `WATCHER_SKILL`, with a preface after its front matter. The skill is shared with the OpenClaw plugin and has a few plugin-only parts (installation, `openclaw.json`, `watcher_service`); the preface tells the model to skip them. Clients do not load resources into context by themselves; the instructions name it so the model can.

## Results and errors

| Outcome | Result |
| --- | --- |
| 2xx JSON | The JSON, pretty-printed |
| 2xx text (`watcher_show_vcs_file`, `watcher_diff_vcs`) | The text |
| Non-2xx | `isError`, `Error: HTTP <status>: <body>` with the watcher's error body (branch on its `code`) |
| Invalid input | `isError`, `Error: Invalid input for "<entry>": ...`; nothing is sent |
| Timed out | `isError`, `Error: service not reachable: <reason>` |
| Unknown tool | `isError`, `Error: unknown tool: <name>` |

At the HTTP level `/mcp` answers `401 WATCHER_UNAUTHORIZED` without a valid key (when `api.apiKey` is set), `405` for `GET` and `DELETE`, and the watcher's own `400` for a body that is not JSON and masked `500` (cause logged) when setting up the request fails. Past setup, the MCP SDK answers malformed MCP messages with JSON-RPC errors.
