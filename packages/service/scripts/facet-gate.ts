/**
 * @module scripts/facet-gate
 * The facet latency gate (spec D104, D144, D155, D160, D194): a payload-only, production-sized copy of a source collection on a throwaway Qdrant, the configured and system payload indexes built through the real `VectorStoreClient`, the accuracy of approximate counts against exact counts for every workload field (same count filter, up to 1000 values), and three workloads timed through the real `POST /search/facets/counts` route over HTTP. Exits 1 when any p95 is over its ceiling, any request fails, or approximate counts miss a top-10 value or are off by more than 5% on one. The source is only read (GET and scroll).
 *
 * Usage: `npm run facet:gate -w packages/service -- --source-collection <name> [--source-url http://127.0.0.1:6333] [--floor 864000] [--tenant-field silo] [--warmup 5] [--runs 60] [--quiet-cpu 100] [--out result.json]`
 */

import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';

import {
  COUNT_FACETS_MAX_LIMIT,
  SYSTEM_PAYLOAD_INDEX_FIELDS,
} from '@karmaniverous/jeeves-watcher-core';
import Fastify from 'fastify';
import pino from 'pino';

import { createCatalogCountFacetsHandler } from '../src/api/catalog/countFacetsHandler';
import { countFilter } from '../src/api/catalog/countFacetsPlan';
import type { JeevesWatcherConfig } from '../src/config/types';
import { registerCatalogEntries } from '../src/test/catalogRoutes';
import { provisionEphemeralQdrant } from '../src/test/qdrant/ephemeralQdrant';
import { VectorStoreClient } from '../src/vectorStore';
import {
  compareCounts,
  type CountHit,
  type FieldAccuracy,
  withinBound,
} from './facetGate/accuracy';
import { copyPayloads, sourcePointCount } from './facetGate/copy';
import {
  cpuBusyPercent,
  gateWorkloads,
  parseGateArgs,
  pickFacetFields,
  summarize,
} from './facetGate/stats';

const log = (message: string) => {
  console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);
};

const COLLECTION = 'facet_gate';
const CHUNK0 = { must: [{ key: 'chunk_index', match: { value: 0 } }] };

