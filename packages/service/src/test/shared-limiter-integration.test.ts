/**
 * @module test/shared-limiter-integration.test
 * Service integration (requires Qdrant): the real shared RateLimitedEmbeddingProvider over a fault-injecting provider; one forced 429 with Retry-After pauses notify, search and reindex alike; a source embedding failure appears in GET /issues as embedding_error.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RateLimitedEmbeddingProvider } from '../embedding/rateLimitedProvider';
import { sourcePointId } from '../pointId';
import { type FaultyProvider, faultyProvider } from './harness/faultyProvider';
import { qdrantAvailable } from './harness/qdrant';
import { type ServiceHarness, startServiceHarness } from './harness/service';
import {
  startStubSourceServer,
  type StubSourceServer,
} from './harness/stubSource';

const RULE = 'chat-thread';
const A = 'app://chat/thread/a';
const B = 'app://chat/thread/b';
const C = 'app://chat/thread/c';
const PATH_A = '/threads/chat/thread/a';
const PATH_B = '/threads/chat/thread/b';
const PATH_C = '/threads/chat/thread/c';

/** Retry-After the forced 429 asks for. */
const PAUSE_MS = 1500;

/** Timer slack when comparing wall-clock times. */
const SLACK_MS = 25;

const thread = (userId: string, text: string) => ({ body: { userId, text } });

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
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe.skipIf(!qdrantAvailable())(
  'Service integration: one shared embedding limiter (requires Qdrant)',
  () => {
    let stub: StubSourceServer;
    let harness: ServiceHarness;
    let faulty: FaultyProvider;

    beforeAll(async () => {
      stub = await startStubSourceServer({
        [PATH_A]: thread('u1', 'alpha'),
        [PATH_B]: thread('u2', 'bravo'),
        [PATH_C]: thread('u3', 'charlie'),
      });
      harness = await startServiceHarness({
        label: 'shared_limiter',
        wrapEmbedding: (counted) => {
          faulty = faultyProvider(counted);
          return new RateLimitedEmbeddingProvider(faulty.provider, {
            maxBackoffMs: 5000,
          });
        },
        config: {
          api: { cacheTtlMs: 0 },
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
              template: '{{userId}}: {{text}}\n',
            },
          ],
        },
      });
      const seeded = await notify(A, true);
      if (seeded.results?.[0]?.status !== 'indexed') {
        throw new Error(`Seeding failed: ${JSON.stringify(seeded)}`);
      }
    });

    afterAll(async () => {
      await harness.close();
      await stub.close();
    });

    /** POST /documents for one reference. */
    async function notify(
      source: string,
      wait: boolean,
    ): Promise<{ accepted?: string[]; results?: { status: string }[] }> {
      const res = await harness.app.inject({
        method: 'POST',
        url: `/documents${wait ? '?wait=true' : ''}`,
        payload: { documents: [{ source, rule: RULE }] },
      });
      return res.json();
    }

    const reindexIdle = async () => {
      const res = await harness.app.inject({ url: '/status' });
      return !res.json<{ health: { reindex: { active: boolean } } }>().health
        .reindex.active;
    };

    it('a forced 429 pauses notify, search and reindex until Retry-After', async () => {
      stub.route(PATH_A, thread('u1', 'alpha edited'));
      const mark = faulty.calls.length;
      faulty.rateLimitNext(PAUSE_MS);

      // Notify takes the 429; the limiter now pauses every caller.
      const notified = notify(B, true);
      await waitFor(() => faulty.calls.length > mark);
      const limited = faulty.calls[mark];
      expect(limited.ok).toBe(false);
      const resumeAt = limited.at + PAUSE_MS;

      // Search and reindex start inside the pause.
      const searchStart = Date.now();
      const searched = harness.app.inject({
        method: 'POST',
        url: '/search',
        payload: { query: 'alpha', limit: 5 },
      });
      const reindexed = await harness.app.inject({
        method: 'POST',
        url: '/reindex',
        payload: { scope: 'full' },
      });
      expect(reindexed.statusCode).toBe(200);
      expect(searchStart).toBeLessThan(resumeAt - 500);

      const search = await searched;
      expect(search.statusCode).toBe(200);
      expect(Date.now()).toBeGreaterThanOrEqual(resumeAt - SLACK_MS);
      expect((await notified).results).toEqual([
        expect.objectContaining({ status: 'indexed' }),
      ]);
      await waitFor(reindexIdle);

      // Nothing reached the provider during the pause: every request after
      // the 429 arrived once Retry-After had passed.
      const after = faulty.calls.slice(mark + 1);
      expect(after.length).toBeGreaterThanOrEqual(3);
      for (const call of after) {
        expect(call.ok).toBe(true);
        expect(call.at).toBeGreaterThanOrEqual(resumeAt - SLACK_MS);
      }
      expect(
        await harness.vectorStore.getPayload(sourcePointId(A, 0)),
      ).toMatchObject({
        chunk_text: expect.stringContaining('alpha edited') as unknown,
      });
      expect(
        await harness.vectorStore.getPayload(sourcePointId(B, 0)),
      ).toMatchObject({ source: B });
    });

    it('a source embedding failure appears in GET /issues as embedding_error', async () => {
      faulty.failNext(new Error('provider exploded'));
      expect(await notify(C, false)).toMatchObject({ accepted: [C] });
      let issues: Record<string, { type: string; rule?: string }[]> = {};
      await waitFor(async () => {
        const res = await harness.app.inject({ url: '/issues' });
        issues = res.json<{ issues: typeof issues }>().issues;
        return C in issues;
      });
      expect(issues[C]).toEqual([
        expect.objectContaining({ type: 'embedding_error', rule: RULE }),
      ]);
      expect(
        await harness.vectorStore.getPayload(sourcePointId(C, 0)),
      ).toBeNull();
    });
  },
);
