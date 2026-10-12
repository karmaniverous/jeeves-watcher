/**
 * @module test/source-integration.test
 * Service integration (requires Qdrant): a source document is retrieved from a stub callback, rendered by its designated rule, embedded (mock provider) and stored under source identity.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sourcePointId } from '../pointId';
import { qdrantAvailable } from './harness/qdrant';
import { type ServiceHarness, startServiceHarness } from './harness/service';
import {
  startStubSourceServer,
  type StubSourceServer,
} from './harness/stubSource';

const REF = 'app://chat/thread/AbC';
const REF_LOWER = 'app://chat/thread/abc';
const RULE = 'chat-thread';

const thread = (userId: string, text: string) => ({
  userId,
  streaks: [{ msgs: [{ role: 'user', text }] }],
});

describe.skipIf(!qdrantAvailable())(
  'Service integration: source documents (requires Qdrant)',
  () => {
    let stub: StubSourceServer;
    let harness: ServiceHarness;

    beforeAll(async () => {
      stub = await startStubSourceServer({
        '/threads/chat/thread/AbC': { body: thread('u1', 'hello upper') },
        '/threads/chat/thread/abc': { body: thread('u2', 'hello lower') },
      });
      harness = await startServiceHarness({
        label: 'sources',
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
              match: {
                type: 'object',
                required: ['source', 'json'],
                properties: {
                  json: {
                    type: 'object',
                    required: ['userId', 'streaks'],
                    properties: { streaks: { type: 'array', minItems: 1 } },
                  },
                },
              },
              schema: [
                {
                  type: 'object',
                  properties: {
                    user_id: { type: 'string', set: '{{json.userId}}' },
                    type: { type: 'string', set: 'chat' },
                  },
                },
              ],
              template:
                '# Thread for {{userId}}\n\n{{#each streaks}}{{#each msgs}}- {{role}}: {{text}}\n{{/each}}{{/each}}',
            },
          ],
        },
      });
    });

    afterAll(async () => {
      await harness.close();
      await stub.close();
    });

    it('indexes a source document end to end', async () => {
      const result = await harness.processor.processSource(REF, RULE);
      expect(result).toEqual({
        source: REF,
        status: 'indexed',
        chunks: 1,
        matched_rules: [RULE],
      });

      const payload = await harness.vectorStore.getPayload(
        sourcePointId(REF, 0),
      );
      expect(payload).toMatchObject({
        source: REF,
        source_rule: RULE,
        user_id: 'u1',
        type: 'chat',
        chunk_index: 0,
        total_chunks: 1,
        matched_rules: [RULE],
        chunk_text: '# Thread for u1\n\n- user: hello upper',
      });
      expect(payload).not.toHaveProperty('file_path');
      expect(typeof payload?.['created_at']).toBe('number');
    });

    it('keeps case-distinct references as distinct documents', async () => {
      const result = await harness.processor.processSource(REF_LOWER, RULE);
      expect(result.status).toBe('indexed');

      const upper = await harness.vectorStore.getPayload(sourcePointId(REF, 0));
      const lower = await harness.vectorStore.getPayload(
        sourcePointId(REF_LOWER, 0),
      );
      expect(upper?.['user_id']).toBe('u1');
      expect(lower?.['user_id']).toBe('u2');
      expect(lower?.['source']).toBe(REF_LOWER);
    });

    it('skips unchanged content without re-embedding', async () => {
      const before = await harness.vectorStore.getPayload(
        sourcePointId(REF, 0),
      );
      const result = await harness.processor.processSource(REF, RULE);
      expect(result.status).toBe('unchanged');
      const after = await harness.vectorStore.getPayload(sourcePointId(REF, 0));
      expect(after?.['modified_at']).toBe(before?.['modified_at']);
    });

    it('records match_failed and writes nothing for a non-matching record', async () => {
      stub.route('/threads/chat/thread/bad', { body: { userId: 'u3' } });
      const ref = 'app://chat/thread/bad';
      const result = await harness.processor.processSource(ref, RULE);
      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('match_failed');
      expect(
        await harness.vectorStore.getPayload(sourcePointId(ref, 0)),
      ).toBeNull();
    });

    it('deletes the document points when the callback returns 404', async () => {
      stub.route('/threads/chat/thread/AbC', {
        status: 404,
        body: { error: 'gone' },
      });
      const result = await harness.processor.processSource(REF, RULE);
      expect(result).toEqual({ source: REF, status: 'deleted' });
      expect(
        await harness.vectorStore.getPayload(sourcePointId(REF, 0)),
      ).toBeNull();
      expect(
        await harness.vectorStore.getPayload(sourcePointId(REF_LOWER, 0)),
      ).not.toBeNull();
    });
  },
);
