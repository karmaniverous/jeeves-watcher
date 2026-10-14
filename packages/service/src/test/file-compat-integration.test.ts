/**
 * @module test/file-compat-integration.test
 * File points written by this release are identical to 0.19.1: golden point IDs, and (requires Qdrant) a multi-chunk rule-matched file stored under the 0.19.1 IDs with exactly the 0.19.1 payload keys, chunking, line ranges and hash, and no source fields.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { v5 as uuidV5 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pointId } from '../pointId';
import {
  FILE_PAYLOAD_KEYS_0191,
  GOLDEN_IDS_0191,
  idKey0191,
  NAMESPACE_0191,
  SAMPLE_0191,
  SAMPLE_HASH_0191,
  SAMPLE_LINES_0191,
} from './fileCompat0191';
import { qdrantAvailable } from './harness/qdrant';
import {
  HARNESS_DIMENSIONS,
  type ServiceHarness,
  startServiceHarness,
} from './harness/service';

describe('file point IDs match 0.19.1', () => {
  it.each(GOLDEN_IDS_0191)('pointId(%j, %j) = %s', (path, chunk, id) => {
    expect(pointId(path, chunk)).toBe(id);
  });
});

describe.skipIf(!qdrantAvailable())(
  'File points match 0.19.1 (requires Qdrant)',
  () => {
    let harness: ServiceHarness;
    let watchDir: string;
    let file: string;

    beforeAll(async () => {
      watchDir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-it-watch-'));
      file = join(watchDir, 'Guide.md');
      await writeFile(file, SAMPLE_0191, 'utf8');
      harness = await startServiceHarness({
        label: 'file_compat',
        config: {
          watch: { paths: [join(watchDir, '**/*')], ignored: [] },
          embedding: {
            provider: 'mock',
            model: 'mock',
            dimensions: HARNESS_DIMENSIONS,
            chunkSize: 250,
            chunkOverlap: 0,
            concurrency: 1,
            rateLimitPerMinute: 100000,
          },
          inferenceRules: [
            {
              name: 'guides',
              description: 'Markdown guides',
              match: {
                type: 'object',
                properties: {
                  file: {
                    type: 'object',
                    properties: { path: { type: 'string', glob: '**/*.md' } },
                  },
                },
              },
              schema: [
                {
                  type: 'object',
                  properties: { domain: { type: 'string', set: 'guides' } },
                },
              ],
            },
          ],
        },
      });
      await harness.processor.processFile(file);
    });

    afterAll(async () => {
      await harness.close();
      await rm(watchDir, { recursive: true, force: true });
    });

    it('stores every chunk under the 0.19.1 ID with exactly the 0.19.1 payload keys', async () => {
      const first = await harness.vectorStore.getPayload(
        uuidV5(idKey0191(file, 0), NAMESPACE_0191),
      );
      const total = SAMPLE_LINES_0191.length;
      expect(first?.['total_chunks']).toBe(total);

      for (let i = 0; i < total; i++) {
        const id = uuidV5(idKey0191(file, i), NAMESPACE_0191);
        expect(pointId(file, i)).toBe(id);
        const payload = await harness.vectorStore.getPayload(id);
        expect(Object.keys(payload ?? {}).sort()).toEqual(
          FILE_PAYLOAD_KEYS_0191,
        );
        expect(payload).toMatchObject({
          file_path: file.replace(/\\/g, '/'),
          chunk_index: i,
          total_chunks: total,
          domain: 'guides',
          matched_rules: ['guides'],
          content_hash: SAMPLE_HASH_0191,
          line_start: SAMPLE_LINES_0191[i][0],
          line_end: SAMPLE_LINES_0191[i][1],
        });
      }
      expect(
        await harness.vectorStore.count({
          must: [
            { key: 'file_path', match: { value: file.replace(/\\/g, '/') } },
          ],
        }),
      ).toBe(total);
    });
  },
);
