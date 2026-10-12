/**
 * @module test/source-notify-integration.test
 * Service integration (requires Qdrant): a burst of notifications on one source reference collapses to at most two callback retrievals and leaves one point set holding the latest stub content.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLogger } from '../logger';
import { sourcePointId } from '../pointId';
import { SourceNotifyQueue } from '../queue/SourceNotifyQueue';
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

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

describe.skipIf(!qdrantAvailable())(
  'Service integration: source notify queue (requires Qdrant)',
  () => {
    let stub: StubSourceServer;
    let harness: ServiceHarness;
    let version = 0;

    beforeAll(async () => {
      stub = await startStubSourceServer({
        // Each retrieval returns the content current when it arrives; the
        // delay keeps the first run in flight while the burst lands.
        [PATH]: () => ({
          delayMs: 300,
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
      const queue = new SourceNotifyQueue(
        harness.processor,
        { concurrency: 2 },
        createLogger({ level: 'silent' }),
      );
      queue.start();

      for (let i = 1; i <= BURST; i++) {
        version = i;
        queue.enqueue(REF, RULE);
        await sleep(5);
      }
      await queue.drain();

      const retrievals = stub.requests.filter((r) => r.path === PATH);
      expect(retrievals.length).toBeGreaterThanOrEqual(1);
      expect(retrievals.length).toBeLessThanOrEqual(2);

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
