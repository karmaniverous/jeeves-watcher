/**
 * @module test/source-notify-integration.test
 * Service integration (requires Qdrant): a burst of notifications on one source reference, landing while the first retrieval is held in flight, collapses to exactly two callback retrievals and leaves one point set holding the latest stub content.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createNotifyQueue } from '../app/sources';
import { createLogger } from '../logger';
import { sourcePointId } from '../pointId';
import { qdrantAvailable } from './harness/qdrant';
import { type ServiceHarness, startServiceHarness } from './harness/service';
import {
  startStubSourceServer,
  type StubSourceServer,
} from './harness/stubSource';

const REF = 'app://chat/thread/burst';
const PATH = '/threads/chat/thread/burst';
const RULE = 'chat-thread';
const BURST = 20;

describe.skipIf(!qdrantAvailable())(
  'Service integration: source notify queue (requires Qdrant)',
  () => {
    let stub: StubSourceServer;
    let harness: ServiceHarness;
    let version = 0;
    /** While set, a retrieval's response is held until it settles. */
    let hold: Promise<void> | undefined;

    beforeAll(async () => {
      stub = await startStubSourceServer({
        // Each retrieval returns the content current when it arrives.
        [PATH]: () => ({
          until: hold,
          body: {
            userId: 'u1',
            streaks: [
              { msgs: [{ role: 'user', text: `message ${String(version)}` }] },
            ],
          },
        }),
      });
      harness = await startServiceHarness({
        label: 'notify',
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
              },
              schema: [
                {
                  type: 'object',
                  properties: {
                    user_id: { type: 'string', set: '{{json.userId}}' },
                  },
                },
              ],
              template:
                '{{#each streaks}}{{#each msgs}}- {{role}}: {{text}}\n{{/each}}{{/each}}',
            },
          ],
        },
      });
    });

    afterAll(async () => {
      await harness.close();
      await stub.close();
    });

    it('collapses a burst on one reference to the latest content', async () => {
      const queue = createNotifyQueue(
        harness.processor,
        2,
        createLogger({ level: 'silent' }),
      );
      queue.start();
      const retrievals = () => stub.requests.filter((r) => r.path === PATH);

      // The first run's retrieval (content 1) is held in flight...
      let release = (): void => undefined;
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      version = 1;
      queue.enqueue(REF, RULE);
      await vi.waitFor(() => {
        expect(retrievals()).toHaveLength(1);
      });

      // ...while the rest of the burst lands; it owes one more run.
      hold = undefined;
      for (let i = 2; i <= BURST; i++) {
        version = i;
        queue.enqueue(REF, RULE);
      }
      release();
      await queue.drain();

      expect(retrievals()).toHaveLength(2);

      const payload = await harness.vectorStore.getPayload(
        sourcePointId(REF, 0),
      );
      expect(payload).toMatchObject({
        source: REF,
        source_rule: RULE,
        user_id: 'u1',
        total_chunks: 1,
        chunk_text: `- user: message ${String(BURST)}`,
      });
      expect(
        await harness.vectorStore.getPayload(sourcePointId(REF, 1)),
      ).toBeNull();

      // The latest state is already indexed: a waited notify is unchanged.
      await expect(queue.processNow(REF, RULE)).resolves.toMatchObject({
        source: REF,
        status: 'unchanged',
      });
      await queue.stop();
    });
  },
);
