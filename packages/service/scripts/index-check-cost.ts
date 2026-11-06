/**
 * @module scripts/index-check-cost
 * The index check's cost (P13a, D197) on a throwaway Qdrant: a payload-only copy of a source collection (only read: GET and scroll), an inventory of every chunk-0 file document under the watch roots minus a chosen number of "missing" ones, then the real `runIndexCheck` twice: before the system payload indexes exist (a first start: listing only) and after (deletes through the document lock and `deleteDocumentPoints`). Reports wall time, Qdrant scroll time and pages, event-loop delay, memory, and a census before and after (only the missing documents may go; source documents and points outside the roots must stay).
 *
 * Usage: `npm run index-check:cost -w packages/service -- --source-collection <name> --paths <glob> [--paths <glob> ...] [--source-url http://127.0.0.1:6333] [--missing 500] [--page-size 1000] [--out result.json]`
 */

import { writeFileSync } from 'node:fs';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import pino from 'pino';

import { DocumentLocks, fileLockKey } from '../src/processor/DocumentLocks';
import { deleteDocumentPoints } from '../src/processor/documentPipeline';
import { isSourcePoint } from '../src/processor/payloadFields';
import { provisionEphemeralQdrant } from '../src/test/qdrant/ephemeralQdrant';
import { normalizeSlashes } from '../src/util/normalizeSlashes';
import { findRootForPath } from '../src/vcs/gitExec';
import { VectorStoreClient } from '../src/vectorStore';
import { resolveWatchPaths } from '../src/watcher/globToDir';
import { IndexCheckHealthTracker } from '../src/watcher/indexCheck/IndexCheckHealthTracker';
import {
  CHUNK0_FILTER,
  INDEX_CHECK_PAGE_SIZE,
  runIndexCheck,
} from '../src/watcher/indexCheck/runIndexCheck';
import { INDEX_CHECK_MAX_SHARE } from '../src/watcher/indexCheck/tally';
import { Inventory } from '../src/watcher/inventory/Inventory';
import { copyPayloads, sourcePointCount } from './facetGate/copy';

const log = (message: string) => {
  console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);
};

const COLLECTION = 'index_check_cost';

const { values } = parseArgs({
  options: {
    'source-collection': { type: 'string' },
    'source-url': { type: 'string', default: 'http://127.0.0.1:6333' },
    paths: { type: 'string', multiple: true },
    missing: { type: 'string', default: '500' },
    'page-size': { type: 'string', default: String(INDEX_CHECK_PAGE_SIZE) },
    out: { type: 'string' },
  },
});
const sourceCollection = values['source-collection'];
const globs = values.paths ?? [];
if (!sourceCollection || globs.length === 0) {
  throw new Error('--source-collection and at least one --paths are required');
}
const sourceUrl = values['source-url'];
const missingWanted = Number(values.missing);
const pageSize = Number(values['page-size']);
const { roots } = resolveWatchPaths(globs);
const rootKeys = roots
  .map((r) => normalizeSlashes(r).replace(/\/+$/, ''))
  .sort((a, b) => b.length - a.length);

/** Points by kind: file documents under the roots, outside, sources. */
interface Census {
  points: number;
  chunk0UnderRoots: number;
  chunk0Outside: number;
  chunk0Sources: number;
  /** Chunk-0 file paths under the roots, by root. */
  byRoot: Map<string, string[]>;
}

