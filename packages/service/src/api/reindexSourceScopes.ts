/**
 * @module api/reindexSourceScopes
 * Source side of reindex scopes `full`, `rules` and `issues`: discovers the scope's source documents, adds them to the plan per source name, and re-retrieves each through the notify queue (serialised and coalesced per reference). Qdrant and callback I/O.
 */

import type { ReindexScope } from '@karmaniverous/jeeves-watcher-core';
import { parallel } from 'radash';

import { hasSourceOperations } from '../processor/SourceOperations';
import type { SourceNotifyQueue } from '../queue/SourceNotifyQueue';
import { normalizeError } from '../util/normalizeError';
import type { ReindexPlan } from './reindexPlan';
import type { ExecuteReindexDeps, SourceReindexCounts } from './reindexTypes';
import { reindexConcurrency } from './reindexWork';
import {
  countBySourceName,
  discoverIndexedSources,
  discoverIssueSources,
  type SourceDiscovery,
} from './sourceDiscovery';

/** Source documents of one reindex run, bound to the queue that processes them. */
export interface SourceScope extends SourceDiscovery {
  /**
   * The notify queue: each document is processed with `processNow`, so it
   * never runs in parallel with a notification of the same reference and a
   * pending notification coalesces with it (the latest state wins).
   */
  queue: Pick<SourceNotifyQueue, 'processNow'>;
  /** Re-embed even when content is unchanged (scope `full`). */
  force: boolean;
}

/**
 * Resolve the source documents covered by a scope. Sources are covered only
 * when `deps.includeSources` is set (explicit `POST /reindex`; a
 * config-triggered reindex stays file-only, Decision 16.11) and the
 * processor, vector store and notify queue support them.
 *
 * - `full`: every indexed source document, forced re-embed.
 * - `rules` (no path filter): every indexed source document. Each is
 *   re-retrieved and its stored rule re-applied; when the rendered content
 *   hash is unchanged only payloads are updated (`setPayload`), and the
 *   document is re-embedded only if its content changed. Re-applying a rule
 *   that changes the rendered text necessarily changes the embedded text, so
 *   re-embedding then is the only way to keep vectors consistent.
 * - `issues`: source references present in the issues store, with their
 *   stored rule, or the rule recorded on the issue when the document has no
 *   points (its first notification failed).
 * - `rules` with a path filter, `path`, `prune`: none (file globs only;
 *   `path` with `source` goes through the notify queue).
 *
 * @param deps - Reindex dependencies.
 * @param scope - Reindex scope.
 * @param pathArray - Path/glob filter of the request, if any.
 * @returns The scope's source documents, or `undefined` when none apply.
 */
export async function resolveSourceScope(
  deps: ExecuteReindexDeps,
  scope: ReindexScope,
  pathArray: string[] | undefined,
): Promise<SourceScope | undefined> {
  const { processor, vectorStore, sourceQueue: queue } = deps;
  if (!deps.includeSources || !vectorStore || !queue) return undefined;
  if (!hasSourceOperations(processor)) return undefined;

  if (scope === 'full' || (scope === 'rules' && !pathArray?.length)) {
    const found = await discoverIndexedSources(vectorStore);
    return { ...found, queue, force: scope === 'full' };
  }
  if (scope === 'issues' && deps.issuesManager) {
    const issues = deps.issuesManager.getAll();
    const ops = processor.sourceOperations();
    const found = await discoverIssueSources(
      issues,
      ops,
      reindexConcurrency(deps.config),
    );
    return { ...found, queue, force: false };
  }
  return undefined;
}

/**
 * Add a scope's source documents to a file plan: `total` and `toProcess`
 * grow by the source counts and `byRoot` gains one entry per source name.
 *
 * @param plan - The file plan, if any.
 * @param sources - The scope's source documents, if any.
 * @returns The combined plan (unchanged when there are no sources).
 */
export function withSourcePlan(
  plan: ReindexPlan | undefined,
  sources: SourceDiscovery | undefined,
): ReindexPlan | undefined {
  if (!sources) return plan;
  const base = plan ?? { total: 0, toProcess: 0, toDelete: 0, byRoot: {} };
  const byRoot = { ...base.byRoot };
  for (const [name, count] of Object.entries(
    countBySourceName(sources.targets),
  )) {
    byRoot[name] = (byRoot[name] ?? 0) + count;
  }
  return {
    ...base,
    total: base.total + sources.total,
    toProcess: base.toProcess + sources.targets.length,
    byRoot,
  };
}

/** Options of {@link runSourceScope}. */
export interface RunSourceScopeOptions {
  /**
   * Documents submitted at once (`reindex.concurrency`); the notify queue's
   * concurrency and each source's own `concurrency` still cap the runs and
   * callbacks.
   */
  concurrency: number;
  /** Logger for unexpected failures. */
  logger: ExecuteReindexDeps['logger'];
  /** Called after each processed document. */
  onProcessed: () => void;
}

/** Outcome of {@link runSourceScope}. */
export interface SourceScopeOutcome {
  /** Per-status counts. */
  counts: SourceReindexCounts;
  /** References that failed (status `failed`, or the queue rejected). */
  failed: string[];
}

/**
 * Re-retrieve and index every source document of a scope with its
 * designated rule, through the notify queue. A 404 deletes the document's
 * points; any other failure is recorded as an issue and leaves its points
 * untouched, so a source outage can never empty the index. A stopped queue
 * (shutdown) counts the remaining documents as failed.
 *
 * @param scope - The scope's source documents.
 * @param options - Concurrency, logger and progress hook.
 * @returns Per-status counts and the failed references.
 */
export async function runSourceScope(
  scope: SourceScope,
  options: RunSourceScopeOptions,
): Promise<SourceScopeOutcome> {
  const counts: SourceReindexCounts = {
    indexed: 0,
    unchanged: 0,
    deleted: 0,
    failed: 0,
  };
  const failed: string[] = [];
  const { queue, force } = scope;
  await parallel(options.concurrency, scope.targets, async ({ ref, rule }) => {
    try {
      const result = await queue.processNow(ref, rule, { force });
      counts[result.status]++;
      if (result.status === 'failed') failed.push(ref);
    } catch (error) {
      // processSource reports its own failures; a stopped queue rejects.
      counts.failed++;
      failed.push(ref);
      options.logger.warn(
        { source: ref, err: normalizeError(error) },
        'Failed to reindex source document',
      );
    }
    options.onProcessed();
  });
  return { counts, failed };
}
