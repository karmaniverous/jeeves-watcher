/**
 * @module api/handlers/reindexSources
 * `POST /reindex { scope: 'path', source }`: re-notifies indexed source references with their stored designated rules through the notify queue (asynchronous, coalesced). Bounded-concurrency Qdrant reads only.
 */

import type { ReindexResponse } from '@karmaniverous/jeeves-watcher-core';
import { parallel } from 'radash';

import type { SourceOperationsInterface } from '../../processor/SourceOperations';
import type { SourceNotifyQueue } from '../../queue/SourceNotifyQueue';
import { parseSourceReference } from '../../sources';

/** Stored-rule lookups run at once when `concurrency` is not given. */
const DEFAULT_LOOKUP_CONCURRENCY = 16;

/** Dependencies of {@link reindexSources}. */
export interface ReindexSourcesDeps {
  /** Source operations (stored designated rule lookup). */
  ops: Pick<SourceOperationsInterface, 'storedRule'>;
  /** Notify queue the references are enqueued on. */
  queue: Pick<SourceNotifyQueue, 'enqueue'>;
  /**
   * Maximum stored-rule lookups (Qdrant reads) in flight
   * (`reindex.concurrency`; default 16).
   */
  concurrency?: number;
}

/**
 * Reindex source references. Each reference is re-processed with the rule
 * stored on its chunk-0 point (`source_rule`); references that are not
 * indexed have no known rule and are skipped (counted in `total`, not in
 * `toProcess`). Work goes through the notify queue, so it is coalesced with
 * concurrent notifications and failures land in `/issues`, as for notify.
 * The request schema caps the list (`MAX_REINDEX_SOURCES_PER_REQUEST`); the
 * lookups run with bounded concurrency.
 *
 * Plan: `total` = distinct references, `toProcess` = indexed ones,
 * `toDelete` = 0, `byRoot` = `toProcess` grouped by source name.
 *
 * @param deps - Source operations, the notify queue and lookup concurrency.
 * @param sources - References (already schema-validated).
 * @param dryRun - Compute the plan without enqueueing.
 * @returns The reindex response body.
 */
export async function reindexSources(
  deps: ReindexSourcesDeps,
  sources: string[],
  dryRun: boolean,
): Promise<ReindexResponse> {
  const refs = [...new Set(sources)];
  const concurrency = Math.max(
    1,
    deps.concurrency ?? DEFAULT_LOOKUP_CONCURRENCY,
  );
  const found = await parallel(concurrency, refs, async (ref) => ({
    ref,
    rule: await deps.ops.storedRule(ref),
  }));
  const rules = new Map(found.map(({ ref, rule }) => [ref, rule]));

  const byRoot: Record<string, number> = {};
  let toProcess = 0;
  for (const ref of refs) {
    const rule = rules.get(ref);
    if (rule === null || rule === undefined) continue;
    toProcess++;
    const { name } = parseSourceReference(ref);
    byRoot[name] = (byRoot[name] ?? 0) + 1;
    if (!dryRun) deps.queue.enqueue(ref, rule);
  }

  return {
    status: dryRun ? 'dry_run' : 'started',
    scope: 'path',
    plan: { total: refs.length, toProcess, toDelete: 0, byRoot },
  };
}
