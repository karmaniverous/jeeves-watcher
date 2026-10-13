/**
 * @module test/source-recovery-integration.test
 * Service integration (requires Qdrant): a document whose first notification failed (no points) is recovered by POST /reindex scope `issues` using the rule recorded on its issue; the issue clears and the document is indexed.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sourcePointId } from '../pointId';
import { qdrantAvailable } from './harness/qdrant';
import { type ServiceHarness, startServiceHarness } from './harness/service';
import {
  startStubSourceServer,
  type StubSourceServer,
} from './harness/stubSource';

const RULE = 'chat-thread';
const REF = 'app://chat/thread/r';
const PATH = '/threads/chat/thread/r';

/**
 * Poll until a condition holds.
 *
 * @param condition - Async condition.
 * @param timeoutMs - Give up after this long.
 */
async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeoutMs = 15000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe.skipIf(!qdrantAvailable())(
  'Service integration: issues reindex recovers never-indexed sources (requires Qdrant)',
  () => {
    let stub: StubSourceServer;
    let harness: ServiceHarness;

    beforeAll(async () => {
      stub = await startStubSourceServer({
        [PATH]: { status: 500, body: { error: 'down' } },
      });
      harness = await startServiceHarness({
        label: 'recovery',
        config: {
          api: { cacheTtlMs: 0 },
          sources: {
            app: {
              url: `${stub.url}/threads/{id}`,
              timeoutMs: 1000,
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
    });

    afterAll(async () => {
      await harness.close();
      await stub.close();
    });

    const issues = async () => {
      const res = await harness.app.inject({ url: '/issues' });
      return res.json<{
        issues: Record<string, Array<{ type: string; rule?: string }>>;
      }>().issues;
    };

    it('retries a failed first notification with the recorded rule', async () => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/documents?wait=true',
        payload: { documents: [{ source: REF, rule: RULE }] },
      });
      expect(res.json<{ results: Array<{ status: string }> }>()).toMatchObject({
        results: [{ status: 'failed' }],
      });
      expect(
        await harness.vectorStore.getPayload(sourcePointId(REF, 0)),
      ).toBeNull();
      expect((await issues())[REF]).toEqual([
        expect.objectContaining({ type: 'source_unavailable', rule: RULE }),
      ]);

      stub.route(PATH, { body: { userId: 'u7', text: 'back online' } });
      const reindex = await harness.app.inject({
        method: 'POST',
        url: '/reindex',
        payload: { scope: 'issues' },
      });
      expect(reindex.statusCode).toBe(200);
      await waitFor(async () => {
        const status = await harness.app.inject({ url: '/status' });
        const { health } = status.json<{
          health: { reindex: { active: boolean } };
        }>();
        return !health.reindex.active;
      });

      expect(
        await harness.vectorStore.getPayload(sourcePointId(REF, 0)),
      ).toMatchObject({ source: REF, source_rule: RULE, user_id: 'u7' });
      expect((await issues())[REF]).toBeUndefined();
    });
  },
);
