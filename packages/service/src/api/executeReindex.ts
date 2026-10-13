/**
 * @module api/executeReindex
 * Shared reindex execution logic used by both the reindex handler and the triggerReindex lambda: validates the scope, dispatches to the file, source and prune scope modules, tracks progress and fires the callback.
 */

import {
  type ReindexScope,
  reindexScopeSchema,
} from '@karmaniverous/jeeves-watcher-core';

import { normalizeError } from '../util/normalizeError';
import { reportReindexCompletion } from './reindexCallback';
import { runFileScope } from './reindexFileScopes';
import type { ReindexPlan } from './reindexPlan';
import {
  type PreparedReindex,
  prepareReindex,
  toPathArray,
} from './reindexPrepare';
import { executePrune } from './reindexPrune';
import { runSourceScope } from './reindexSourceScopes';
import type {
  ExecuteReindexDeps,
  ExecuteReindexResult,
  SourceReindexCounts,
} from './reindexTypes';

export type { ReindexScope };
export { type PreparedReindex, prepareReindex } from './reindexPrepare';
export type { ExecuteReindexDeps } from './reindexTypes';

/** Ordered list of valid reindex scopes (from the core request schema). */
export const VALID_REINDEX_SCOPES: readonly ReindexScope[] =
  reindexScopeSchema.options;

/**
 * Valid scopes for config-watch auto-trigger.
 * `prune` is excluded - auto-pruning on config change is dangerous.
 */
export const CONFIG_WATCH_VALID_SCOPES: readonly ReindexScope[] = [
  'issues',
  'full',
  'rules',
] as const;

/**
 * Execute a reindex operation: process files (then, when
 * `deps.includeSources` is set, source documents), track progress, and fire
 * callback if configured.
 *
 * @param deps - Dependencies.
 * @param scope - Reindex scope: 'issues', 'full', 'rules', 'path', or 'prune'.
 * A live run resolves its targets ({@link prepareReindex}) inside its own
 * error handling, so a failure there fails the run (reported to the
 * callback) instead of escaping a fire-and-forget call; a caller that has
 * already prepared the run (to answer with its plan) passes `prepared`, so
 * files are not listed and sources not scrolled twice.
 *
 * @param deps - Dependencies.
 * @param scope - Reindex scope: 'issues', 'full', 'rules', 'path', or 'prune'.
 * @param path - Target path (required when scope is 'path').
 * @param dryRun - When true, compute and return the plan without executing.
 * @param prepared - Targets already resolved for this request (non-prune).
 * @returns The reindex result including the blast area plan.
 */
export async function executeReindex(
  deps: ExecuteReindexDeps,
  scope: ReindexScope,
  path?: string | string[],
  dryRun: boolean = false,
  prepared?: PreparedReindex,
): Promise<ExecuteReindexResult> {
  const { config, logger, reindexTracker, valuesManager } = deps;

  if (!VALID_REINDEX_SCOPES.includes(scope)) {
    throw new Error(
      `Invalid reindex scope: "${scope}". Valid scopes: ${VALID_REINDEX_SCOPES.join(', ')}`,
    );
  }

  const pathArray = toPathArray(path);

  if (scope === 'path' && (!pathArray || pathArray.length === 0)) {
    throw new Error('The "path" parameter is required when scope is "path".');
  }

  if (scope === 'prune') {
    if (!deps.vectorStore) {
      throw new Error('vectorStore is required for prune scope.');
    }
    return executePrune(deps, dryRun);
  }

  if (dryRun) {
    const { plan } = prepared ?? (await prepareReindex(deps, scope, path));
    return { filesProcessed: 0, durationMs: 0, errors: 0, plan };
  }

  reindexTracker?.start(scope);
  const startTime = Date.now();
  let fileTotal: number | undefined;
  let plan: ReindexPlan | undefined = prepared?.plan;

  try {
    // Resolved inside the try: a file-listing or Qdrant failure fails this
    // run, never escapes as an unhandled rejection of a fire-and-forget
    // reindex.
    const targets = prepared ?? (await prepareReindex(deps, scope, path));
    const { fileList, sources } = targets;
    plan = targets.plan;
    const sourceTotal = sources?.targets.length ?? 0;
    if (scope === 'full' && valuesManager) {
      valuesManager.clearAll();
    }

    const { filesProcessed, errors } = await runFileScope(
      deps,
      scope,
      fileList,
      {
        onTotal: (total) => {
          fileTotal = total;
          reindexTracker?.setTotal(total + sourceTotal);
        },
        onProcessed: () => reindexTracker?.incrementProcessed(),
      },
    );

    let sourceCounts: SourceReindexCounts | undefined;
    if (sources) {
      reindexTracker?.setTotal((fileTotal ?? filesProcessed) + sourceTotal);
      sourceCounts = await runSourceScope(sources, {
        concurrency: config.reindex?.concurrency ?? 50,
        logger,
        onProcessed: () => reindexTracker?.incrementProcessed(),
      });
    }

    const durationMs = Date.now() - startTime;
    logger.info(
      { scope, filesProcessed, sources: sourceCounts, durationMs },
      `Reindex (${scope}) completed`,
    );

    reindexTracker?.complete();

    await reportReindexCompletion(
      config,
      {
        scope,
        filesProcessed,
        durationMs,
        errors: [],
        ...(sourceCounts ? { sources: sourceCounts } : {}),
      },
      logger,
    );

    return {
      filesProcessed,
      durationMs,
      errors: errors + (sourceCounts?.failed ?? 0),
      plan,
      ...(sourceCounts ? { sources: sourceCounts } : {}),
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error({ err: normalizeError(error), scope }, 'Reindex failed');

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
  }
}
