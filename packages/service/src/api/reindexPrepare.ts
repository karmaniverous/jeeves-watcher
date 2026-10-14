/**
 * @module api/reindexPrepare
 * Resolves what a non-prune reindex covers before it runs: the scope's files, its source documents and the combined plan. Computed once per request and reused by the live run (no second glob or Qdrant scroll). fs and Qdrant reads.
 */

import type { ReindexScope } from '@karmaniverous/jeeves-watcher-core';

import { filePlan, listScopeFiles } from './reindexFileScopes';
import type { ReindexPlan } from './reindexPlan';
import {
  resolveSourceScope,
  type SourceScope,
  withSourcePlan,
} from './reindexSourceScopes';
import type { ExecuteReindexDeps } from './reindexTypes';

/** The resolved targets of a non-prune reindex. */
export interface PreparedReindex {
  /** Files and source documents the run covers (the response `plan`). */
  plan: ReindexPlan | undefined;
  /** The scope's files (see `listScopeFiles`). */
  fileList: string[];
  /** The scope's source documents, when sources are covered. */
  sources: SourceScope | undefined;
}

/**
 * Normalise a reindex `path` argument to a list (undefined when absent).
 * Pure.
 *
 * @param path - One path, a list, or undefined.
 * @returns The paths as a list, or undefined.
 */
export function toPathArray(
  path: string | string[] | undefined,
): string[] | undefined {
  if (path === undefined) return undefined;
  return Array.isArray(path) ? path : [path];
}

/**
 * Resolve a non-prune reindex: list the scope's files, discover its source
 * documents and build the plan.
 *
 * @param deps - Reindex dependencies.
 * @param scope - Reindex scope (not `prune`).
 * @param path - Target paths/globs (`path` and `rules` scopes).
 * @returns Files, source documents and plan.
 * @throws `RequestError` for an invalid `path` target (see
 *   `collectPathFiles`); vector store errors propagate.
 */
export async function prepareReindex(
  deps: ExecuteReindexDeps,
  scope: ReindexScope,
  path?: string | string[],
): Promise<PreparedReindex> {
  const pathArray = toPathArray(path);
  const fileList = await listScopeFiles(deps, scope, pathArray);
  const sources = await resolveSourceScope(deps, scope, pathArray);
  const plan = withSourcePlan(filePlan(fileList, deps.config), sources);
  return { plan, fileList, sources };
}
