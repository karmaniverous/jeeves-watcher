/**
 * @module test/source-failures-integration.test
 * Service integration (requires Qdrant): callback failures never touch indexed points — 5xx, timeout, connection refused and non-JSON content type return `failed` with ?wait=true and record typed issues on the async path; recovery clears the issue.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sourcePointId } from '../pointId';
import { qdrantAvailable } from './harness/qdrant';
import { type ServiceHarness, startServiceHarness } from './harness/service';
import {
  startStubSourceServer,
  type StubResponse,
  type StubSourceServer,
} from './harness/stubSource';

const RULE = 'chat-thread';
const REF = 'app://chat/thread/f';
const PATH = '/threads/chat/thread/f';
const DOWN = 'down://chat/thread/f';
const DOWN_ASYNC = 'down://chat/thread/g';

const ok: StubResponse = { body: { userId: 'u1', text: 'stable content' } };

describe.skipIf(!qdrantAvailable())(
  'Service integration: source callback failures (requires Qdrant)',
  () => {
    let stub: StubSourceServer;
    let harness: ServiceHarness;
    let indexed: Record<string, unknown> | null;

    beforeAll(async () => {
      stub = await startStubSourceServer({ [PATH]: ok });
      // A source whose server is gone: every callback is refused.
      const gone = await startStubSourceServer();
      const goneUrl = gone.url;
      await gone.close();
      harness = await startServiceHarness({
        label: 'failures',
        config: {
          api: { cacheTtlMs: 0 },
          sources: {
            app: {
              url: `${stub.url}/threads/{id}`,
              timeoutMs: 500,
              concurrency: 2,
            },
            down: {
              url: `${goneUrl}/threads/{id}`,
              timeoutMs: 500,
              concurrency: 1,
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
                  },
                },
              ],
              template: '{{userId}}: {{text}}',
            },
          ],
        },
      });
      await notify(REF, true);
      indexed = await payloadOf(REF);
      if (!indexed) throw new Error('Seeding failed');
    });

    afterAll(async () => {
      await harness.close();
      await stub.close();
    });

    async function notify(ref: string, wait: boolean) {
      const res = await harness.app.inject({
        method: 'POST',
        url: wait ? '/documents?wait=true' : '/documents',
        payload: { documents: [{ source: ref, rule: RULE }] },
      });
      if (!wait) await harness.sourceQueue.drain();
      return res.json<unknown>();
    }
    function payloadOf(ref: string) {
      return harness.vectorStore.getPayload(sourcePointId(ref, 0));
    }
    const issues = async () => {
      const res = await harness.app.inject({ url: '/issues' });
      return res.json<{ issues: Record<string, { type: string }[]> }>().issues;
    };

    const cases: Array<[string, StubResponse, string]> = [
      [
        'a callback 500',
        { status: 500, body: { error: 'down' } },
        'source_unavailable',
      ],
      [
        'a callback 503',
        { status: 503, body: 'busy', contentType: 'text/plain' },
        'source_unavailable',
      ],
      ['a callback timeout', { ...ok, delayMs: 2000 }, 'source_unavailable'],
      [
        'a text/html body',
        { body: '<p>hi</p>', contentType: 'text/html' },
        'unsupported_content_type',
      ],
      [
        'a text/markdown body',
        { body: '# hi', contentType: 'text/markdown' },
        'unsupported_content_type',
      ],
    ];

    it.each(cases)(
      '%s with ?wait=true → failed, points untouched',
      async (_label, response, code) => {
        stub.route(PATH, response);
        expect(await notify(REF, true)).toMatchObject({
          results: [{ source: REF, status: 'failed', error: { code } }],
        });
        expect(await payloadOf(REF)).toEqual(indexed);
      },
    );

    it.each(cases)(
      '%s on the async path → typed issue in /issues, points untouched',
      async (_label, response, code) => {
        // Start from no issue, so the assertion sees this run's issue only.
        harness.issuesManager.clear(REF);
        expect((await issues())[REF]).toBeUndefined();
        stub.route(PATH, response);
        expect(await notify(REF, false)).toMatchObject({ accepted: [REF] });
        expect((await issues())[REF]).toEqual([
          expect.objectContaining({ type: code, rule: RULE }),
        ]);
        expect(await payloadOf(REF)).toEqual(indexed);
      },
    );

    it('a refused connection records source_unavailable and writes nothing', async () => {
      expect(await notify(DOWN, true)).toMatchObject({
        results: [
          {
            source: DOWN,
            status: 'failed',
            error: { code: 'source_unavailable' },
          },
        ],
      });
      expect(await payloadOf(DOWN)).toBeNull();

      // The async path on a reference the ?wait=true run never touched.
      expect((await issues())[DOWN_ASYNC]).toBeUndefined();
      await notify(DOWN_ASYNC, false);
      expect((await issues())[DOWN_ASYNC]).toEqual([
        expect.objectContaining({ type: 'source_unavailable', rule: RULE }),
      ]);
      expect(await payloadOf(DOWN_ASYNC)).toBeNull();
    });

    it('recovery clears the issue and leaves the content unchanged', async () => {
      // Its own issue: not one an earlier test happened to leave.
      harness.issuesManager.clear(REF);
      harness.issuesManager.record(REF, 'source_unavailable', 'seeded', {
        rule: RULE,
      });
      expect((await issues())[REF]).toHaveLength(1);
      stub.route(PATH, ok);
      expect(await notify(REF, true)).toMatchObject({
        results: [{ source: REF, status: 'unchanged' }],
      });
      expect((await issues())[REF]).toBeUndefined();
      expect(await payloadOf(REF)).toEqual(indexed);
    });
  },
);
