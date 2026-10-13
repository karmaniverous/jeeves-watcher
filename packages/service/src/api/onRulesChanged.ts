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

import { buildTemplateEngineAndCustomMapLib } from '../app/initialization';
import { compileRules } from '../rules';
import type { VirtualRuleStore } from '../rules/virtualRules';
import {
  executeReindex,
  reindexDepsFrom,
  type ReindexDepsSource,
} from './executeReindex';

/** Dependencies for {@link createOnRulesChanged}. */
type OnRulesChangedDeps = ReindexDepsSource & {
  /** Config file path (template helpers resolve against its directory). */
  configPath: string;
  /** Registered virtual rules. */
  virtualRuleStore: VirtualRuleStore;
};

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
  const { getConfig, configPath, processor, logger, virtualRuleStore } = deps;

  return () => {
    const config = getConfig();
    const configRules = config.inferenceRules ?? [];
    const virtualRulesBySource = virtualRuleStore.getAll();
    const allVirtualRules = Object.values(virtualRulesBySource).flat();
    const mergedRules = [...configRules, ...allVirtualRules];
    const configCompiled = compileRules(configRules);
    const virtualCompiled = virtualRuleStore.getCompiled();

    // Rebuild template engine asynchronously with merged rules
    buildTemplateEngineAndCustomMapLib(
      { ...config, inferenceRules: mergedRules },
      dirname(configPath),
    )
      .then(({ templateEngine: newEngine, customMapLib: newMapLib }) => {
        processor.updateRules(
          [...configCompiled, ...virtualCompiled],
          newEngine,
          newMapLib,
        );
      })
      .catch((err: unknown) => {
        logger.error(
          { err },
          'onRulesChanged: failed to rebuild template engine; processor rules not updated',
        );
      });

    // Auto-trigger rules reindex scoped to newly registered rule globs (Fix 21)
    const matchGlobs = extractMatchGlobs(allVirtualRules);

    if (matchGlobs.length > 0) {
      void executeReindex(reindexDepsFrom(deps), {
        scope: 'rules',
        path: matchGlobs,
      });
    }
  };
}
