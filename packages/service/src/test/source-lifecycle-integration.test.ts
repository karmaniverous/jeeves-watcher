/**
 * @module test/source-lifecycle-integration.test
 * Service integration (requires Qdrant): the notify lifecycle of one source document against the stub callback — index, unchanged with zero embedding calls, replace after a new message, metadata-only update without embedding, multi-chunk shrink with no orphan chunks.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sourcePointId } from '../pointId';
import { qdrantAvailable } from './harness/qdrant';
import {
  HARNESS_DIMENSIONS,
  type ServiceHarness,
  startServiceHarness,
} from './harness/service';
import {
  startStubSourceServer,
  type StubSourceServer,
} from './harness/stubSource';

const RULE = 'cg-chat-thread';
const REF = 'cg://chat/thread/life';
const PATH = '/threads/chat/thread/life';
const LONG = 'cg://chat/thread/long';
const LONG_PATH = '/threads/chat/thread/long';

/** A thread record; `topic` is metadata only (not rendered). */
const record = (msgs: string[], topic = 'credit') => ({
  body: { userId: 'u1', topic, msgs: msgs.map((text) => ({ text })) },
});

/** A message long enough that a few of them exceed the 200-char chunk size. */
const longMsg = (i: number) =>
  `Message ${String(i)}: ${'credit utilisation and payment history '.repeat(3)}`;

describe.skipIf(!qdrantAvailable())(
  'Service integration: source document lifecycle (requires Qdrant)',
  () => {
    let stub: StubSourceServer;
    let harness: ServiceHarness;

    beforeAll(async () => {
      stub = await startStubSourceServer({
        [PATH]: record(['hello']),
      });
      harness = await startServiceHarness({
        label: 'lifecycle',
        config: {
          embedding: {
            provider: 'mock',
            model: 'mock',
            dimensions: HARNESS_DIMENSIONS,
            chunkSize: 200,
            chunkOverlap: 0,
            concurrency: 1,
            rateLimitPerMinute: 100000,
          },
          sources: {
            cg: {
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
                    topic: { type: 'string', set: '{{json.topic}}' },
                  },
                },
              ],
              template: '{{#each msgs}}{{text}}\n\n{{/each}}',
            },
          ],
        },
      });
    });

    afterAll(async () => {
      await harness.close();
      await stub.close();
    });

    const post = async (url: string, payload: object) => {
      const res = await harness.app.inject({ method: 'POST', url, payload });
      return { status: res.statusCode, body: res.json<unknown>() };
    };
    const notifyWait = async (ref: string) =>
      (
        await post('/documents?wait=true', {
          documents: [{ source: ref, rule: RULE }],
        })
      ).body;
    const payloadOf = (ref: string, chunk = 0) =>
      harness.vectorStore.getPayload(sourcePointId(ref, chunk));
    const countOf = (ref: string) =>
      harness.vectorStore.count({
        must: [{ key: 'source', match: { value: ref } }],
      });
    const retrievals = (path: string) =>
      stub.requests.filter((r) => r.path === path).length;

    it('notify returns 202, retrieves through the callback and indexes', async () => {
      const before = harness.embeddings.calls;
      const res = await post('/documents', {
        documents: [{ source: REF, rule: RULE }],
      });
      expect(res).toEqual({
        status: 202,
        body: { accepted: [REF], rejected: [] },
      });
      await harness.sourceQueue.drain();

      expect(retrievals(PATH)).toBe(1);
      expect(harness.embeddings.calls).toBeGreaterThan(before);
      expect(await payloadOf(REF)).toMatchObject({
        source: REF,
        source_rule: RULE,
        user_id: 'u1',
        topic: 'credit',
        chunk_text: 'hello',
        total_chunks: 1,
      });
      expect(await payloadOf(REF)).not.toHaveProperty('file_path');
    });

    it('re-notifying an unchanged record is unchanged with zero embedding calls', async () => {
      const before = harness.embeddings.calls;
      const fetched = retrievals(PATH);
      expect(await notifyWait(REF)).toEqual({
        results: [{ source: REF, status: 'unchanged', matched_rules: [RULE] }],
      });
      expect(retrievals(PATH)).toBe(fetched + 1);
      expect(harness.embeddings.calls).toBe(before);
    });

    it('replaces the points after a new message (re-rendered thread)', async () => {
      const old = await payloadOf(REF);
      stub.route(PATH, record(['hello', 'second message']));
      await post('/documents', { documents: [{ source: REF, rule: RULE }] });
      await harness.sourceQueue.drain();

      const now = await payloadOf(REF);
      expect(now).toMatchObject({
        chunk_text: 'hello\n\nsecond message',
        total_chunks: 1,
        created_at: old?.['created_at'],
      });
      expect(now?.['content_hash']).not.toBe(old?.['content_hash']);
      expect(await countOf(REF)).toBe(1);
    });

    it('updates changed metadata without an embedding call', async () => {
      const old = await payloadOf(REF);
      stub.route(PATH, record(['hello', 'second message'], 'mortgage'));
      const before = harness.embeddings.calls;

      expect(await notifyWait(REF)).toMatchObject({
        results: [{ source: REF, status: 'indexed', chunks: 1 }],
      });
      expect(harness.embeddings.calls).toBe(before);
      expect(await payloadOf(REF)).toMatchObject({
        topic: 'mortgage',
        chunk_text: old?.['chunk_text'],
        content_hash: old?.['content_hash'],
        source: REF,
      });
    });

    it('writes every chunk of a long thread with the same source, and a shrink leaves no orphans', async () => {
      stub.route(LONG_PATH, record([1, 2, 3, 4, 5, 6].map(longMsg)));
      const first = (await notifyWait(LONG)) as {
        results: [{ status: string; chunks: number }];
      };
      expect(first.results[0].status).toBe('indexed');
      const chunks = first.results[0].chunks;
      expect(chunks).toBeGreaterThan(2);
      expect(await countOf(LONG)).toBe(chunks);
      for (let i = 0; i < chunks; i++) {
        expect(await payloadOf(LONG, i)).toMatchObject({
          source: LONG,
          chunk_index: i,
          total_chunks: chunks,
        });
      }

      stub.route(LONG_PATH, record([longMsg(1)]));
      expect(await notifyWait(LONG)).toMatchObject({
        results: [{ source: LONG, status: 'indexed', chunks: 1 }],
      });
      expect(await countOf(LONG)).toBe(1);
      expect(await payloadOf(LONG)).toMatchObject({ total_chunks: 1 });
      for (let i = 1; i < chunks; i++) {
        expect(await payloadOf(LONG, i)).toBeNull();
      }
      // The other document is untouched.
      expect(await countOf(REF)).toBe(1);
    });
  },
);
