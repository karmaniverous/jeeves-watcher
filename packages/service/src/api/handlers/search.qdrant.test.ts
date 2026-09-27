/**
 * @module api/handlers/search.qdrant.test
 * Regression test for #239: drives POST /search through the real
 * VectorStoreClient and the real `@qdrant/js-client-rest` QdrantClient,
 * against a stub Qdrant HTTP server (no client mocks). Catches client API
 * removals such as `QdrantClient.search` in 1.19.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createEmbeddingProvider } from '../../embedding';
import { VectorStoreClient } from '../../vectorStore';
import { createSearchHandler, type HybridSearchConfig } from './search';

interface RecordedRequest {
  method: string;
  url: string;
  body: Record<string, unknown>;
}

const points = [
  { id: 'p1', version: 1, score: 0.9, payload: { file_path: 'a.md' } },
  { id: 2, version: 1, score: 0.5, payload: { file_path: 'b.md' } },
];

async function readBody(req: IncomingMessage): Promise<string> {
  let data = '';
  for await (const chunk of req) data += String(chunk);
  return data;
}

describe('POST /search via real QdrantClient', () => {
  const requests: RecordedRequest[] = [];
  let qdrant: Server;
  let app: FastifyInstance;
  let hybrid: HybridSearchConfig | undefined;

  beforeAll(async () => {
    qdrant = createServer((req, res) => {
      void readBody(req).then((raw) => {
        requests.push({
          method: req.method ?? '',
          url: req.url ?? '',
          body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
        });
        res.setHeader('content-type', 'application/json');
        if (
          req.method === 'POST' &&
          req.url === '/collections/test/points/query'
        ) {
          res.end(
            JSON.stringify({ result: { points }, status: 'ok', time: 0 }),
          );
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ status: { error: 'not found' }, time: 0 }));
      });
    });
    await new Promise<void>((resolve) => {
      qdrant.listen(0, '127.0.0.1', resolve);
    });
    const { port } = qdrant.address() as AddressInfo;

    const embeddingProvider = createEmbeddingProvider({
      provider: 'mock',
      model: 'mock',
      dimensions: 3,
    });
    const vectorStore = new VectorStoreClient(
      { url: `http://127.0.0.1:${String(port)}`, collectionName: 'test' },
      3,
    );

    app = Fastify();
    app.post(
      '/search',
      createSearchHandler({
        embeddingProvider,
        vectorStore,
        logger: pino({ level: 'silent' }),
        getHybridConfig: () => hybrid,
      }),
    );
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => {
      qdrant.close(() => {
        resolve();
      });
    });
  });

  beforeEach(() => {
    requests.length = 0;
    hybrid = undefined;
  });

  it('uses the Query API and maps results', async () => {
    const filter = { must: [{ key: 'domain', match: { value: 'x' } }] };
    const res = await app.inject({
      method: 'POST',
      url: '/search',
      payload: { query: 'hello', limit: 5, offset: 2, filter },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: 'p1', score: 0.9, payload: { file_path: 'a.md' } },
      { id: '2', score: 0.5, payload: { file_path: 'b.md' } },
    ]);

    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.url).toBe('/collections/test/points/query');
    expect(req.body).toMatchObject({
      limit: 5,
      offset: 2,
      with_payload: true,
      filter,
    });
    expect(req.body['query']).toHaveLength(3);
  });

  it('uses the Query API with RRF prefetches for hybrid search', async () => {
    hybrid = { enabled: true, textWeight: 0.25 };
    const res = await app.inject({
      method: 'POST',
      url: '/search',
      payload: { query: 'hello' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
    expect(requests[0].url).toBe('/collections/test/points/query');
    expect(requests[0].body['prefetch']).toHaveLength(2);
    expect(requests[0].body['query']).toEqual({
      rrf: { weights: [0.75, 0.25] },
    });
  });
});
