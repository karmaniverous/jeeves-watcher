/**
 * @module test/auth-indexes-integration.test
 * Service integration (requires Qdrant): API bearer auth over HTTP and startup payload indexes (tenant user_id, source/source_rule keyword) on a real collection.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getPayloadSchema, qdrantAvailable } from './harness/qdrant';
import { type ServiceHarness, startServiceHarness } from './harness/service';

const API_KEY = 'integration-test-key';

describe.skipIf(!qdrantAvailable())(
  'Service integration: auth and payload indexes (requires Qdrant)',
  () => {
    let harness: ServiceHarness;

    beforeAll(async () => {
      harness = await startServiceHarness({
        label: 'auth_indexes',
        apiKey: API_KEY,
        payloadIndexes: [
          { field: 'user_id', type: 'keyword', isTenant: true },
          { field: 'updated_at', type: 'datetime', isPrincipal: true },
        ],
        listen: true,
      });
    });

    afterAll(async () => {
      await harness.close();
    });

    const call = (path: string, init?: RequestInit) =>
      fetch(`${harness.baseUrl!}${path}`, init);

    it('leaves GET /status open', async () => {
      const res = await call('/status');
      expect(res.status).toBe(200);
    });

    it('returns 401 without a token', async () => {
      const res = await call('/issues');
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
    });

    it('returns 401 with a wrong token', async () => {
      const res = await call('/issues', {
        headers: { authorization: 'Bearer not-the-key' },
      });
      expect(res.status).toBe(401);
    });

    it('returns 200 with the configured token', async () => {
      const res = await call('/issues', {
        headers: { authorization: `Bearer ${API_KEY}` },
      });
      expect(res.status).toBe(200);
    });

    it('authorises POST routes that reach Qdrant', async () => {
      const res = await call('/scan', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          filter: { must: [{ key: 'user_id', match: { value: 'u1' } }] },
          limit: 1,
        }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ points: [] });
    });

    it('creates the configured tenant and principal indexes', async () => {
      const schema = await getPayloadSchema(harness.collectionName);
      expect(schema['user_id']).toMatchObject({
        data_type: 'keyword',
        params: { type: 'keyword', is_tenant: true },
      });
      expect(schema['updated_at']).toMatchObject({
        data_type: 'datetime',
        params: { type: 'datetime', is_principal: true },
      });
    });

    it('always creates source and source_rule keyword indexes', async () => {
      const schema = await getPayloadSchema(harness.collectionName);
      expect(schema).toMatchObject({
        source: { data_type: 'keyword' },
        source_rule: { data_type: 'keyword' },
      });
    });

    it('does not create the chunk_text index without hybrid search', async () => {
      const schema = await getPayloadSchema(harness.collectionName);
      expect(schema['chunk_text']).toBeUndefined();
    });

    it('is idempotent on restart and never drops indexes', async () => {
      await harness.vectorStore.ensureCollection();
      const schema = await getPayloadSchema(harness.collectionName);
      expect(Object.keys(schema).sort()).toEqual([
        'source',
        'source_rule',
        'updated_at',
        'user_id',
      ]);
    });
  },
);

describe.skipIf(!qdrantAvailable())(
  'Service integration: no api.apiKey (requires Qdrant)',
  () => {
    let harness: ServiceHarness;

    beforeAll(async () => {
      harness = await startServiceHarness({ label: 'no_auth' });
    });

    afterAll(async () => {
      await harness.close();
    });

    it('keeps every route open when no key is configured', async () => {
      const res = await harness.app.inject({ method: 'GET', url: '/issues' });
      expect(res.statusCode).toBe(200);
    });
  },
);
