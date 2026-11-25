/**
 * @module mcp/watcherMcpServer.test
 * The watcher's MCP server over a stub transport: its tool set and hints, descriptions without harness wording, the `config` alias and `rules` reindex default the skill documents and the status probe timeout, and instructions and skill written for any agent.
 */

import { DEFAULT_FETCH_TIMEOUT_MS } from '@karmaniverous/jeeves';
import type {
  CatalogResponse,
  CatalogTransport,
} from '@karmaniverous/jeeves/catalog';
import { WATCHER_SKILL } from '@karmaniverous/jeeves-watcher-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createWatcherMcpServer,
  SKILL_URI,
  STATUS_TIMEOUT_MS,
} from './watcherMcpServer';

type TransportMock = ReturnType<typeof vi.fn<CatalogTransport>>;

const reply = (status: number, body: unknown): CatalogResponse =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

async function connect(
  transport: TransportMock = vi
    .fn<CatalogTransport>()
    .mockImplementation(() => Promise.resolve(reply(200, {}))),
) {
  const server = createWatcherMcpServer({ version: '0.0.0-test', transport });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, transport };
}

const sent = (transport: TransportMock) => transport.mock.calls.at(-1)?.[0];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createWatcherMcpServer', () => {
  it('lists 21 tools with hints from the catalog and no destructive housekeeping', async () => {
    const { client } = await connect();

    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));

    expect(tools).toHaveLength(21);
    expect(byName.get('watcher_search')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('watcher_revert_vcs')?.annotations?.destructiveHint).toBe(
      true,
    );
    for (const absent of [
      'watcher_delete_points',
      'watcher_delete_documents',
      'watcher_notify_documents',
      'watcher_service',
    ])
      expect(byName.has(absent)).toBe(false);
  });

  it('describes when to use each tool, without harness-specific wording', async () => {
    const { client } = await connect();

    const { tools } = await client.listTools();

    expect(tools.find((t) => t.name === 'watcher_scan')?.description).toContain(
      'Use for structural queries',
    );
    for (const tool of tools)
      expect(tool.description).not.toMatch(/tool_call|OpenClaw|plugin/);
  });

  it('takes the config patch as config and sends it as patch', async () => {
    const { client, transport } = await connect();

    await client.callTool({
      name: 'watcher_config_apply',
      arguments: { config: { search: {} } },
    });

    expect(sent(transport)?.body).toMatchObject({ patch: { search: {} } });
  });

  it('sends reindex scope rules unless the caller gives one', async () => {
    const { client, transport } = await connect();

    await client.callTool({ name: 'watcher_reindex', arguments: {} });
    expect(sent(transport)?.body).toMatchObject({ scope: 'rules' });

    await client.callTool({
      name: 'watcher_reindex',
      arguments: { scope: 'issues' },
    });
    expect(sent(transport)?.body).toMatchObject({ scope: 'issues' });
  });

  it('gives watcher_status the 5 s probe timeout and other tools the default', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { client } = await connect();

    await client.callTool({ name: 'watcher_status', arguments: {} });
    await client.callTool({ name: 'watcher_list_issues', arguments: {} });

    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([
      STATUS_TIMEOUT_MS,
      DEFAULT_FETCH_TIMEOUT_MS,
    ]);
  });

  it('reports a non-2xx reply as an error carrying the watcher code', async () => {
    const { client } = await connect(
      vi.fn<CatalogTransport>().mockResolvedValue(
        reply(503, {
          statusCode: 503,
          code: 'WATCHER_EMBEDDING_UNAVAILABLE',
          error: 'Service Unavailable',
          message: 'embeddings failing',
        }),
      ),
    );

    const result = await client.callTool({
      name: 'watcher_search',
      arguments: { query: 'x' },
    });

    expect(result.isError).toBe(true);
    expect((result.content as [{ text: string }])[0].text).toContain(
      'WATCHER_EMBEDDING_UNAVAILABLE',
    );
  });

  it('writes instructions for any agent that name the skill resource', async () => {
    const { client } = await connect();

    const instructions = client.getInstructions() ?? '';

    expect(instructions).toContain('watcher_search');
    expect(instructions).toContain(SKILL_URI);
    for (const term of ['memory_search', 'exec', 'OpenClaw', 'plugin'])
      expect(instructions).not.toContain(term);
  });

  it('serves the skill with a preface after its front matter', async () => {
    const { client } = await connect();

    const { contents } = await client.readResource({ uri: SKILL_URI });
    const text = (contents[0] as { text: string }).text;
    const body = WATCHER_SKILL.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');

    expect(text).toContain('Using this skill over MCP');
    expect(text).toContain('(21 of them)');
    expect(text.endsWith(body)).toBe(true);
  });
});

describe('invalid input', () => {
  it('is refused without calling the watcher', async () => {
    const { client, transport } = await connect();

    const result = await client.callTool({
      name: 'watcher_search',
      arguments: { query: '' },
    });

    expect(result.isError).toBe(true);
    expect((result.content as [{ text: string }])[0].text).toMatch(
      /^Error: Invalid input for "search"/,
    );
    expect(transport).not.toHaveBeenCalled();
  });
});
