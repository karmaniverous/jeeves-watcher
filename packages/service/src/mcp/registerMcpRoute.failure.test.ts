/**
 * @module mcp/registerMcpRoute.failure.test
 * A failure while setting up an MCP request reaches the watcher's error handler: a masked `500` (no cause in the body) and the cause logged through the watcher's logger, as for any route.
 */

import Fastify from 'fastify';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { registerApiHooks } from '../api/apiHooks';
import type * as WatcherMcpServerModule from './watcherMcpServer';

const { createWatcherMcpServer } = vi.hoisted(() => ({
  createWatcherMcpServer: vi.fn(),
}));

vi.mock('./watcherMcpServer', async (importOriginal) => ({
  ...(await importOriginal<typeof WatcherMcpServerModule>()),
  createWatcherMcpServer,
}));

const { MCP_PATH, registerMcpRoute } = await import('./registerMcpRoute');

describe('POST /mcp when setup fails', () => {
  it('answers the watcher masked 500 and logs the cause', async () => {
    createWatcherMcpServer.mockReturnValue({
      connect: () => Promise.reject(new Error('secret internal detail')),
      close: () => Promise.resolve(),
    });
    const logger = pino({ level: 'silent' });
    const logged = vi.spyOn(logger, 'error');
    const app = Fastify();
    registerApiHooks(app, undefined, logger);
    registerMcpRoute(app, { version: '0' });

    const res = await app.inject({
      method: 'POST',
      url: MCP_PATH,
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ statusCode: 500 });
    expect(res.json()).not.toHaveProperty('code');
    expect(res.body).not.toContain('secret');
    expect(logged).toHaveBeenCalled();
    await app.close();
  });
});
