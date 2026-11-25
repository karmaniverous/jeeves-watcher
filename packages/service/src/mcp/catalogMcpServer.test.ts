/**
 * @module mcp/catalogMcpServer.test
 * `createCatalogMcpServer` over a small catalog of its own and a stub transport: tool selection, description overrides, aliases and defaults, per-tool timeouts, and hints from `kind`, and the error results.
 */

import {
  type CatalogResponse,
  type CatalogTransport,
  defineCatalog,
} from '@karmaniverous/jeeves/catalog';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  type CatalogMcpServerOptions,
  createCatalogMcpServer,
} from './catalogMcpServer';

const CATALOG = defineCatalog([
  {
    name: 'getThing',
    method: 'GET',
    path: '/things/:id',
    description: 'Get a thing.',
    params: z.object({ id: z.string() }),
    response: z.object({ id: z.string() }),
    auth: 'none',
    kind: 'read',
  },
  {
    name: 'putThing',
    method: 'POST',
    path: '/things',
    description: 'Store a thing.',
    body: z.object({ value: z.string(), mode: z.string().optional() }),
    response: z.object({ ok: z.boolean() }),
    auth: { schemes: [{ in: 'bearer' }] },
    kind: 'write',
  },
  {
    name: 'dropAll',
    method: 'POST',
    path: '/drop',
    description: 'Drop everything.',
    response: z.object({ ok: z.boolean() }),
    auth: 'none',
    kind: 'destructive',
  },
]);

type Options = CatalogMcpServerOptions<typeof CATALOG>;

const reply = (body: unknown): CatalogResponse =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

async function connect(
  overrides: Partial<Omit<Options, 'transport'>> & {
    transport?: ReturnType<typeof vi.fn<CatalogTransport>>;
  } = {},
) {
  const transport =
    overrides.transport ??
    vi.fn<CatalogTransport>().mockResolvedValue(reply({ id: '1' }));
  const server = createCatalogMcpServer({
    name: 'things',
    version: '1.0.0',
    catalog: CATALOG,
    prefix: 'things',
    tools: { getThing: true },
    timeoutMs: 1_000,
    ...overrides,
    transport,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, transport };
}

const textOf = (result: Awaited<ReturnType<Client['callTool']>>) =>
  (result.content as [{ text: string }])[0].text;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createCatalogMcpServer', () => {
  it('builds tools only for selected entries, with catalog descriptions by default', async () => {
    const { client } = await connect({
      tools: {
        getThing: true,
        putThing: { description: 'Custom.', inputAliases: { value: 'text' } },
      },
    });

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name)).toEqual([
      'things_get_thing',
      'things_put_thing',
    ]);
    expect(tools[0].description).toBe('Get a thing.');
    expect(tools[1].description).toBe('Custom.');
    expect(tools[1].inputSchema.properties).toHaveProperty('text');
    expect(tools[1].inputSchema.properties).not.toHaveProperty('value');
  });

  it('maps an alias back to its entry field and fills defaults the caller omits', async () => {
    const { client, transport } = await connect({
      tools: {
        putThing: { inputAliases: { value: 'text' }, defaults: { mode: 'a' } },
      },
      transport: vi
        .fn<CatalogTransport>()
        .mockResolvedValue(reply({ ok: true })),
    });

    const result = await client.callTool({
      name: 'things_put_thing',
      arguments: { text: 'hello' },
    });

    expect(result.isError).toBe(false);
    expect(transport.mock.calls[0][0].body).toEqual({
      value: 'hello',
      mode: 'a',
    });
  });

  it('sends the built request through the transport', async () => {
    const transport = vi
      .fn<CatalogTransport>()
      .mockResolvedValue(reply({ ok: true }));
    const { client } = await connect({
      tools: { putThing: { defaults: { mode: 'a' } } },
      transport,
    });

    await client.callTool({
      name: 'things_put_thing',
      arguments: { value: 'v', mode: 'b' },
    });

    const [request] = transport.mock.calls[0];
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/things');
    expect(request.body).toEqual({ value: 'v', mode: 'b' });
  });

  it('uses the per-tool timeout over the server default', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { client } = await connect({
      tools: { getThing: { timeoutMs: 50 }, putThing: true },
      transport: vi
        .fn<CatalogTransport>()
        .mockImplementation(() =>
          Promise.resolve(reply({ id: '1', ok: true })),
        ),
    });

    await client.callTool({ name: 'things_get_thing', arguments: { id: '1' } });
    await client.callTool({
      name: 'things_put_thing',
      arguments: { value: 'v' },
    });

    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([50, 1_000]);
  });

  it('derives annotations from the entry kind', async () => {
    const { client } = await connect({
      tools: { getThing: true, putThing: true, dropAll: true },
    });

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.annotations ?? {})).toEqual([
      { readOnlyHint: true },
      {},
      { destructiveHint: true },
    ]);
  });

  it('accepts a call with no arguments', async () => {
    const transport = vi
      .fn<CatalogTransport>()
      .mockResolvedValue(reply({ ok: true }));
    const { client } = await connect({ tools: { dropAll: true }, transport });

    const result = await client.callTool({ name: 'things_drop_all' });

    expect(result.isError).toBe(false);
    expect(transport).toHaveBeenCalledOnce();
  });

  it('reports a transport failure that is not an Error', async () => {
    const { client } = await connect({
      transport: vi.fn<CatalogTransport>().mockRejectedValue('socket hang up'),
    });

    const result = await client.callTool({
      name: 'things_get_thing',
      arguments: { id: '1' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Error: service not reachable: socket hang up');
  });

  it('refuses an unselected entry as an unknown tool', async () => {
    const { client, transport } = await connect();

    const result = await client.callTool({
      name: 'things_drop_all',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Error: unknown tool: things_drop_all');
    expect(transport).not.toHaveBeenCalled();
  });

  it('serves no instructions and no resources when none are given', async () => {
    const { client } = await connect();

    expect(client.getInstructions()).toBeUndefined();
    expect(client.getServerCapabilities()?.resources).toBeUndefined();
  });
});
