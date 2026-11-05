/**
 * @module watcher/sourceWiring
 * The change source of one start (parcel when loaded, else chokidar, D125), how its renewals reach `health.changeSource` (D157, D165, D176), and the Linux warning when renewal is off (D129). Pure apart from constructing the source.
 */

import { ROOT_DEFAULTS } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { WatchConfig } from '../config/types';
import { ChokidarChangeSource } from './changeSource/ChokidarChangeSource';
import type { ParcelWatcherModule } from './changeSource/parcelModule';
import { ParcelSource } from './changeSource/ParcelSource';
import type { ProcessRestarter } from './changeSource/restart';
import type { ChangeSource, RenewResult } from './changeSource/types';
import type { ChangeSourceHealthTracker } from './ChangeSourceHealthTracker';

/** What building a source needs. */
export interface CreateSourceOptions {
  config: WatchConfig;
  /** The loaded `@parcel/watcher` when parcel is selected. */
  parcel?: ParcelWatcherModule;
  /** The service state directory (default `ROOT_DEFAULTS.stateDir`). */
  stateDir?: string;
  logger: pino.Logger;
  /** Records a chokidar error. */
  onSourceError: (error: unknown) => void;
  /** Exits for a restart where parcel never unsubscribes (D196). */
  restarter?: ProcessRestarter;
}

/**
 * The change source a start uses: parcel when loaded, else chokidar.
 *
 * @param options - Config, module, state dir, logger, error hook.
 * @returns The source (not started).
 */
export function createSource(options: CreateSourceOptions): ChangeSource {
  const { config, parcel } = options;
  if (parcel) {
    return new ParcelSource({
      parcel,
      ignored: config.ignored,
      stateDir: options.stateDir ?? ROOT_DEFAULTS.stateDir,
      logger: options.logger,
      restarter: options.restarter,
    });
  }
  return new ChokidarChangeSource({
    usePolling: config.usePolling,
    pollIntervalMs: config.pollIntervalMs,
    stabilityThresholdMs: config.stabilityThresholdMs,
    onError: options.onSourceError,
  });
}

/**
 * Renew a root and record the renewal's duration and any rejections
 * inside a rebuild in `health.changeSource` (D157, D165, D176).
 *
 * @param source - The running source.
 * @param root - The root.
 * @param health - The app's tracker, if any.
 * @returns The source's result.
 */
export async function renewRecorded(
  source: ChangeSource,
  root: string,
  health: ChangeSourceHealthTracker | undefined,
): Promise<RenewResult> {
  const result = await source.renew(root);
  if (result.durationMs !== undefined) health?.recordRenew(result.durationMs);
  if (result.rebuildFailures) {
    health?.recordRenewFailure(result.rebuildFailures);
  }
  return result;
}

/**
 * Warn at start when Linux parcel runs with the periodic reconcile off:
 * subscription renewal is off with it (D129).
 *
 * @param source - The source.
 * @param intervalMs - `watch.reconcileIntervalMs` in effect.
 * @param logger - Where the warning goes.
 * @param platform - `process.platform` (tests).
 * @returns True when it warned.
 */
export function warnRenewalOff(
  source: Pick<ChangeSource, 'name'>,
  intervalMs: number,
  logger: pino.Logger,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (source.name !== 'parcel' || platform !== 'linux' || intervalMs !== 0) {
    return false;
  }
  logger.warn(
    'watch.reconcileIntervalMs is 0: periodic reconciliation and inotify subscription renewal are both off; dead watches after a directory rename are not repaired',
  );
  return true;
}
