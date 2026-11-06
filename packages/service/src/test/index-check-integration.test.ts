/**
 * @module test/index-check-integration.test
 * Service integration (requires Qdrant): the index check at start (D197) against a real collection and the real processor. A file gone from disk loses every chunk, deleted through the processor under its document lock (it waits for a holder); a file still on disk but missing from the inventory, a file outside the root and a source document keep their points; a root over the cap (more than 20 missing and more than 10%, D198) keeps everything.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { pointId, sourcePointId } from '../pointId';
import { fileLockKey } from '../processor/DocumentLocks';
import { normalizeSlashes } from '../util/normalizeSlashes';
import { IndexCheckHealthTracker } from '../watcher/indexCheck/IndexCheckHealthTracker';
import { runIndexCheck } from '../watcher/indexCheck/runIndexCheck';
import type { IndexCheckView } from '../watcher/indexCheck/view';
import { Inventory } from '../watcher/inventory/Inventory';
import {
  clearCollection,
  qdrantAvailable,
  SETUP_IN_TEST_TIMEOUT_MS,
} from './harness/qdrant';
import {
  HARNESS_DIMENSIONS,
  type ServiceHarness,
  startServiceHarness,
} from './harness/service';

const SOURCE_REF = 'app://chat/thread/1';
const KEPT = 18;

const vector = () => Array.from({ length: HARNESS_DIMENSIONS }, () => 0.5);

describe.skipIf(!qdrantAvailable())(
  'Service integration: index check at start (requires Qdrant)',
  () => {
    let harness: ServiceHarness;
    let root: string;
    let outside: string;
    let inventory: Inventory;

    /** Upsert a file document of `chunks` points. */
    async function indexFile(path: string, chunks = 1): Promise<void> {
      await harness.vectorStore.upsert(
        Array.from({ length: chunks }, (_, i) => ({
          id: pointId(path, i),
          vector: vector(),
          payload: {
            file_path: normalizeSlashes(path),
            chunk_index: i,
            total_chunks: chunks,
          },
        })),
      );
    }

    /** Whether the point exists. */
    async function exists(id: string): Promise<boolean> {
      return (await harness.vectorStore.getPayload(id)) !== null;
    }

    function view(): IndexCheckView {
      return {
        roots: [normalizeSlashes(root)],
        skipReason: () => undefined,
        has: (path) => inventory.get(path) !== undefined,
        live: () => true,
      };
    }

    function check(health: IndexCheckHealthTracker) {
      return runIndexCheck({
        view: view(),
        vectorStore: harness.vectorStore,
        deleteFile: (path) => harness.processor.deleteFile(path),
        health,
        logger: pino({ level: 'silent' }),
      });
    }

    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), 'jeeves-watcher-it-check-'));
      outside = await mkdtemp(join(tmpdir(), 'jeeves-watcher-it-out-'));
      harness = await startServiceHarness({
        label: 'index_check',
        config: { watch: { paths: [join(root, '**/*')], ignored: [] } },
      });
    }, SETUP_IN_TEST_TIMEOUT_MS);

    afterAll(async () => {
      await harness.close();
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    });

    beforeEach(async () => {
      await clearCollection(harness.collectionName);
      inventory = new Inventory(false);
      for (let i = 0; i < KEPT; i++) {
        const path = join(root, `kept-${String(i)}.md`);
        await writeFile(path, 'kept', 'utf8');
        inventory.set(path);
        await indexFile(path);
      }
      await harness.vectorStore.upsert([
        {
          id: sourcePointId(SOURCE_REF, 0),
          vector: vector(),
          payload: { source: SOURCE_REF, chunk_index: 0, total_chunks: 1 },
        },
      ]);
      await indexFile(join(outside, 'gone-outside.md'));
    });

    it('deletes a gone file under its lock and leaves the rest', async () => {
      const gone = join(root, 'gone.md');
      const present = join(root, 'present-not-in-inventory.md');
      await writeFile(present, 'still here', 'utf8');
      await indexFile(gone, 2);
      await indexFile(present);

      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let acquired!: () => void;
      const holding = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const holder = harness.documentLocks.run(
        fileLockKey(gone),
        'test hold',
        async () => {
          acquired();
          await held;
        },
      );
      await holding;

      const health = new IndexCheckHealthTracker();
      const run = check(health);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await exists(pointId(gone, 0))).toBe(true);
      release();
      await holder;
      await run;

      expect(await exists(pointId(gone, 0))).toBe(false);
      expect(await exists(pointId(gone, 1))).toBe(false);
      expect(await exists(pointId(present, 0))).toBe(true);
      expect(await exists(pointId(join(root, 'kept-0.md'), 0))).toBe(true);
      expect(await exists(pointId(join(outside, 'gone-outside.md'), 0))).toBe(
        true,
      );
      expect(await exists(sourcePointId(SOURCE_REF, 0))).toBe(true);
      expect(health.snapshot()).toMatchObject({
        state: 'done',
        checked: KEPT + 2,
        removed: 1,
        capped: 0,
      });
    });

    it('deletes nothing under a root over the cap', async () => {
      // 21 of 39: above both the 20-document floor and 10% (D198).
      const gone = Array.from({ length: 21 }, (_, i) =>
        join(root, `gone-${String(i)}.md`),
      );
      for (const path of gone) await indexFile(path);

      const health = new IndexCheckHealthTracker();
      await check(health);

      for (const path of gone)
        expect(await exists(pointId(path, 0))).toBe(true);
      expect(health.snapshot()).toMatchObject({
        state: 'done',
        checked: KEPT + gone.length,
        removed: 0,
        capped: 1,
      });
    });
  },
);
