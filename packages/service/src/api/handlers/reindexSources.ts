/**
 * @module api/handlers/reindexSources
 * `POST /reindex { scope: 'path', source }`: re-notifies indexed source references with their stored designated rules through the notify queue (asynchronous, coalesced). Bounded-concurrency Qdrant reads only.
 */

import type { ReindexResponse } from '@karmaniverous/jeeves-watcher-core';

import type { SourceOperationsInterface } from '../../processor/SourceOperations';
import type { SourceNotifyQueue } from '../../queue/SourceNotifyQueue';
import { countBySourceName, resolveStoredRules } from '../sourceDiscovery';

/** Dependencies of {@link reindexSources}. */
export interface ReindexSourcesDeps {
  /** Source operations (stored designated rule lookup). */
  ops: Pick<SourceOperationsInterface, 'storedRule'>;
  /** Notify queue the references are enqueued on. */
  queue: Pick<SourceNotifyQueue, 'enqueue'>;
  /** Maximum stored-rule lookups (Qdrant reads) in flight (`reindex.concurrency`). */
  concurrency: number;
}

/**
 * Reindex source references. Each reference is re-processed with the rule
 * stored on its chunk-0 point (`source_rule`); references that are not
 * indexed have no known rule and are skipped (counted in `total`, not in
 * `toProcess`). Work goes through the notify queue, so it is coalesced with
 * concurrent notifications and failures land in `/issues`, as for notify.
 * Like notify, the work is not a tracked reindex run: `GET /status` reindex
 * progress does not cover it and no `reindex.callbackUrl` is sent.
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
  const stored = await resolveStoredRules(deps.ops, refs, deps.concurrency);
  const targets = stored.flatMap(({ ref, rule }) =>
    rule === null ? [] : [{ ref, rule }],
  );
  if (!dryRun) {
    for (const { ref, rule } of targets) deps.queue.enqueue(ref, rule);
  }
  const toProcess = targets.length;
  const byRoot = countBySourceName(targets);

  return {
    status: dryRun ? 'dry_run' : 'started',
    scope: 'path',
    plan: { total: refs.length, toProcess, toDelete: 0, byRoot },
  };
}
