/**
 * @module watcher/changeSource/selectSource
 * Which change source a watch config selects (D61, D125): `chokidar` when polling or when set, else `parcel`. Pure.
 */

import type { WatchConfig } from '../../config/types';

/** A change source name. */
export type ChangeSourceName = 'parcel' | 'chokidar';

/**
 * The change source a watch config selects: polling forces `chokidar`;
 * otherwise `watch.changeSource`, default `parcel`. There is no automatic
 * fallback (D125).
 *
 * @param watch - The watch config.
 * @returns The source name.
 */
export function selectedChangeSource(
  watch: Pick<WatchConfig, 'usePolling' | 'changeSource'>,
): ChangeSourceName {
  if (watch.usePolling) return 'chokidar';
  return watch.changeSource ?? 'parcel';
}
