/**
 * @module test/extraction-failure-integration.test
 * An indexed file that fails extraction, against real Qdrant (D201): edited to front matter 0.21.0 no longer parses (`!!float 1`, D169, D180), its points are deleted and an `extraction_error` issue recorded; fixed again, it is re-indexed and the issue cleared. A file that never indexed fails without touching the index.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pointId } from '../pointId';
import { qdrantAvailable } from './harness/qdrant';
import {
  HARNESS_DIMENSIONS,
  type ServiceHarness,
  startServiceHarness,
} from './harness/service';

/** A Markdown file with `rank` front matter and a body of `n` chunks. */
function markdown(rank: string, n: number): string {
  const body = Array.from({ length: n }, (_, i) =>
    `lemur paragraph ${String(i)} `.padEnd(95, 'x'),
  ).join('\n\n');
  return `---\nrank: ${rank}\n---\n\n${body}\n`;
}

describe.skipIf(!qdrantAvailable())(
  'Extraction failure of an indexed file (requires Qdrant)',
  () => {
    let harness: ServiceHarness;
    let watchDir: string;

    beforeAll(async () => {
      watchDir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-it-extract-'));
      harness = await startServiceHarness({
        label: 'extraction_failure',
        config: {
          api: { cacheTtlMs: 0 },
          watch: { paths: [join(watchDir, '**/*')], ignored: [] },
          embedding: {
            provider: 'mock',
            model: 'mock',
            dimensions: HARNESS_DIMENSIONS,
            chunkSize: 100,
            chunkOverlap: 0,
            concurrency: 4,
            rateLimitPerMinute: 100000,
          },
        },
      });
    });

    afterAll(async () => {
      await harness.close();
      await rm(watchDir, { recursive: true, force: true });
    });

    const issues = (key: string) => harness.issuesManager.getAll()[key];
    const point = (file: string, chunk: number) =>
      harness.vectorStore.getPayload(pointId(file, chunk));

    it('deletes the points when the file stops parsing, and re-indexes it once fixed', async () => {
      const file = join(watchDir, 'float.md');
      await writeFile(file, markdown('!!float 1.5', 3), 'utf8');
      await harness.processor.processFile(file);
      expect((await point(file, 0))?.total_chunks).toBe(3);
      expect(issues(file)).toBeUndefined();

      await writeFile(file, markdown('!!float 1', 3), 'utf8');
      await harness.processor.processFile(file);
      for (const chunk of [0, 1, 2])
        expect(await point(file, chunk)).toBeNull();
      expect(issues(file)?.map((i) => i.type)).toEqual(['extraction_error']);
      expect(issues(file)?.[0]?.message).toContain('TAG_RESOLVE_FAILED');

      await writeFile(file, markdown('!!float 1.0', 2), 'utf8');
      await harness.processor.processFile(file);
      expect((await point(file, 0))?.total_chunks).toBe(2);
      expect(await point(file, 1)).not.toBeNull();
      expect(issues(file)).toBeUndefined();
    });

    it('records the failure of a file that was never indexed, writing nothing', async () => {
      const file = join(watchDir, 'never.md');
      await writeFile(file, markdown('!!float "1"', 1), 'utf8');
      await harness.processor.processFile(file);
      expect(await point(file, 0)).toBeNull();
      expect(issues(file)?.map((i) => i.type)).toEqual(['extraction_error']);
    });
  },
);
