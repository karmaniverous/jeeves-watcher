/**
 * @module test/rules-prune-integration.test
 * Service integration (requires Qdrant): rules naming reserved fields warn on /config/validate and can never overwrite `file_path` / `source`, at index time or on an explicit `rules` reindex; a live prune deletes orphaned file points but never source points.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pointId, sourcePointId } from '../pointId';
import { normalizeSlashes } from '../util/normalizeSlashes';
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
const REF = 'cg://chat/thread/r';
const PATH = '/threads/chat/thread/r';

/** Schema properties that try to hijack identity fields. */
const hijack = {
  file_path: { type: 'string', set: 'hijacked' },
  source: { type: 'string', set: 'hijacked' },
  total_chunks: { type: 'integer', set: '99' },
};

/** Poll until a condition holds (15 s budget). */
async function waitFor(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 15000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe.skipIf(!qdrantAvailable())(
  'Service integration: reserved fields, rules reindex and prune (requires Qdrant)',
  () => {
    let stub: StubSourceServer;
    let harness: ServiceHarness;
    let watchDir: string;
    let file: string;

    beforeAll(async () => {
      watchDir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-it-watch-'));
      file = join(watchDir, 'notes.txt');
      await writeFile(file, 'Reference notes on credit utilisation.', 'utf8');
      stub = await startStubSourceServer({
        [PATH]: { body: { userId: 'u1', text: 'thread text' } },
      });
      harness = await startServiceHarness({
        label: 'rules_prune',
        config: {
          watch: { paths: [join(watchDir, '**/*')], ignored: [] },
          api: { cacheTtlMs: 0 },
          sources: {
            cg: {
              url: `${stub.url}/threads/{id}`,
              timeoutMs: 5000,
              concurrency: 2,
            },
          },
          inferenceRules: [
            {
              name: 'notes',
              description: 'Text notes',
              match: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: {
                    type: 'object',
                    properties: { path: { type: 'string', glob: '**/*.txt' } },
                  },
                },
              },
              schema: [
                {
                  type: 'object',
                  properties: {
                    ...hijack,
                    domain: { type: 'string', set: 'notes' },
                  },
                },
              ],
            },
            {
              name: RULE,
              description: 'Chat thread',
              match: { type: 'object', required: ['source', 'json'] },
              schema: [
                {
                  type: 'object',
                  properties: {
                    ...hijack,
                    user_id: { type: 'string', set: '{{json.userId}}' },
                  },
                },
              ],
              template: '{{userId}}: {{text}}',
            },
          ],
        },
      });
      await harness.processor.processFile(file);
      const res = await harness.app.inject({
        method: 'POST',
        url: '/documents?wait=true',
        payload: { documents: [{ source: REF, rule: RULE }] },
      });
      if (!JSON.stringify(res.json()).includes('"indexed"')) {
        throw new Error(`Seeding failed: ${res.body}`);
      }
    });

    afterAll(async () => {
      await harness.close();
      await stub.close();
      await rm(watchDir, { recursive: true, force: true });
    });

    const post = async (url: string, payload: object) =>
      (
        await harness.app.inject({ method: 'POST', url, payload })
      ).json<unknown>();
    const filePayload = () => harness.vectorStore.getPayload(pointId(file, 0));
    const sourcePayload = () =>
      harness.vectorStore.getPayload(sourcePointId(REF, 0));
    const reindexIdle = async () => {
      const res = await harness.app.inject({ url: '/status' });
      return !res.json<{ health: { reindex: { active: boolean } } }>().health
        .reindex.active;
    };

    it('warns about reserved property names on /config/validate', async () => {
      const result = (await post('/config/validate', {
        config: {
          inferenceRules: [
            {
              name: 'r',
              description: 'd',
              match: { type: 'object' },
              schema: [{ type: 'object', properties: hijack }],
            },
          ],
        },
      })) as { valid: boolean; warnings: { path: string }[] };
      expect(result.valid).toBe(true);
      expect(result.warnings.map((w) => w.path)).toEqual(
        expect.arrayContaining([
          'inferenceRules[r].schema.file_path',
          'inferenceRules[r].schema.source',
          'inferenceRules[r].schema.total_chunks',
        ]),
      );
    });

    it('never lets a rule overwrite identity fields at index time', async () => {
      expect(await filePayload()).toMatchObject({
        file_path: normalizeSlashes(file),
        domain: 'notes',
        total_chunks: 1,
      });
      expect(await filePayload()).not.toHaveProperty('source');
      expect(await sourcePayload()).toMatchObject({
        source: REF,
        source_rule: RULE,
        total_chunks: 1,
      });
      expect(await sourcePayload()).not.toHaveProperty('file_path');
    });

    it('a rules reindex re-applies rules without overwriting file_path / source', async () => {
      // Stale projected values prove the rules really are re-applied.
      await harness.vectorStore.setPayload([pointId(file, 0)], {
        domain: 'stale',
      });
      await harness.vectorStore.setPayload([sourcePointId(REF, 0)], {
        user_id: 'stale',
      });
      const mark = stub.requests.length;
      const res = (await post('/reindex', { scope: 'rules' })) as {
        status: string;
      };
      expect(res.status).toBe('started');
      await waitFor(
        async () => stub.requests.length > mark && (await reindexIdle()),
      );

      expect(await filePayload()).toMatchObject({
        file_path: normalizeSlashes(file),
        domain: 'notes',
        total_chunks: 1,
      });
      expect(await filePayload()).not.toHaveProperty('source');
      expect(await sourcePayload()).toMatchObject({
        source: REF,
        source_rule: RULE,
        user_id: 'u1',
        total_chunks: 1,
      });
      expect(await sourcePayload()).not.toHaveProperty('file_path');
    });

    it('a live prune deletes an orphaned file point and never a source point', async () => {
      const orphan = join(watchDir, 'deleted.txt');
      await harness.vectorStore.upsert([
        {
          id: pointId(orphan, 0),
          vector: Array.from({ length: HARNESS_DIMENSIONS }, () => 0.5),
          payload: {
            file_path: normalizeSlashes(orphan),
            chunk_index: 0,
            total_chunks: 1,
          },
        },
      ]);

      expect(
        await post('/reindex', { scope: 'prune', dryRun: true }),
      ).toMatchObject({
        plan: { toDelete: 1 },
      });
      expect(await post('/reindex', { scope: 'prune' })).toMatchObject({
        status: 'started',
      });
      await waitFor(
        async () =>
          (await harness.vectorStore.getPayload(pointId(orphan, 0))) === null &&
          (await reindexIdle()),
      );

      expect(await sourcePayload()).toMatchObject({ source: REF });
      expect(await filePayload()).toMatchObject({
        file_path: normalizeSlashes(file),
      });
    });
  },
);
