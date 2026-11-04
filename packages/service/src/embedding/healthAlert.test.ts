/**
 * @module embedding/healthAlert.test
 * The embedding alert (D89): POSTs event, at, service, version, host, collection, failingSince and lastError to embedding.alertUrl, read at each transition (a reload applies); no URL sends nothing; delivery runs in the background and settles.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import type { EmbeddingTransition } from './EmbeddingHealth';
import { createEmbeddingAlert } from './healthAlert';

const logger = pino({ level: 'silent' });

const failed: EmbeddingTransition = {
  event: 'embedding_failed',
  at: '2026-11-04T00:01:00.000Z',
  failingSince: '2026-11-04T00:01:00.000Z',
  lastError: { at: '2026-11-04T00:01:00.000Z', code: 'http_503' },
};

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise((r) => server?.close(r));
  server = undefined;
});

/** A receiver recording each JSON body. */
async function receiver(): Promise<{ url: string; bodies: unknown[] }> {
  const bodies: unknown[] = [];
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      bodies.push(JSON.parse(raw));
      res.end();
    });
  });
  await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${String(port)}/alert`, bodies };
}

describe('createEmbeddingAlert', () => {
  it('POSTs the alert body to the configured URL', async () => {
    const { url, bodies } = await receiver();
    const alert = createEmbeddingAlert({
      getConfig: () => ({
        embedding: { alertUrl: url } as never,
        vectorStore: { collectionName: 'docs' } as never,
      }),
      version: '0.21.0',
      logger,
      host: 'box',
    });
    alert.onTransition(failed);
    await alert.settled();
    expect(bodies).toEqual([
      {
        event: 'embedding_failed',
        at: failed.at,
        failingSince: failed.failingSince,
        lastError: failed.lastError,
        service: 'watcher',
        version: '0.21.0',
        host: 'box',
        collection: 'docs',
      },
    ]);
  });

  it('reads the URL at each transition and sends nothing without one', async () => {
    const { url, bodies } = await receiver();
    const live: { alertUrl?: string } = {};
    const alert = createEmbeddingAlert({
      getConfig: () => ({
        embedding: { alertUrl: live.alertUrl } as never,
        vectorStore: { collectionName: 'docs' } as never,
      }),
      version: '1',
      logger,
    });
    alert.onTransition(failed);
    await alert.settled();
    expect(bodies).toEqual([]);

    live.alertUrl = url;
    alert.onTransition({ ...failed, event: 'embedding_recovered' });
    await alert.settled();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ event: 'embedding_recovered' });
    expect(typeof (bodies[0] as { host: unknown }).host).toBe('string');
  });
});
