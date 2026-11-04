/**
 * @module watcher/chokidarOptions
 * chokidar 6 options for the chokidar change source and the config watcher. The backend is pinned so 0.20.0's behaviour (chokidar 5) is kept: one `fs.watch` per directory (`native`), or stat polling (`polling`) with `watch.usePolling`. chokidar 6's default `auto` backend (recursive `fs.watch` on Windows and macOS) is not used. No I/O.
 */

import type { ChokidarOptions } from 'chokidar';

/** The `watch` keys that select and tune the backend. */
export interface BackendConfig {
  /** `watch.usePolling`. */
  usePolling?: boolean;
  /** `watch.pollIntervalMs`. */
  pollIntervalMs?: number;
}

/**
 * Backend options: `native` (per directory) unless polling is configured.
 * A polling interval is passed only when positive, since chokidar 6
 * rejects anything else in its constructor (chokidar 5 accepted it); its
 * default (100 ms) applies otherwise. `atomic` is left at chokidar's
 * default, which is on with `native` and off with `polling`, as in 5.
 *
 * @param config - The backend keys of `watch`.
 * @returns `backend`, and `pollingInterval` when set.
 */
export function backendOptions(
  config: BackendConfig = {},
): Pick<ChokidarOptions, 'backend' | 'pollingInterval'> {
  if (!config.usePolling) return { backend: 'native' };
  const interval = config.pollIntervalMs;
  return {
    backend: 'polling',
    ...(interval !== undefined && interval > 0
      ? { pollingInterval: interval }
      : {}),
  };
}
