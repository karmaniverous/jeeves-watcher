/**
 * @module test/count-facets-integration.test
 * `POST /search/facets/counts` through the catalog route against real Qdrant (spec A8 Verification): a 50-chunk document counts once, rules ['a', 'b'] count a file document matching both once and a source document whose source_rule is b while excluding other rules' documents, a caller's top-level should keeps its meaning, ranges, and 400s for unindexed fields and unknown rules.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCatalogCountFacetsHandler } from '../api/catalog/countFacetsHandler';
import type { InferenceRule } from '../config/types';
import { VectorStoreClient } from '../vectorStore';
import { registerCatalogEntries } from './catalogRoutes';
import { makeConfig } from './facetsDeps';
import {
  assertTestVectorStore,
  dropCollection,
  ensureSettledCollection,
  qdrantAvailable,
  qdrantUrl,
  uniqueCollectionName,
} from './harness/qdrant';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const rule = (name: string) =>
  ({ name, description: name, match: {} }) as InferenceRule;

describe.skipIf(!qdrantAvailable())(
  'POST /search/facets/counts (requires Qdrant)',
  () => {
    const collectionName = uniqueCollectionName('count_facets');
    let app: FastifyInstance | undefined;

    beforeAll(async () => {
      const config = {
        url: qdrantUrl(),
        collectionName,
        payloadIndexes: [
          { field: 'tag', type: 'keyword' as const },
          { field: 'size', type: 'integer' as const },
          { field: 'score', type: 'float' as const },
        ],
      };
      assertTestVectorStore(config);
      const store = new VectorStoreClient(config, 4);
      await ensureSettledCollection(store);
      const file = (
        path: string,
        rules: string[],
        tag: string,
        size: number,
        score: number,
      ) => ({ file_path: path, matched_rules: rules, tag, size, score });
      await store.upsert([
        // a.md: 50 chunks, matched rules a and b.
        ...Array.from({ length: 50 }, (_, i) => ({
          id: id(i + 1),
          vector: [1, 0, 0, 0],
          payload: { ...file('a.md', ['a', 'b'], 'x', 5, 0.5), chunk_index: i },
        })),
        {
          id: id(100),
          vector: [0, 1, 0, 0],
          payload: { ...file('c.md', ['c'], 'x', 20, 3.5), chunk_index: 0 },
        },
        {
          id: id(101),
          vector: [0, 0, 1, 0],
          payload: { ...file('d.md', ['a'], 'z', 7, 1.25), chunk_index: 0 },
        },
        // A source document designated by rule b (no matched_rules).
        {
          id: id(102),
          vector: [0, 0, 0, 1],
          payload: { source_rule: 'b', tag: 'y', size: 1, chunk_index: 0 },
        },
      ]);

      app = Fastify();
      await registerCatalogEntries(app, {
        countFacets: createCatalogCountFacetsHandler({
          getConfig: () =>
            makeConfig([
              rule('a'),
              rule('b'),
              {
                ...rule('c'),
                schema: [
                  {
                    properties: { size: { type: 'integer', uiHint: 'number' } },
                  },
                ],
              },
            ]),
          configDir: '/tmp',
          facetStore: store.facets,
          logger: pino({ level: 'silent' }),
        }),
      });
    });

    afterAll(async () => {
      await app?.close();
      await dropCollection(collectionName);
    });

    async function post(body: Record<string, unknown>) {
      if (!app) throw new Error('app not started');
      const res = await app.inject({
        method: 'POST',
        url: '/search/facets/counts',
        payload: body,
      });
      return {
        status: res.statusCode,
        body: res.json<Record<string, unknown>>(),
      };
    }

    it('counts each document once, however many chunks it has', async () => {
      const { status, body } = await post({ fields: ['tag'] });
      expect(status).toBe(200);
      expect(body).toEqual({
        counts: {
          tag: [
            { value: 'x', count: 2 },
            { value: 'y', count: 1 },
            { value: 'z', count: 1 },
          ],
        },
      });
    });

    it("rules ['a', 'b'] count a file document of both once and b's source document, and exclude other rules", async () => {
      const { body } = await post({ rules: ['a', 'b'], fields: ['tag'] });
      expect(body).toEqual({
        counts: {
          tag: [
            { value: 'x', count: 1 },
            { value: 'y', count: 1 },
            { value: 'z', count: 1 },
          ],
        },
      });
    });

    it("keeps the meaning of a caller's top-level should", async () => {
      const { body } = await post({
        rules: ['a', 'b'],
        filter: {
          should: [
            { key: 'tag', match: { value: 'y' } },
            { key: 'tag', match: { value: 'z' } },
          ],
        },
        fields: ['tag'],
      });
      expect(body).toEqual({
        counts: {
          tag: [
            { value: 'y', count: 1 },
            { value: 'z', count: 1 },
          ],
        },
      });
    });

    it('reads a range from a float index, and from an integer field rule c hints as a number', async () => {
      const { status, body } = await post({ fields: ['score', 'size'] });
      expect(status).toBe(200);
      expect(body).toEqual({
        counts: {
          score: { min: 0.5, max: 3.5 },
          size: { min: 1, max: 20 },
        },
      });
    });

    it('decides the mode from the rules in scope: a and b give size no hint, so its integer index counts it', async () => {
      const { body } = await post({
        rules: ['a', 'b'],
        fields: ['score', 'size'],
      });
      expect(body).toEqual({
        counts: {
          score: { min: 0.5, max: 1.25 },
          size: [
            { value: 1, count: 1 },
            { value: 5, count: 1 },
            { value: 7, count: 1 },
          ],
        },
      });
    });

    it('answers 400 naming an unindexed field', async () => {
      const { status, body } = await post({ fields: ['tag', 'file_path_x'] });
      expect(status).toBe(400);
      expect(body).toMatchObject({
        code: 'WATCHER_INVALID_REQUEST',
        message: 'No usable payload index for field(s): file_path_x',
      });
    });

    it('answers 400 for an unknown rule', async () => {
      const { status, body } = await post({
        rules: ['ghost'],
        fields: ['tag'],
      });
      expect(status).toBe(400);
      expect(body).toMatchObject({
        code: 'WATCHER_INVALID_REQUEST',
        message: 'Unknown rule(s): ghost',
      });
    });
  },
);