/** Scroll the copy's chunk-0 points into a census (not timed). */
async function census(store: VectorStoreClient): Promise<Census> {
  const result: Census = {
    points: (await store.getCollectionInfo()).pointCount,
    chunk0UnderRoots: 0,
    chunk0Outside: 0,
    chunk0Sources: 0,
    byRoot: new Map(),
  };
  let cursor: string | number | undefined;
  do {
    const page = await store.scrollPage(CHUNK0_FILTER, 2000, cursor, [
      'file_path',
      'source',
    ]);
    for (const { payload } of page.points) {
      if (isSourcePoint(payload)) {
        result.chunk0Sources += 1;
        continue;
      }
      const filePath = payload.file_path;
      if (typeof filePath !== 'string') continue;
      const root = findRootForPath(
        rootKeys,
        normalizeSlashes(filePath),
        process.platform,
      );
      if (root === undefined) {
        result.chunk0Outside += 1;
        continue;
      }
      result.chunk0UnderRoots += 1;
      const list = result.byRoot.get(root) ?? [];
      list.push(filePath);
      result.byRoot.set(root, list);
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return result;
}

/** Choose missing documents per root, within each root's cap. */
function chooseMissing(before: Census): Set<string> {
  const total = before.chunk0UnderRoots;
  const missing = new Set<string>();
  for (const paths of before.byRoot.values()) {
    const share = Math.round((missingWanted * paths.length) / total);
    const cap = Math.min(
      1000,
      Math.floor(paths.length * INDEX_CHECK_MAX_SHARE),
    );
    const n = Math.min(share, cap);
    for (let i = 0; i < n; i++) {
      missing.add(paths[Math.floor((i * paths.length) / n)]);
    }
  }
  return missing;
}

/** Wait until the collection's optimizers are idle (status green). */
async function waitGreen(url: string): Promise<void> {
  for (;;) {
    const res = await fetch(`${url}/collections/${COLLECTION}`);
    const { result } = (await res.json()) as { result: { status: string } };
    if (result.status === 'green') return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

/** One timed run of the real check. */
async function timedRun(
  label: string,
  store: VectorStoreClient,
  inventory: Inventory,
  missing: Set<string>,
  remove: boolean,
): Promise<Record<string, unknown>> {
  const locks = new DocumentLocks(pino({ level: 'silent' }));
  let scrollMs = 0;
  let pages = 0;
  let deleteMs = 0;
  const timedStore = {
    scrollPage: async (
      ...args: Parameters<VectorStoreClient['scrollPage']>
    ) => {
      const started = performance.now();
      try {
        return await store.scrollPage(...args);
      } finally {
        scrollMs += performance.now() - started;
        pages += 1;
      }
    },
  };
  const health = new IndexCheckHealthTracker();
  const delay = monitorEventLoopDelay({ resolution: 10 });
  const rssBefore = process.memoryUsage().rss;
  let rssPeak = rssBefore;
  let heapPeak = process.memoryUsage().heapUsed;
  const sampler = setInterval(() => {
    const m = process.memoryUsage();
    rssPeak = Math.max(rssPeak, m.rss);
    heapPeak = Math.max(heapPeak, m.heapUsed);
  }, 100);
  delay.enable();
  const started = performance.now();
  await runIndexCheck({
    view: {
      roots,
      skipReason: () => undefined,
      has: (path) => inventory.get(path) !== undefined,
      live: () => true,
    },
    vectorStore: timedStore,
    deleteFile: async (path) => {
      if (!remove) return;
      const t = performance.now();
      await locks.run(fileLockKey(path), 'delete', () =>
        deleteDocumentPoints(store, { kind: 'file', filePath: path }),
      );
      deleteMs += performance.now() - t;
    },
    isGone: (path) => Promise.resolve(missing.has(path)),
    health,
    logger: pino({ level: 'warn' }),
    pageSize,
  });
  const wallMs = performance.now() - started;
  delay.disable();
  clearInterval(sampler);
  const ms = (ns: number) => Math.round(ns / 1e5) / 10;
  const mb = (bytes: number) => Math.round(bytes / 2 ** 20);
  const result = {
    label,
    wallMs: Math.round(wallMs),
    scrollMs: Math.round(scrollMs),
    pages,
    deleteMs: Math.round(deleteMs),
    eventLoopDelayMs: {
      p50: ms(delay.percentile(50)),
      p99: ms(delay.percentile(99)),
      max: ms(delay.max),
    },
    rssMb: { before: mb(rssBefore), peak: mb(rssPeak) },
    heapPeakMb: mb(heapPeak),
    health: health.snapshot(),
  };
  log(`${label}: ${JSON.stringify(result)}`);
  return result;
}

const { qdrant, failures } = await provisionEphemeralQdrant();
if (!qdrant) throw new Error(`No throwaway Qdrant: ${failures.join('; ')}`);
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  source: `${sourceUrl}/${sourceCollection}`,
  roots,
  pageSize,
};
try {
  const sourcePoints = await sourcePointCount({
    url: sourceUrl,
    collection: sourceCollection,
  });
  log(`source ${String(sourcePoints)} points; copying`);
  const copyStarted = performance.now();
  const copy = await copyPayloads(
    { url: sourceUrl, collection: sourceCollection },
    { url: qdrant.url, collection: COLLECTION },
    sourcePoints,
    log,
  );
  Object.assign(report, {
    sourcePoints,
    copied: copy.copied,
    copyMs: Math.round(performance.now() - copyStarted),
  });

  const store = new VectorStoreClient(
    { url: qdrant.url, collectionName: COLLECTION },
    1,
  );
  const before = await census(store);
  const missing = chooseMissing(before);
  const inventory = new Inventory(false);
  for (const paths of before.byRoot.values()) {
    for (const path of paths) if (!missing.has(path)) inventory.set(path);
  }
  Object.assign(report, {
    before: { ...before, byRoot: undefined },
    perRoot: [...before.byRoot].map(([root, paths]) => ({
      root,
      indexed: paths.length,
    })),
    missing: missing.size,
  });
  log(
    `census ${JSON.stringify(report.before)}; missing ${String(missing.size)}`,
  );

  // A first start: the system payload indexes do not exist yet.
  const firstStart = await timedRun(
    'no chunk_index index (list only)',
    store,
    inventory,
    missing,
    false,
  );
  await store.ensureCollection();
  await store.whenSystemIndexesSettled();
  await waitGreen(qdrant.url);
  const indexed = await timedRun(
    'chunk_index indexed (deletes)',
    store,
    inventory,
    missing,
    true,
  );
  const after = await census(store);
  const intact =
    after.chunk0Outside === before.chunk0Outside &&
    after.chunk0Sources === before.chunk0Sources &&
    after.chunk0UnderRoots === before.chunk0UnderRoots - missing.size;
  Object.assign(report, {
    runs: [firstStart, indexed],
    after: { ...after, byRoot: undefined },
    intact,
    finishedAt: new Date().toISOString(),
  });
  log(`after ${JSON.stringify(report.after)}; intact ${String(intact)}`);
  process.exitCode = intact ? 0 : 1;
} finally {
  await qdrant.stop();
  if (values.out) writeFileSync(values.out, JSON.stringify(report, null, 2));
}
