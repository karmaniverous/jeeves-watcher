/**
 * @module app/configReload
 * Config-reload orchestration extracted from JeevesWatcher to follow SRP.
 */

import type { ReindexScope } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import {
  executeReindex,
  reindexDepsFrom,
  type ReindexDepsSource,
} from '../api/executeReindex';
import type { JeevesWatcherConfig } from '../config/types';
import type { GitignoreFilter } from '../gitignore';
import type { IssuesManager } from '../issues';
import type { WatcherProcessor } from '../processor';
import type { EventQueue } from '../queue';
import { normalizeError } from '../util/normalizeError';
import type { ValuesManager } from '../values';
import type { FileSystemWatcher } from '../watcher';
import type { JeevesWatcherFactories } from './factories';
import {
  buildTemplateEngineAndCustomMapLib,
  getConfigDir,
} from './initialization';
import {
  rebuildWatcher,
  watchConfigChanged,
  type WatcherWiring,
} from './watcherFactory';

/** Mutable state held by JeevesWatcher that reload needs to read/write. */
interface ReloadableState {
  config: JeevesWatcherConfig;
  watcher?: FileSystemWatcher;
  gitignoreFilter?: GitignoreFilter;
}

/** Immutable dependencies needed by the reload function. */
interface ReloadDeps {
  /** The app's watcher wiring, passed whole to a rebuilt watcher. */
  wiring: WatcherWiring;
  /**
   * Publish the loaded config to the app before the watcher is rebuilt or
   * its reconcile schedule refreshed, so the wiring's getters
   * (`getReconcileIntervalMs`) read the new values.
   */
  onConfigLoaded?: (config: JeevesWatcherConfig) => void;
  configPath: string;
  factories: JeevesWatcherFactories;
  queue: EventQueue;
  processor: WatcherProcessor;
  logger: pino.Logger;
  runtimeOptions: {
    maxRetries?: number;
    maxBackoffMs?: number;
    onFatalError?: (error: unknown) => void;
  };
  valuesManager?: ValuesManager;
  issuesManager?: IssuesManager;
}

/**
 * Run the config-triggered reindex (`configWatch.reindex`): file-only, like
 * every config-triggered reindex (Decision 16.11).
 *
 * @param deps - Live config, processor, logger and stores.
 * @param scope - The scope.
 */
export async function runConfigReindex(
  deps: ReindexDepsSource,
  scope: ReindexScope,
): Promise<void> {
  deps.logger.info({ scope }, `Config watch triggering ${scope} reindex`);
  await executeReindex(reindexDepsFrom(deps), { scope });
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
    const newConfig = await deps.factories.loadConfig(configPath, {
      onWarning: (warning) => {
        logger.warn({ path: warning.path }, warning.message);
      },
    });
    state.config = newConfig;
    deps.onConfigLoaded?.(newConfig);

    const compiledRules = deps.factories.compileRules(
      newConfig.inferenceRules ?? [],
    );

    const reloadConfigDir = getConfigDir(configPath);
    const { templateEngine: newTemplateEngine, customMapLib: newCustomMapLib } =
      await buildTemplateEngineAndCustomMapLib(newConfig, reloadConfigDir);

    processor.updateRules(compiledRules, newTemplateEngine, newCustomMapLib);

    logger.info({ configPath, rules: compiledRules.length }, 'Config reloaded');

    const reindexScope = newConfig.configWatch?.reindex ?? 'issues';

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
        deps.wiring,
        reindexScope,
      );
      if (newState.restarting) {
        // D196: the process exits for a restart; the restarted process
        // runs the reindex with the new config.
        logger.info(
          { scope: reindexScope },
          'Config watch reindex deferred to the restart',
        );
        return;
      }
      state.watcher = newState.watcher;
      state.gitignoreFilter = newState.gitignoreFilter;
    } else {
      // watch.reconcileIntervalMs takes effect without a rebuild (D111);
      // the schedule restarts only when the effective interval changed.
      state.watcher?.refreshReconcileSchedule();
    }

    await runConfigReindex(
      {
        getConfig: () => newConfig,
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
