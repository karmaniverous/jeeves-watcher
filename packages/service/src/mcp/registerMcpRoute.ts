/**
 * @module mcp/registerMcpRoute
 * `POST /mcp`: the watcher's MCP endpoint (Streamable HTTP, stateless: one MCP server per request). The app's auth hook admits the request like any other route (`api.apiKey`). Each tool call is a new request to the watcher's own routes (`injectTransport`), which the hook checks again, so it carries the caller's `Authorization` header, copied as sent. `GET` and `DELETE /mcp` (session streams and termination) answer 405.
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance } from 'fastify';

import { injectTransport } from './injectTransport';
import { createWatcherMcpServer } from './watcherMcpServer';

/** Path of the MCP endpoint. */
export const MCP_PATH = '/mcp';

/**
 * Register the MCP endpoint on the watcher's app.
 *
 * @remarks
 * The MCP server is created and connected before the reply is handed to the
 * MCP transport, so a failure there reaches the app's error handler (masked
 * `500`, cause logged) like any route's. From then on the MCP SDK answers,
 * its errors as JSON-RPC.
 *
 * @param app - The watcher's Fastify app (auth and error hooks registered).
 * @param options - Server version reported to clients.
 */
export function registerMcpRoute(
  app: FastifyInstance,
  options: { version: string },
): void {
  app.post(MCP_PATH, async (request, reply) => {
    const { authorization } = request.headers;
    const server = createWatcherMcpServer({
      version: options.version,
      transport: injectTransport(app, authorization ? { authorization } : {}),
    });
    const mcp = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(mcp);

    reply.hijack();
    reply.raw.on('close', () => {
      void mcp.close();
      void server.close();
    });
    await mcp.handleRequest(request.raw, reply.raw, request.body);
  });

  // Stateless: no session stream to open (GET) or end (DELETE).
  app.route({
    method: ['GET', 'DELETE'],
    url: MCP_PATH,
    handler: (_request, reply) =>
      reply
        .code(405)
        .header('allow', 'POST')
        .send({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Method not allowed: this endpoint is stateless',
          },
          id: null,
        }),
  });
}
