/**
 * @module api/reindexPrune
 * Reindex scope `prune`: pauses the file queue, computes the prune plan, and (unless dry-run or incomplete) deletes orphaned points in batches. Qdrant I/O.
 */

import { normalizeError } from '../util/normalizeError';
import { computePrunePlan } from './prunePlan';
import { reportReindexCompletion } from './reindexCallback';
import type { ExecuteReindexDeps, ExecuteReindexResult } from './reindexTypes';

/** Maximum point IDs per delete request. */
const PRUNE_DELETE_BATCH_SIZE = 500;

/**
 * Execute (or plan) a prune. The file queue is paused for the whole
 * operation and always resumed. A live prune whose scroll was incomplete is
 * aborted: partial deletes are never performed.
 *
 * @param deps - Reindex dependencies (`vectorStore` required).
 * @param dryRun - Compute and return the plan without deleting.
 * @returns The reindex result including the plan.
 */
export async function executePrune(
  deps: ExecuteReindexDeps,
  dryRun: boolean,
): Promise<ExecuteReindexResult> {
  const { config, logger, reindexTracker } = deps;
  const scope = 'prune';

  deps.queue?.pause();
  await deps.queue?.waitForIdleWorkers();
  let pruneResult;
  try {
    pruneResult = await computePrunePlan(deps);
  } catch (err) {
    deps.queue?.resume();
    throw err;
  }
  const { plan } = pruneResult;

  if (dryRun) {
    deps.queue?.resume();
    return { filesProcessed: 0, durationMs: 0, errors: 0, plan };
  }

  // Abort live prune when plan is incomplete — never silently delete partial data
  if (plan.incomplete) {
    deps.queue?.resume();
    logger.error(
      { totalPoints: plan.total, pointsToDelete: plan.toDelete },
      'Aborting live prune — scroll was incomplete; partial deletes are unsafe',
    );
    return { filesProcessed: 0, durationMs: 0, errors: 1, plan };
  }

  // Execute prune
  reindexTracker?.start(scope);
  const startTime = Date.now();

  try {
    const { orphanedIds } = pruneResult;
    for (let i = 0; i < orphanedIds.length; i += PRUNE_DELETE_BATCH_SIZE) {
      const batch = orphanedIds.slice(i, i + PRUNE_DELETE_BATCH_SIZE);
      await deps.vectorStore!.delete(batch);
    }

    const durationMs = Date.now() - startTime;
    logger.info(
      { scope, pointsDeleted: orphanedIds.length, durationMs },
      `Reindex (prune) completed`,
    );

    reindexTracker?.complete();

    await reportReindexCompletion(
      config,
      {
        scope,
        filesProcessed: 0,
        durationMs,
        pointsDeleted: orphanedIds.length,
        errors: [],
      },
      logger,
    );

    return { filesProcessed: 0, durationMs, errors: 0, plan };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error({ err: normalizeError(error), scope }, 'Prune failed');
    reindexTracker?.complete();

    await reportReindexCompletion(
      config,
      {
        scope,
        filesProcessed: 0,
        durationMs,
        errors: [normalizeError(error).message],
      },
      logger,
    );

    return { filesProcessed: 0, durationMs, errors: 1, plan };
  } finally {
    deps.queue?.resume();
  }
}
