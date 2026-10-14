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
import { runSourceScope, type SourceScopeOutcome } from './reindexSourceScopes';
import type {
  ExecuteReindexDeps,
  ExecuteReindexResult,
  ReindexDepsSource,
} from './reindexTypes';
import { reindexConcurrency } from './reindexWork';

export type { ReindexScope };
export { type PreparedReindex, prepareReindex } from './reindexPrepare';
export type { ExecuteReindexDeps, ReindexDepsSource } from './reindexTypes';

/**
 * Snapshot long-lived deps for one run: reads the config once and copies
 * exactly the {@link ExecuteReindexDeps} fields, so callers holding a wider
 * deps object (routes, triggers) never re-list them.
 *
 * @param source - Long-lived deps (any superset of {@link ReindexDepsSource}).
 * @param includeSources - Cover source documents (explicit `POST /reindex`
 *   only; config-triggered runs stay file-only, Decision 16.11).
 * @returns Deps for {@link executeReindex}.
 */
export function reindexDepsFrom(
  source: ReindexDepsSource,
  includeSources = false,
): ExecuteReindexDeps {
  return {
    config: source.getConfig(),
    processor: source.processor,
    logger: source.logger,
    reindexTracker: source.reindexTracker,
    valuesManager: source.valuesManager,
    issuesManager: source.issuesManager,
    gitignoreFilter: source.gitignoreFilter,
    vectorStore: source.vectorStore,
    queue: source.queue,
    sourceQueue: source.sourceQueue,
    ...(includeSources ? { includeSources } : {}),
  };
}

/** What to reindex: the request half of {@link executeReindex}. */
export interface ReindexOptions {
  /** Reindex scope. */
  scope: ReindexScope;
  /** Target path(s); required when `scope` is `path`. */
  path?: string | string[];
  /** Compute and return the plan without executing. */
  dryRun?: boolean;
  /** Targets already resolved for this request (non-prune). */
  prepared?: PreparedReindex;
}

/**
 * Execute a reindex operation: process files (then, when
 * `deps.includeSources` is set, source documents), track progress, and fire
 * the callback if configured.
 *
 * A live run resolves its targets ({@link prepareReindex}) inside its own
 * error handling, so a failure there fails the run (reported to the
 * callback) instead of escaping a fire-and-forget call; a caller that has
 * already prepared the run (to answer with its plan) passes `prepared`, so
 * files are not listed and sources not scrolled twice.
 *
 * Failed files and failed source references do not stop the run: `errors`
 * counts them and the callback body's `errors` lists them (file paths, then
 * source references). A run that fails as a whole reports its error message
 * instead.
 *
 * @param deps - Dependencies.
 * @param options - Scope, target path(s), dry-run flag, prepared targets.
 * @returns The reindex result including the blast area plan.
 * @throws When the scope is invalid, `path` scope has no targets, or a
 *   prune has no vector store (programming errors: every caller validates
 *   these first).
 */
export async function executeReindex(
  deps: ExecuteReindexDeps,
  options: ReindexOptions,
): Promise<ExecuteReindexResult> {
  const { scope, path, dryRun = false, prepared } = options;
  const { config, logger, reindexTracker, valuesManager } = deps;

  if (!reindexScopeSchema.safeParse(scope).success) {
    throw new Error(
      `Invalid reindex scope: "${scope}". Valid scopes: ${reindexScopeSchema.options.join(', ')}`,
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
  let plan: ReindexPlan | undefined = prepared?.plan;

  try {
    // Resolved inside the try: a file-listing or Qdrant failure fails this
    // run, never escapes as an unhandled rejection of a fire-and-forget
    // reindex.
    const targets = prepared ?? (await prepareReindex(deps, scope, path));
    const { fileList, sources } = targets;
    plan = targets.plan;
    if (scope === 'full' && valuesManager) {
      valuesManager.clearAll();
    }

    const onProcessed = () => reindexTracker?.incrementProcessed();
    reindexTracker?.setTotal(fileList.length + (sources?.targets.length ?? 0));

    const files = await runFileScope(deps, scope, fileList, onProcessed);

    let sourceOutcome: SourceScopeOutcome | undefined;
    if (sources) {
      sourceOutcome = await runSourceScope(sources, {
        concurrency: reindexConcurrency(config),
        logger,
        onProcessed,
      });
    }
    const sourceCounts = sourceOutcome?.counts;
    const failed = [...files.failed, ...(sourceOutcome?.failed ?? [])];
    const { filesProcessed } = files;

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
        errors: failed,
        ...(sourceCounts ? { sources: sourceCounts } : {}),
      },
      logger,
    );

    return {
      filesProcessed,
      durationMs,
      errors: failed.length,
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
