/**
 * @module mcp/catalogMcpServer
 * An MCP server over an endpoint catalog: one tool per selected entry (jeeves's shared `catalogToolDefinition`), each call built with `toolInputToRequest` and sent through a `CatalogTransport`; the rules as `instructions`, the skill as a resource. Component-agnostic: nothing here is watcher-specific, so it can move to `@karmaniverous/jeeves/mcp` (jeeves#136) for every component.
 */

import { fail, getErrorMessage, type ToolResult } from '@karmaniverous/jeeves';
import {
  type Catalog,
  type CatalogEntry,
  catalogToolDefinition,
  type CatalogTransport,
  toolInputToRequest,
  toolResultFromResponse,
} from '@karmaniverous/jeeves/catalog';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

/** Overrides for one selected entry. */
export interface CatalogMcpToolOptions {
  /** Description override; default the entry's. */
  description?: string;
  /** Tool parameter names for entry fields (e.g. `{ patch: 'config' }`). */
  inputAliases?: Readonly<Record<string, string>>;
  /** Parameters sent when the caller omits them. */
  defaults?: Readonly<Record<string, unknown>>;
  /** Per-call timeout in milliseconds; default the server's `timeoutMs`. */
  timeoutMs?: number;
}

/** A skill served as an MCP resource. */
export interface CatalogMcpSkill {
  /** Resource URI. */
  uri: string;
  /** Resource name. */
  name: string;
  /** Markdown content. */
  text: string;
}

/** Options for {@link createCatalogMcpServer}. */
export interface CatalogMcpServerOptions<C extends Catalog> {
  /** MCP server name. */
  name: string;
  /** MCP server version. */
  version: string;
  /** The endpoint catalog. */
  catalog: C;
  /** Tool name prefix (the component name). */
  prefix: string;
  /** Selected entries; unselected entries get no tool. */
  tools: Partial<
    Record<C['entries'][number]['name'], true | CatalogMcpToolOptions>
  >;
  /** How requests reach the service, with the caller's credentials. */
  transport: CatalogTransport;
  /** Default per-call timeout in milliseconds. */
  timeoutMs: number;
  /** Always-on rules, sent as the server `instructions`. */
  instructions?: string;
  /** The component skill. */
  skill?: CatalogMcpSkill;
}

/** One built tool: its definition and how to call it. */
interface BuiltTool {
  definition: Tool;
  entry: CatalogEntry;
  options: CatalogMcpToolOptions;
}

/**
 * A jeeves tool result as an MCP one (same shape; `isError` always set).
 *
 * @param result - jeeves `ok`/`fail`/`toolResultFromResponse` result.
 * @returns The MCP tool result.
 */
const toCallToolResult = (result: ToolResult): CallToolResult => ({
  content: result.content.map(({ text }) => ({ type: 'text', text })),
  isError: result.isError === true,
});

/**
 * Build the selected tools, in catalog order.
 *
 * @param options - Catalog, prefix and selection.
 * @returns The tools, keyed by tool name.
 */
function buildTools<C extends Catalog>(
  options: CatalogMcpServerOptions<C>,
): Map<string, BuiltTool> {
  const selection = options.tools as Partial<
    Record<string, true | CatalogMcpToolOptions>
  >;
  const tools = new Map<string, BuiltTool>();
  for (const entry of options.catalog.entries) {
    const selected = selection[entry.name];
    if (selected === undefined) continue;
    const toolOptions = selected === true ? {} : selected;
    const { name, description, inputSchema, annotations } =
      catalogToolDefinition(entry, {
        prefix: options.prefix,
        ...(toolOptions.description
          ? { description: toolOptions.description }
          : {}),
        ...(toolOptions.inputAliases
          ? { inputAliases: toolOptions.inputAliases }
          : {}),
      });
    tools.set(name, {
      definition: {
        name,
        description,
        inputSchema: inputSchema as Tool['inputSchema'],
        annotations,
      },
      entry,
      options: toolOptions,
    });
  }
  return tools;
}

/**
 * Call one tool: build the request, send it through the transport and map
 * the response with jeeves's shared tool-result mapping.
 *
 * @param tool - The built tool.
 * @param args - Tool arguments.
 * @param options - Transport and timeout.
 * @returns The tool result.
 */
async function callTool<C extends Catalog>(
  tool: BuiltTool,
  args: Record<string, unknown>,
  options: CatalogMcpServerOptions<C>,
): Promise<CallToolResult> {
  let request;
  try {
    request = toolInputToRequest(
      tool.entry,
      { ...tool.options.defaults, ...args },
      tool.options.inputAliases,
    );
  } catch (error) {
    return toCallToolResult(fail(error));
  }
  try {
    const res = await options.transport(
      request,
      AbortSignal.timeout(tool.options.timeoutMs ?? options.timeoutMs),
    );
    return toCallToolResult(await toolResultFromResponse(tool.entry, res));
  } catch (error) {
    return toCallToolResult(
      fail(`service not reachable: ${getErrorMessage(error)}`),
    );
  }
}

/**
 * Create an MCP server over a catalog. Connect it to any MCP transport
 * (stdio, Streamable HTTP).
 *
 * @param options - Catalog, selection, transport and content.
 * @returns The server.
 */
export function createCatalogMcpServer<C extends Catalog>(
  options: CatalogMcpServerOptions<C>,
): McpServer {
  const tools = buildTools(options);
  const mcp = new McpServer(
    { name: options.name, version: options.version },
    {
      capabilities: { tools: {} },
      ...(options.instructions ? { instructions: options.instructions } : {}),
    },
  );

  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...tools.values()].map(({ definition }) => definition),
  }));
  mcp.server.setRequestHandler(CallToolRequestSchema, (request) => {
    const tool = tools.get(request.params.name);
    if (!tool)
      return toCallToolResult(fail(`unknown tool: ${request.params.name}`));
    return callTool(tool, request.params.arguments ?? {}, options);
  });

  const { skill } = options;
  if (skill)
    mcp.registerResource(
      skill.name,
      skill.uri,
      { mimeType: 'text/markdown', description: `${skill.name} skill` },
      (uri) => ({
        contents: [
          { uri: uri.href, mimeType: 'text/markdown', text: skill.text },
        ],
      }),
    );

  return mcp;
}
