/**
 * @module test/documents-integration.test
 * Service integration (requires Qdrant): POST /documents notify (202 and ?wait=true) then /search finds it; /render, /metadata and /reindex with source; /documents/delete rejects condition-free filters and never removes file points (even a legacy one carrying a rule-written source); wait=true on a callback 404 gives deleted.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pointId, sourcePointId } from '../pointId';
import { qdrantAvailable } from './harness/qdrant';
import { type ServiceHarness, startServiceHarness } from './harness/service';
import {
  startStubSourceServer,
  type StubSourceServer,
} from './harness/stubSource';

const RULE = 'chat-thread';
const A = 'app://chat/thread/a';
const B = 'app://chat/thread/b';
const GONE = 'app://chat/thread/gone';
const LONG = 'app://chat/thread/long';
const FILE = 'j:/docs/readme.md';
const LEGACY = 'j:/docs/legacy.md';

const thread = (userId: string, text: string) => ({
  body: { userId, streaks: [{ msgs: [{ role: 'user', text }] }] },
});

/** Asymmetric matcher typed as unknown (no unsafe any in literals). */
const anyString: unknown = expect.any(String);

describe.skipIf(!qdrantAvailable())(
  'Service integration: source document endpoints (requires Qdrant)',
  () => {
    let stub: StubSourceServer;
    let harness: ServiceHarness;
    let goneExists = true;

    beforeAll(async () => {
      stub = await startStubSourceServer({
        '/threads/chat/thread/a': thread('u1', 'alpha message'),
        '/threads/chat/thread/b': thread('u2', 'bravo message'),
        // Several chunks at the harness chunk size (1000).
        '/threads/chat/thread/long': thread(
          'u3',
          Array.from({ length: 400 }, (_, i) => `word${String(i)}`).join(' '),
        ),
        '/threads/chat/thread/gone': () =>
          goneExists
            ? thread('u1', 'soon gone')
            : { status: 404, body: { error: 'gone' } },
      });
      harness = await startServiceHarness({
        label: 'documents',
        config: {
          sources: {
            app: {
              url: `${stub.url}/threads/{id}`,
              timeoutMs: 5000,
              concurrency: 2,
            },
          },
          inferenceRules: [
            {
              name: RULE,
              description: 'Chat thread',
              match: { type: 'object', required: ['source', 'json'] },
              schema: [
                {
                  type: 'object',
                  properties: {
                    user_id: { type: 'string', set: '{{json.userId}}' },
                    priority: { type: 'integer' },
                  },
                },
              ],
              template:
                '{{#each streaks}}{{#each msgs}}- {{role}}: {{text}}\n{{/each}}{{/each}}',
            },
          ],
        },
      });
      // File points that no /documents/delete request may ever remove; the
      // legacy one carries a rule-written `source` equal to a real reference.
      await harness.vectorStore.upsert([
        {
          id: pointId(FILE, 0),
          vector: Array.from({ length: 16 }, () => 0.25),
          payload: { file_path: FILE, chunk_text: 'file', user_id: 'u1' },
        },
        {
          id: pointId(LEGACY, 0),
          vector: Array.from({ length: 16 }, () => 0.5),
          payload: {
            file_path: LEGACY,
            chunk_text: 'legacy',
            user_id: 'u1',
            source: B,
            source_rule: RULE,
          },
        },
      ]);
    });

    afterAll(async () => {
      await harness.close();
      await stub.close();
    });

    const post = async (url: string, payload: object) => {
      const res = await harness.app.inject({ method: 'POST', url, payload });
      return { status: res.statusCode, body: res.json<unknown>() };
    };
    const bySource = (ref: string) => ({
      must: [{ key: 'source', match: { value: ref } }],
    });

    it('notify (202) → queued → /search finds it', async () => {
      const { status, body } = await post('/documents', {
        documents: [
          { source: A, rule: RULE },
          { source: 'zz://chat/1', rule: RULE },
          { source: B, rule: 'no-such-rule' },
        ],
      });
      expect(status).toBe(202);
      expect(body).toMatchObject({
        accepted: [A],
        rejected: [
          { source: 'zz://chat/1', error: { code: 'unknown_source' } },
          { source: B, error: { code: 'rule_missing' } },
        ],
      });
      await harness.sourceQueue.drain();

      const search = await post('/search', {
        query: '- user: alpha message',
        filter: bySource(A),
      });
      expect(search.status).toBe(200);
      expect(search.body).toMatchObject([
        {
          id: sourcePointId(A, 0),
          payload: { source: A, source_rule: RULE, user_id: 'u1' },
        },
      ]);
    });

    it('?wait=true returns per-document results', async () => {
      const { status, body } = await post('/documents?wait=true', {
        documents: [
          { source: B, rule: RULE },
          { source: A, rule: RULE },
          { source: 'app:bad', rule: RULE },
        ],
      });
      expect(status).toBe(200);
      expect(body).toEqual({
        results: [
          { source: B, status: 'indexed', chunks: 1, matched_rules: [RULE] },
          { source: A, status: 'unchanged', matched_rules: [RULE] },
          {
            source: 'app:bad',
            status: 'failed',
            error: { code: 'invalid_reference', message: anyString },
          },
        ],
      });
    });

    it('renders, enriches and reindexes by source', async () => {
      const render = await post('/render', { source: A });
      expect(render).toMatchObject({
        status: 200,
        body: { renderAs: 'md', content: '- user: alpha message\n' },
      });

      const meta = await post('/metadata', {
        source: A,
        metadata: { priority: 3 },
      });
      expect(meta).toEqual({
        status: 200,
        body: { ok: true, matched_rules: [RULE] },
      });
      expect(
        await harness.vectorStore.getPayload(sourcePointId(A, 0)),
      ).toMatchObject({ priority: 3, source: A, source_rule: RULE });

      const before = stub.requests.length;
      const reindex = await post('/reindex', { scope: 'path', source: [A] });
      expect(reindex.body).toMatchObject({
        status: 'started',
        plan: { total: 1, toProcess: 1, byRoot: { app: 1 } },
      });
      await harness.sourceQueue.drain();
      expect(stub.requests.length).toBe(before + 1);
    });

    it('delete by filter removes source documents only, never file points', async () => {
      // The file point carries user_id u1 too: only the source point goes.
      const byUser = await post('/documents/delete', {
        filter: { must: [{ key: 'user_id', match: { value: 'u1' } }] },
      });
      expect(byUser).toEqual({ status: 200, body: { deleted: 1 } });
      expect(
        await harness.vectorStore.getPayload(sourcePointId(A, 0)),
      ).toBeNull();
      expect(
        await harness.vectorStore.getPayload(sourcePointId(B, 0)),
      ).not.toBeNull();

      const byRule = await post('/documents/delete', {
        filter: { must: [{ key: 'source_rule', match: { value: RULE } }] },
      });
      expect(byRule).toEqual({ status: 200, body: { deleted: 1 } });
      expect(
        await harness.vectorStore.getPayload(sourcePointId(B, 0)),
      ).toBeNull();
      expect(
        await harness.vectorStore.getPayload(pointId(FILE, 0)),
      ).toMatchObject({ file_path: FILE });
      expect(
        await harness.vectorStore.getPayload(pointId(LEGACY, 0)),
      ).toMatchObject({ file_path: LEGACY, source: B });
      expect(harness.enrichmentStore.get(A)).toBeNull();
    });

    it.each([
      ['{}', {}],
      ['{ must: [] }', { must: [] }],
      ['all clauses empty', { must: [], should: [], must_not: [] }],
    ])('delete with a condition-free filter %s → 400', async (_l, filter) => {
      // Its own source document: no reliance on earlier tests' leftovers.
      await post('/documents?wait=true', {
        documents: [{ source: A, rule: RULE }],
      });
      const before = await harness.vectorStore.count();
      const res = await post('/documents/delete', { filter });
      expect(res).toMatchObject({
        status: 400,
        body: { code: 'invalid_request' },
      });
      expect(await harness.vectorStore.count()).toBe(before);
      expect(await harness.vectorStore.count(bySource(A))).not.toBe(0);
      await post('/documents/delete', { sources: [A] }); // Leave A unindexed.
    });

    it('delete by sources removes every chunk of the listed documents', async () => {
      const indexed = await post('/documents?wait=true', {
        documents: [
          { source: A, rule: RULE },
          { source: LONG, rule: RULE },
        ],
      });
      expect(indexed.body).toMatchObject({
        results: [{ status: 'indexed' }, { status: 'indexed' }],
      });
      const chunks = await harness.vectorStore.count(bySource(LONG));
      expect(chunks).toBeGreaterThan(1);

      const { body } = await post('/documents/delete', {
        sources: [A, B, LONG],
      });
      expect(body).toEqual({ deleted: 2 });
      expect(await harness.vectorStore.count(bySource(A))).toBe(0);
      expect(await harness.vectorStore.count(bySource(LONG))).toBe(0);
      for (let chunk = 0; chunk < chunks; chunk++) {
        expect(
          await harness.vectorStore.getPayload(sourcePointId(LONG, chunk)),
        ).toBeNull();
      }
      // File points, even the legacy one carrying source B, survive.
      expect(
        await harness.vectorStore.getPayload(pointId(FILE, 0)),
      ).toMatchObject({ file_path: FILE });
      expect(
        await harness.vectorStore.getPayload(pointId(LEGACY, 0)),
      ).toMatchObject({ file_path: LEGACY, source: B });
    });

    it('?wait=true on a callback 404 → deleted', async () => {
      const first = await post('/documents?wait=true', {
        documents: [{ source: GONE, rule: RULE }],
      });
      expect(first.body).toMatchObject({ results: [{ status: 'indexed' }] });

      goneExists = false;
      const second = await post('/documents?wait=true', {
        documents: [{ source: GONE, rule: RULE }],
      });
      expect(second.body).toEqual({
        results: [{ source: GONE, status: 'deleted' }],
      });
      expect(await harness.vectorStore.count(bySource(GONE))).toBe(0);
      expect(
        await harness.vectorStore.getPayload(pointId(FILE, 0)),
      ).not.toBeNull();
    });
  },
);
