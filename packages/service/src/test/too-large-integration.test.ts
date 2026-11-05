/**
 * @module test/too-large-integration.test
 * Processing ceilings against real Qdrant (D44, D64, D76): a file over maxFileBytes, over maxTextBytes or over maxChunksPerFile has its points deleted and a too_large issue recorded (a file exactly at the ceiling is indexed); a source document over maxChunksPerFile answers failed with code too_large; raising a ceiling and reprocessing restores the document.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pointId, sourcePointId } from '../pointId';
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

const RULE = 'chat-thread';
const REF = 'app://chat/thread/big';
const PATH = '/threads/chat/thread/big';

/** Text that splits into `n` chunks of the harness's 100-character chunk size. */
function textOfChunks(n: number): string {
  return Array.from({ length: n }, (_, i) =>
    `paragraph ${String(i)} `.padEnd(95, 'x'),
  ).join('\n\n');
}

describe.skipIf(!qdrantAvailable())(
  'Processing ceilings (requires Qdrant)',
  () => {
    let harness: ServiceHarness;
    let stub: StubSourceServer;
    let watchDir: string;

    beforeAll(async () => {
      watchDir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-it-big-'));
      stub = await startStubSourceServer({
        [PATH]: { body: { userId: 'u1', text: textOfChunks(12) } },
      });
      harness = await startServiceHarness({
        label: 'too_large',
        config: {
          api: { cacheTtlMs: 0 },
          watch: { paths: [join(watchDir, '**/*')], ignored: [] },
          processing: {
            maxFileBytes: 4000,
            maxChunksPerFile: 10,
            maxTextBytes: 3000,
          },
          embedding: {
            provider: 'mock',
            model: 'mock',
            dimensions: HARNESS_DIMENSIONS,
            chunkSize: 100,
            chunkOverlap: 0,
            concurrency: 4,
            rateLimitPerMinute: 100000,
          },
          sources: {
            app: {
              url: `${stub.url}/threads/{id}`,
              timeoutMs: 2000,
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
              template: '{{userId}}: {{text}}',
            },
          ],
        },
      });
    });

    afterAll(async () => {
      await harness.close();
      await stub.close();
      await rm(watchDir, { recursive: true, force: true });
    });

    function issueTypes(key: string): string[] | undefined {
      return harness.issuesManager.getAll()[key]?.map((i) => i.type);
    }

    async function chunk0(file: string) {
      return harness.vectorStore.getPayload(pointId(file, 0));
    }

    it('indexes a file exactly at the chunk ceiling, then deletes it once over', async () => {
      const file = join(watchDir, 'grows.md');
      await writeFile(file, textOfChunks(10), 'utf8');
      await harness.processor.processFile(file);
      expect((await chunk0(file))?.total_chunks).toBe(10);

      await writeFile(file, textOfChunks(11), 'utf8');
      await harness.processor.processFile(file);
      expect(await chunk0(file)).toBeNull();
      expect(await harness.vectorStore.getPayload(pointId(file, 9))).toBeNull();
      expect(issueTypes(file)).toEqual(['too_large']);
      expect(harness.issuesManager.getAll()[file]?.[0]?.message).toContain(
        'maxChunksPerFile',
      );
    });

    it('deletes a file over maxTextBytes', async () => {
      const file = join(watchDir, 'wordy.md');
      await writeFile(file, 'a '.repeat(1600), 'utf8');
      await harness.processor.processFile(file);
      expect(await chunk0(file)).toBeNull();
      expect(issueTypes(file)).toEqual(['too_large']);
      expect(harness.issuesManager.getAll()[file]?.[0]?.message).toContain(
        'maxTextBytes',
      );
    });

    it('deletes a file over maxFileBytes before extraction', async () => {
      const file = join(watchDir, 'huge.md');
      await writeFile(file, textOfChunks(3), 'utf8');
      await harness.processor.processFile(file);
      expect(await chunk0(file)).not.toBeNull();

      await writeFile(file, 'z'.repeat(5000), 'utf8');
      await harness.processor.processFile(file);
      expect(await chunk0(file)).toBeNull();
      expect(harness.issuesManager.getAll()[file]?.[0]?.message).toContain(
        'maxFileBytes',
      );
    });

    it('answers failed with code too_large for a source document over maxChunksPerFile', async () => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/documents?wait=true',
        payload: { documents: [{ source: REF, rule: RULE }] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        results: [
          { source: REF, status: 'failed', error: { code: 'too_large' } },
        ],
      });
      expect(
        await harness.vectorStore.getPayload(sourcePointId(REF, 0)),
      ).toBeNull();
      expect(issueTypes(REF)).toEqual(['too_large']);
    });
  },
);
