/**
 * @module api/mcp/registerWatcherMcp.test
 * `/mcp` on the real API server (`createApiServer`, stub dependencies, no Qdrant): the watcher's auth hook guards it (one key or named keys), tool calls reach the watcher's own routes with the caller's key, and the MCP handshake carries the instructions and skill. Without `@modelcontextprotocol/server` the endpoint is skipped with one log line; any other import failure fails the boot.
 */

import type { ApiConfig } from '@karmaniverous/jeeves-watcher-core';
import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../../config/types';
import { VirtualRuleStore } from '../../rules/virtualRules';
import type { ApiServerOptions } from '../apiServerOptions';
import { createApiServer } from '../index';
import { MCP_PEER, registerWatcherMcp, SKILL_URI } from './registerWatcherMcp';

const MCP_PATH = '/mcp';

const KEY = 'test-api-key';
const ISSUES = {
  '/data/a.md': [{ type: 'no_content', message: 'empty', timestamp: 1 }],
};

/** A server over stubs, with or without `api.apiKey` (one key or named keys). */
function server(apiKey?: ApiConfig['apiKey']): FastifyInstance {
  const config = {
    watch: { paths: ['**/*.md'], ignored: [] },
    embedding: { provider: 'mock', model: 'test', dimensions: 3 },
    vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
    api: { cacheTtlMs: 0, ...(apiKey ? { apiKey } : {}) },
  } as unknown as JeevesWatcherConfig;
  return createApiServer({
    config,
    configPath: '/tmp/jeeves-watcher-test/config.json',
    processor: {},
    vectorStore: {},
    embeddingProvider: {},
    logger: pino({ level: 'silent' }),
    descriptor: {},
    issuesManager: { getAll: () => ISSUES },
    valuesManager: {},
    virtualRuleStore: new VirtualRuleStore(),
    version: '9.9.9',
  } as unknown as ApiServerOptions);
}

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

/** One JSON-RPC request to `/mcp`. */
async function rpc(
  method: string,
  params: Record<string, unknown> = {},
  key?: string,
) {
  return app.inject({
    method: 'POST',
    url: MCP_PATH,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    payload: { jsonrpc: '2.0', id: 1, method, params },
  });
}

/** The JSON-RPC result of a reply: one SSE `message` event (2025-era stateless serving). */
function resultOf(res: { body: string }): unknown {
  const data = /^data: (.*)$/m.exec(res.body);
  if (!data) throw new Error(`no SSE data: ${res.body}`);
  return (JSON.parse(data[1]) as { result: unknown }).result;
}

describe('POST /mcp', () => {
  it('answers 401 WATCHER_UNAUTHORIZED without a valid key, as every guarded route does', async () => {
    app = server(KEY);

    for (const key of [undefined, 'wrong']) {
      const res = await rpc('tools/list', {}, key);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ code: 'WATCHER_UNAUTHORIZED' });
    }
  });

  it('lists the 21 tools to a caller with the key', async () => {
    app = server(KEY);

    const res = await rpc('tools/list', {}, KEY);

    expect(res.statusCode).toBe(200);
    expect((resultOf(res) as { tools: unknown[] }).tools).toHaveLength(21);
  });

  it('runs a tool call through the watcher route with the caller key', async () => {
    app = server(KEY);

    const res = await rpc(
      'tools/call',
      { name: 'watcher_list_issues', arguments: {} },
      KEY,
    );
    const result = resultOf(res) as {
      isError: boolean;
      content: { text: string }[];
    };

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text)).toEqual({
      count: 1,
      issues: ISSUES,
    });
  });

  it('accepts each named key on /mcp and on a REST route, and refuses any other', async () => {
    app = server({ alice: 'alice-key', bob: 'bob-key' });

    for (const key of ['alice-key', 'bob-key']) {
      expect((await rpc('tools/list', {}, key)).statusCode).toBe(200);
      const rest = await app.inject({
        method: 'GET',
        url: '/issues',
        headers: { authorization: `Bearer ${key}` },
      });
      expect(rest.statusCode).toBe(200);
    }
    for (const key of [KEY, 'alice']) {
      expect((await rpc('tools/list', {}, key)).statusCode).toBe(401);
    }
  });

  it('is open, as the watcher is, when no key is configured', async () => {
    app = server();

    const res = await rpc('tools/call', {
      name: 'watcher_list_issues',
      arguments: {},
    });

    expect((resultOf(res) as { isError: boolean }).isError).toBe(false);
  });

  it('answers initialize with the server version, instructions and the skill resource', async () => {
    app = server();

    const init = resultOf(
      await rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      }),
    ) as {
      serverInfo: { name: string; version: string };
      instructions: string;
      capabilities: { resources?: unknown };
    };

    expect(init.serverInfo).toEqual({
      name: 'jeeves-watcher',
      version: '9.9.9',
    });
    expect(init.instructions).toContain(SKILL_URI);
    expect(init.capabilities.resources).toBeDefined();
  });

  it('answers 405 for GET and DELETE', async () => {
    app = server();

    for (const method of ['GET', 'DELETE'] as const) {
      const res = await app.inject({ method, url: MCP_PATH });
      expect(res.statusCode).toBe(405);
    }
  });
});

describe('registerWatcherMcp loading', () => {
  it(`skips /mcp with one log line when ${MCP_PEER} is not installed`, async () => {
    const logger = { info: vi.fn() };
    app = Fastify();
    registerWatcherMcp(app, {
      version: '0',
      logger,
      load: () =>
        Promise.reject(
          Object.assign(
            new Error(`Cannot find package '${MCP_PEER}' imported from x`),
            { code: 'ERR_MODULE_NOT_FOUND' },
          ),
        ),
    });

    const res = await app.inject({ method: 'POST', url: MCP_PATH });

    expect(res.statusCode).toBe(404);
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(
      `MCP endpoint disabled: install ${MCP_PEER} to serve /mcp`,
    );
  });

  it.each([
    ['another missing package', { code: 'ERR_MODULE_NOT_FOUND' }, 'zod'],
    ['an error that is not a missing package', {}, MCP_PEER],
  ])('fails the boot on %s', async (_label, extra, name) => {
    const logger = { info: vi.fn() };
    app = Fastify();
    registerWatcherMcp(app, {
      version: '0',
      logger,
      load: () =>
        Promise.reject(
          Object.assign(new Error(`Cannot find package '${name}'`), extra),
        ),
    });

    await expect(app.ready()).rejects.toThrow(`Cannot find package '${name}'`);
    expect(logger.info).not.toHaveBeenCalled();
  });
});
