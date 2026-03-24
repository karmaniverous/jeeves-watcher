/**
 * @module app/configReload
 * Config-reload orchestration extracted from JeevesWatcher to follow SRP.
 */

import type pino from 'pino';

import { executeReindex } from '../api/executeReindex';
import type { InitialScanTracker } from '../api/InitialScanTracker';
import type { ContentHashCache } from '../cache';
import type { JeevesWatcherConfig } from '../config/types';
import type { GitignoreFilter } from '../gitignore';
import type { IssuesManager } from '../issues';
import type { DocumentProcessorInterface } from '../processor';
import type { EventQueue } from '../queue';
import { normalizeError } from '../util/normalizeError';
import type { ValuesManager } from '../values';
import type { FileSystemWatcher } from '../watcher';
import type { JeevesWatcherFactories } from './factories';
import {
  buildTemplateEngineAndCustomMapLib,
  getConfigDir,
  rebuildWatcher,
  watchConfigChanged,
} from './initialization';

/** Mutable state held by JeevesWatcher that reload needs to read/write. */
interface ReloadableState {
  config: JeevesWatcherConfig;
  watcher?: FileSystemWatcher;
  gitignoreFilter?: GitignoreFilter;
}

/** Immutable dependencies needed by the reload function. */
interface ReloadDeps {
  configPath: string;
  factories: JeevesWatcherFactories;
  queue: EventQueue;
  processor: DocumentProcessorInterface;
  logger: pino.Logger;
  runtimeOptions: {
    maxRetries?: number;
    maxBackoffMs?: number;
    onFatalError?: (error: unknown) => void;
  };
  initialScanTracker: InitialScanTracker;
  contentHashCache?: ContentHashCache;
  valuesManager?: ValuesManager;
  issuesManager?: IssuesManager;
}

/**
 * Reload config, update rules/templates, optionally rebuild watcher, and trigger reindex.
 * Mutates `state.config`, `state.watcher`, and `state.gitignoreFilter` in place.
 */
export async function reloadConfig(
  state: ReloadableState,
  deps: ReloadDeps,
): Promise<void> {
  const { logger, processor, configPath } = deps;

  logger.info({ configPath }, 'Config change detected, reloading...');

  try {
    const oldConfig = state.config;
    const newConfig = await deps.factories.loadConfig(configPath);
    state.config = newConfig;

    const compiledRules = deps.factories.compileRules(
      newConfig.inferenceRules ?? [],
    );

    const reloadConfigDir = getConfigDir(configPath);
    const { templateEngine: newTemplateEngine, customMapLib: newCustomMapLib } =
      await buildTemplateEngineAndCustomMapLib(newConfig, reloadConfigDir);

    processor.updateRules(compiledRules, newTemplateEngine, newCustomMapLib);

    logger.info({ configPath, rules: compiledRules.length }, 'Config reloaded');

    // Rebuild filesystem watcher if watch config changed
    if (watchConfigChanged(oldConfig, newConfig)) {
      logger.info('Watch config changed, rebuilding filesystem watcher...');
      const newState = await rebuildWatcher(
        newConfig,
        deps.factories,
        deps.queue,
        processor,
        logger,
        deps.runtimeOptions,
        { watcher: state.watcher!, gitignoreFilter: state.gitignoreFilter },
        deps.initialScanTracker,
        deps.contentHashCache,
      );
      state.watcher = newState.watcher;
      state.gitignoreFilter = newState.gitignoreFilter;
    }

    // Trigger reindex based on configWatch.reindex setting
    const reindexScope = newConfig.configWatch?.reindex ?? 'issues';
    logger.info(
      { scope: reindexScope },
      `Config watch triggering ${reindexScope} reindex`,
    );

    await executeReindex(
      {
        config: newConfig,
        processor,
        logger,
        valuesManager: deps.valuesManager,
        issuesManager: deps.issuesManager,
        gitignoreFilter: state.gitignoreFilter,
      },
      reindexScope,
    );
  } catch (error) {
    logger.error({ err: normalizeError(error) }, 'Failed to reload config');
  }
}