/** Wait until the collection's optimizers are idle (status green). */
async function waitGreen(url: string): Promise<void> {
  for (;;) {
    const res = await fetch(`${url}/collections/${COLLECTION}`);
    const { result } = (await res.json()) as { result: { status: string } };
    if (result.status === 'green') return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

/** Qdrant facet counts over the REST API, exact or approximate. */
async function rawFacet(
  url: string,
  field: string,
  filter: Record<string, unknown>,
  exact: boolean,
): Promise<CountHit[]> {
  const res = await fetch(`${url}/collections/${COLLECTION}/facet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      key: field,
      filter,
      limit: COUNT_FACETS_MAX_LIMIT,
      exact,
    }),
  });
  if (!res.ok) throw new Error(`facet ${field}: ${String(res.status)}`);
  const { result } = (await res.json()) as { result: { hits: CountHit[] } };
  return result.hits;
}

/**
 * Wait until a 10 s sample shows host CPU at or below `maxPercent` (at most
 * 30 min).
 *
 * @returns The last sample, percent.
 */
async function waitQuiet(maxPercent: number): Promise<number | null> {
  const deadline = Date.now() + 30 * 60_000;
  for (;;) {
    const before = cpus();
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    const busy = cpuBusyPercent(before, cpus());
    if (busy === null || busy <= maxPercent || Date.now() > deadline) {
      return busy;
    }
    log(`host CPU ${String(busy)}% > ${String(maxPercent)}%; waiting`);
  }
}

const options = parseGateArgs(process.argv.slice(2));
const { qdrant, failures } = await provisionEphemeralQdrant();
if (!qdrant) throw new Error(`No throwaway Qdrant: ${failures.join('; ')}`);
const app = Fastify();
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  source: `${options.sourceUrl}/${options.sourceCollection}`,
};
try {
  const sourcePoints = await sourcePointCount({
    url: options.sourceUrl,
    collection: options.sourceCollection,
  });
  const size = Math.max(options.floor, sourcePoints);
  log(`source ${String(sourcePoints)} points; copy ${String(size)}`);
  const copy = await copyPayloads(
    { url: options.sourceUrl, collection: options.sourceCollection },
    { url: qdrant.url, collection: COLLECTION },
    size,
    log,
  );
  const fields = pickFacetFields(copy.keyCounts, 20);
  Object.assign(report, {
    sourcePoints,
    ...copy,
    keyCounts: undefined,
    fields,
  });

  // Configured keyword indexes (the tenant field as tenant); system indexes
  // (chunk_index, file_path, matched_rules) come from the real startup path.
  const store = new VectorStoreClient(
    {
      url: qdrant.url,
      collectionName: COLLECTION,
      payloadIndexes: fields
        .filter(
          (f) =>
            f !== 'matched_rules' &&
            !(SYSTEM_PAYLOAD_INDEX_FIELDS as readonly string[]).includes(f),
        )
        .map((field) => ({
          field,
          type: 'keyword' as const,
          ...(field === options.tenantField ? { isTenant: true } : {}),
        })),
    },
    1,
  );
  await store.ensureCollection();
  await store.whenSystemIndexesSettled();
  await waitGreen(qdrant.url);
  log(`indexes ${JSON.stringify(store.systemIndexStates())}`);

  const read = (field: string) => ({ field, filter: CHUNK0, timeoutS: 60 });
  const tenant = String(
    (await store.facets.facetCounts(read(options.tenantField), 1))[0]?.value,
  );
  const rules = (await store.facets.facetCounts(read('matched_rules'), 20))
    .map((h) => String(h.value))
    .filter((v) => !v.startsWith('frontmatter-'))
    .slice(0, 2);
  Object.assign(report, { tenant, rules });

  await registerCatalogEntries(app, {
    countFacets: createCatalogCountFacetsHandler({
      getConfig: () =>
        ({
          inferenceRules: rules.map((name) => ({ name, match: {} })),
        }) as unknown as JeevesWatcherConfig,
      configDir: '.',
      facetStore: store.facets,
      logger: pino({ level: 'warn' }),
    }),
  });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const workloads = gateWorkloads(fields, options.tenantField, tenant, rules);

  // Accuracy (D194): approximate against exact counts over each workload's
  // count filter, before timing.
  const accuracy: Array<{ workload: string; fields: FieldAccuracy[] }> = [];
  for (const workload of workloads) {
    const body = workload.body as {
      fields: string[];
      filter?: Record<string, unknown>;
      rules?: string[];
    };
    const filter = countFilter(body.filter, body.rules);
    const perField: FieldAccuracy[] = [];
    for (const field of body.fields) {
      const exact = await rawFacet(qdrant.url, field, filter, true);
      const approx = await rawFacet(qdrant.url, field, filter, false);
      perField.push(compareCounts(field, exact, approx));
    }
    accuracy.push({ workload: workload.name, fields: perField });
    const worst = Math.max(...perField.map((f) => f.topMaxRelError));
    const missing = perField.reduce((n, f) => n + f.topMissing.length, 0);
    log(
      `${workload.name} accuracy: worst top-10 relative error ${(worst * 100).toFixed(2)}%, top-10 values missing ${String(missing)}`,
    );
  }
  const accurate = accuracy.every((a) => withinBound(a.fields));
  Object.assign(report, { accuracy, accurate });

  const quietCpuAtStart =
    options.quietCpu < 100 ? await waitQuiet(options.quietCpu) : null;
  Object.assign(report, { quietCpu: options.quietCpu, quietCpuAtStart });

  const results = [];
  for (const workload of workloads) {
    const samples: number[] = [];
    const errors: string[] = [];
    const cpuBefore = cpus();
    for (let i = 0; i < options.warmup + options.runs; i++) {
      const started = performance.now();
      const res = await fetch(`${base}/search/facets/counts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(workload.body),
      });
      const text = await res.text();
      const ms = performance.now() - started;
      if (i < options.warmup) continue;
      samples.push(ms);
      if (!res.ok) errors.push(`${String(res.status)} ${text.slice(0, 200)}`);
    }
    const hostCpuPercent = cpuBusyPercent(cpuBefore, cpus());
    const summary = summarize(samples);
    const pass = errors.length === 0 && summary.p95 <= workload.p95Max;
    results.push({
      ...workload,
      ...summary,
      hostCpuPercent,
      errors: errors.length,
      pass,
    });
    log(
      `${workload.name}: p50 ${String(summary.p50)} p95 ${String(summary.p95)} max ${String(summary.max)} ms (ceiling ${String(workload.p95Max)}) errors ${String(errors.length)} host CPU ${String(hostCpuPercent)}% ${pass ? 'PASS' : 'FAIL'}${errors[0] ? ` first error: ${errors[0]}` : ''}`,
    );
  }
  const passed = accurate && results.every((r) => r.pass);
  process.exitCode = passed ? 0 : 1;
  Object.assign(report, {
    results,
    passed,
    finishedAt: new Date().toISOString(),
  });
} finally {
  await app.close();
  await qdrant.stop();
  if (options.out) writeFileSync(options.out, JSON.stringify(report, null, 2));
}
