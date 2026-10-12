/**
 * @module api/executeReindex
 * Shared reindex execution logic used by both the reindex handler and the triggerReindex lambda: validates the scope, dispatches to the scope modules, tracks progress and fires the callback.
 */

import {
  type ReindexScope,
  reindexScopeSchema,
} from '@karmaniverous/jeeves-watcher-core';

import { normalizeError } from '../util/normalizeError';
import { reportReindexCompletion } from './reindexCallback';
import { filePlan, listScopeFiles, runFileScope } from './reindexFileScopes';
import { collectPathFiles } from './reindexPathFiles';
import type { ReindexPlan } from './reindexPlan';
import { executePrune } from './reindexPrune';
import type { ExecuteReindexDeps, ExecuteReindexResult } from './reindexTypes';

export type { ReindexScope };
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
 * Execute a reindex operation: process files, track progress, and fire callback if configured.
 *
 * @param deps - Dependencies.
 * @param scope - Reindex scope: 'issues', 'full', 'rules', 'path', or 'prune'.
 * @param path - Target path (required when scope is 'path').
 * @param dryRun - When true, compute and return the plan without executing.
 * @returns The reindex result including the blast area plan.
 */
export async function executeReindex(
  deps: ExecuteReindexDeps,
  scope: ReindexScope,
  path?: string | string[],
  dryRun: boolean = false,
): Promise<ExecuteReindexResult> {
  const { config, logger, reindexTracker, valuesManager } = deps;

  if (!VALID_REINDEX_SCOPES.includes(scope)) {
    throw new Error(
      `Invalid reindex scope: "${scope}". Valid scopes: ${VALID_REINDEX_SCOPES.join(', ')}`,
    );
  }

  const pathArray: string[] | undefined = path
    ? Array.isArray(path)
      ? path
      : [path]
    : undefined;

  if (scope === 'path' && (!pathArray || pathArray.length === 0)) {
    throw new Error('The "path" parameter is required when scope is "path".');
  }

  if (scope === 'prune') {
    if (!deps.vectorStore) {
      throw new Error('vectorStore is required for prune scope.');
    }
    return executePrune(deps, dryRun);
  }

  // Non-prune scopes: compute plan from file lists
  const fileList = await listScopeFiles(deps, scope, pathArray);
  let plan: ReindexPlan | undefined =
    fileList !== undefined ? filePlan(fileList, config) : undefined;

  if (dryRun) {
    // For path scope without pre-computed plan, compute it now
    if (plan === undefined && scope === 'path' && pathArray) {
      const pathFiles = await collectPathFiles(
        pathArray,
        config,
        deps.gitignoreFilter,
      );
      plan = filePlan(pathFiles, config);
    }
    return { filesProcessed: 0, durationMs: 0, errors: 0, plan };
  }

  reindexTracker?.start(scope);
  const startTime = Date.now();

  try {
    if (scope === 'full' && valuesManager) {
      valuesManager.clearAll();
    }

    const { filesProcessed, errors } = await runFileScope(
      deps,
      scope,
      pathArray,
      fileList,
      {
        onTotal: (total) => reindexTracker?.setTotal(total),
        onProcessed: () => reindexTracker?.incrementProcessed(),
        onPlan: (resolved) => {
          plan = resolved;
        },
      },
    );

    const durationMs = Date.now() - startTime;
    logger.info(
      { scope, filesProcessed, durationMs },
      `Reindex (${scope}) completed`,
    );

    reindexTracker?.complete();

    await reportReindexCompletion(
      config,
      { scope, filesProcessed, durationMs, errors: [] },
      logger,
    );

    return { filesProcessed, durationMs, errors, plan };
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
