/**
 * @module http.test
 * Transport over a real local node:http server with the global fetch: headers and body on the wire, query string, server error bodies, connection refused and a real timeout.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createWatcherClient } from './createWatcherClient';

interface Seen {
  method?: string;
  url?: string;
  authorization?: string;
  contentType?: string;
  body: string;
}

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

describe('client over real HTTP', () => {
  let server: Server;
  let baseUrl: string;
  let seen: Seen = { body: '' };

  beforeAll(async () => {
    server = createServer((req, res) => {
      void readBody(req).then((body) => {
        seen = {
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          contentType: req.headers['content-type'],
          body,
        };
        if (req.url === '/issues') {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
        } else if (req.url === '/status') {
          setTimeout(() => res.end('{}'), 500);
        } else {
          res.writeHead(202, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ accepted: ['cg://a/1'], rejected: [] }));
        }
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${String(port)}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('sends method, path, Bearer header and JSON body', async () => {
    const watcher = createWatcherClient({ baseUrl, apiKey: 'k1' });
    await expect(
      watcher.documents.notify([{ source: 'cg://a/1', rule: 'r' }]),
    ).resolves.toEqual({ accepted: ['cg://a/1'], rejected: [] });
    expect(seen).toEqual({
      method: 'POST',
      url: '/documents',
      authorization: 'Bearer k1',
      contentType: 'application/json',
      body: JSON.stringify({ documents: [{ source: 'cg://a/1', rule: 'r' }] }),
    });
  });

  it('maps a 401 error body', async () => {
    const watcher = createWatcherClient({ baseUrl });
    await expect(watcher.issues()).rejects.toMatchObject({
      status: 401,
      code: 'Unauthorized',
    });
    expect(seen.authorization).toBeUndefined();
  });

  it('times out a slow response', async () => {
    const watcher = createWatcherClient({ baseUrl, timeoutMs: 50 });
    await expect(watcher.status()).rejects.toMatchObject({ code: 'timeout' });
  });

  it('maps connection refused to network_error', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => {
      closed.listen(0, '127.0.0.1', resolve);
    });
    const { port } = closed.address() as AddressInfo;
    await new Promise((resolve) => closed.close(resolve));
    const watcher = createWatcherClient({
      baseUrl: `http://127.0.0.1:${String(port)}`,
    });
    await expect(watcher.status()).rejects.toMatchObject({
      code: 'network_error',
    });
  });
});
