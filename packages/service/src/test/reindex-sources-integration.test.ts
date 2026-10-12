/**
 * @module test/reindex-sources-integration.test
 * Service integration (requires Qdrant): POST /reindex full re-retrieves every source document through the stub callback and updates changed ones; a 500 records an issue and leaves the points; prune keeps source points.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sourcePointId } from '../pointId';
import { qdrantAvailable } from './harness/qdrant';
import { type ServiceHarness, startServiceHarness } from './harness/service';
import {
  startStubSourceServer,
  type StubSourceServer,
} from './harness/stubSource';

const RULE = 'chat-thread';
const A = 'app://chat/thread/a';
const B = 'app://chat/thread/b';
const PATH_A = '/threads/chat/thread/a';
const PATH_B = '/threads/chat/thread/b';

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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe.skipIf(!qdrantAvailable())(
  'Service integration: reindex covers source documents (requires Qdrant)',
  () => {
    let stub: StubSourceServer;
    let harness: ServiceHarness;
    let watchDir: string;

    beforeAll(async () => {
      watchDir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-it-watch-'));
      stub = await startStubSourceServer({
        [PATH_A]: thread('u1', 'alpha'),
        [PATH_B]: thread('u2', 'bravo'),
      });
      harness = await startServiceHarness({
        label: 'reindex_sources',
        config: {
          watch: { paths: [join(watchDir, '**/*')], ignored: [] },
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
              schema: [
                {
                  type: 'object',
                  properties: {
                    user_id: { type: 'string', set: '{{json.userId}}' },
                  },
                },
              ],
              template: '{{userId}}: {{text}}\n',
            },
          ],
        },
      });
      const res = await harness.app.inject({
        method: 'POST',
        url: '/documents?wait=true',
        payload: {
          documents: [
            { source: A, rule: RULE },
            { source: B, rule: RULE },
          ],
        },
      });
      const { results } = res.json<{ results: { status: string }[] }>();
      if (!results.every((r) => r.status === 'indexed')) {
        throw new Error(`Seeding failed: ${JSON.stringify(results)}`);
      }
    });

    afterAll(async () => {
      await harness.close();
      await stub.close();
      await rm(watchDir, { recursive: true, force: true });
    });

    const payloadOf = (ref: string) =>
      harness.vectorStore.getPayload(sourcePointId(ref, 0));

    /** POST /reindex, then wait for both callbacks and the run to finish. */
    const reindex = async (body: object) => {
      const mark = stub.requests.length;
      const res = await harness.app.inject({
        method: 'POST',
        url: '/reindex',
        payload: body,
      });
      const fetched = (path: string) =>
        stub.requests.slice(mark).some((r) => r.path === path);
      await waitFor(() => fetched(PATH_A) && fetched(PATH_B));
      await waitFor(async () => {
        const status = await harness.app.inject({ url: '/status' });
        const { health } = status.json<{
          health: { reindex: { active: boolean } };
        }>();
        return !health.reindex.active;
      });
      return res.json<{ plan: unknown }>();
    };

    it('full re-retrieves both documents and updates the changed one', async () => {
      stub.route(PATH_A, thread('u1', 'alpha edited'));

      const { plan } = await reindex({ scope: 'full' });

      expect(plan).toEqual({
        total: 2,
        toProcess: 2,
        toDelete: 0,
        byRoot: { app: 2 },
      });
      expect(await payloadOf(A)).toMatchObject({
        chunk_text: expect.stringContaining('alpha edited') as unknown,
        source: A,
        source_rule: RULE,
      });
      expect(await payloadOf(B)).toMatchObject({
        chunk_text: expect.stringContaining('bravo') as unknown,
      });
      expect(harness.issuesManager.get(A)).toBeUndefined();
    });

    it('a callback 500 records an issue and leaves the points', async () => {
      const before = await payloadOf(B);
      stub.route(PATH_B, { status: 500, body: { error: 'down' } });

      await reindex({ scope: 'full' });

      expect(harness.issuesManager.get(B)).toEqual([
        expect.objectContaining({ type: 'source_unavailable' }),
      ]);
      expect(await payloadOf(B)).toEqual(before);
      expect(await payloadOf(A)).not.toBeNull();
    });

    it('prune never selects source points', async () => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/reindex',
        payload: { scope: 'prune', dryRun: true },
      });
      expect(res.json()).toMatchObject({
        plan: { toDelete: 0 },
      });
      expect(await payloadOf(A)).not.toBeNull();
      expect(await payloadOf(B)).not.toBeNull();
    });
  },
);
