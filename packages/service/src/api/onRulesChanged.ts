/**
 * @module api/onRulesChanged
 * Factory for the `onRulesChanged` callback used by virtual rule registration routes.
 *
 * Handles three concerns on rule change:
 * 1. Recompile merged (config + virtual) rules.
 * 2. Rebuild the template engine with the merged rule set.
 * 3. Extract match globs from virtual rules and trigger a scoped reindex.
 */

import { dirname } from 'node:path';

import type pino from 'pino';

import { buildTemplateEngineAndCustomMapLib } from '../app/initialization';
import type { JeevesWatcherConfig } from '../config/types';
import type { GitignoreFilter } from '../gitignore';
import type { IssuesManager } from '../issues';
import type { DocumentProcessorInterface } from '../processor';
import { compileRules } from '../rules';
import type { VirtualRuleStore } from '../rules/virtualRules';
import type { ValuesManager } from '../values';
import type { VectorStoreClient } from '../vectorStore';
import { executeReindex } from './executeReindex';
import type { ReindexTracker } from './ReindexTracker';

/** Dependencies for {@link createOnRulesChanged}. */
interface OnRulesChangedDeps {
  config: JeevesWatcherConfig;
  configPath: string;
  processor: DocumentProcessorInterface;
  logger: pino.Logger;
  virtualRuleStore: VirtualRuleStore;
  reindexTracker: ReindexTracker;
  valuesManager: ValuesManager;
  issuesManager: IssuesManager;
  gitignoreFilter?: GitignoreFilter;
  vectorStore: VectorStoreClient;
}

/**
 * Extract match globs from virtual rules.
 *
 * Walks each rule's `match.properties.file.properties.path.glob` and collects
 * any string values found.
 */
export function extractMatchGlobs(
  rules: Array<{
    match?:
      | {
          properties?: {
            file?: { properties?: { path?: { glob?: string } } };
          };
        }
      | undefined;
  }>,
): string[] {
  const globs: string[] = [];
  for (const rule of rules) {
    const glob = rule.match?.properties?.file?.properties?.path?.glob;
    if (typeof glob === 'string') {
      globs.push(glob);
    }
  }
  return globs;
}

/**
 * Create the `onRulesChanged` callback.
 *
 * @param deps - Dependencies injected from the API server factory.
 * @returns A zero-argument callback suitable for passing to rule registration handlers.
 */
export function createOnRulesChanged(deps: OnRulesChangedDeps): () => void {
  const {
    config,
    configPath,
    processor,
    logger,
    virtualRuleStore,
    reindexTracker,
    valuesManager,
    issuesManager,
    gitignoreFilter,
    vectorStore,
  } = deps;

  return () => {
    const configRules = config.inferenceRules ?? [];
    const virtualRulesBySource = virtualRuleStore.getAll();
    const allVirtualRules = Object.values(virtualRulesBySource).flat();
    const mergedRules = [...configRules, ...allVirtualRules];
    const configCompiled = compileRules(configRules);
    const virtualCompiled = virtualRuleStore.getCompiled();

    // Rebuild template engine asynchronously with merged rules
    void buildTemplateEngineAndCustomMapLib(
      { ...config, inferenceRules: mergedRules },
      dirname(configPath),
    ).then(({ templateEngine: newEngine, customMapLib: newMapLib }) => {
      processor.updateRules(
        [...configCompiled, ...virtualCompiled],
        newEngine,
        newMapLib,
      );
    });

    // Auto-trigger rules reindex scoped to newly registered rule globs (Fix 21)
    const matchGlobs = extractMatchGlobs(allVirtualRules);

    if (matchGlobs.length > 0) {
      void executeReindex(
        {
          config,
          processor,
          logger,
          reindexTracker,
          valuesManager,
          issuesManager,
          gitignoreFilter,
          vectorStore,
        },
        'rules',
        matchGlobs,
      );
    }
  };
}
