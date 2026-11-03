/**
 * @module api/configApplyCallback
 * Builds the callback `POST /config/apply` runs after writing the config: it triggers the configured auto-reindex (`configWatch.reindex`).
 */

import type { JeevesWatcherConfig } from '../config/types';
import type { ApiServerOptions } from './apiServerOptions';
import { executeReindex, reindexDepsFrom } from './executeReindex';
import type { ReindexTracker } from './ReindexTracker';

/** What the config-apply callback needs beyond the server options. */
export interface ConfigApplyCallbackContext {
  /** Live config getter. */
  getConfig: () => JeevesWatcherConfig;
  /** Shared reindex progress tracker. */
  reindexTracker: ReindexTracker;
}

/**
 * Build the callback `POST /config/apply` runs after writing the config: it
 * triggers `configWatch.reindex` (default `issues`; `prune` is never
 * auto-triggered). That reindex is config-triggered, so it stays file-only
 * (Decision 16.11). The reindex runs in the background.
 *
 * @param options - Server options.
 * @param context - Live config getter and reindex tracker.
 * @returns The apply callback.
 */
export function createConfigApplyCallback(
  options: ApiServerOptions,
  context: ConfigApplyCallbackContext,
): () => Promise<void> {
  const { getConfig, reindexTracker } = context;
  return () => {
    const scope = getConfig().configWatch?.reindex ?? 'issues';
    void executeReindex(
      reindexDepsFrom({ ...options, getConfig, reindexTracker }),
      { scope },
    );
    return Promise.resolve();
  };
}
