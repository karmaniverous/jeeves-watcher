/**
 * @module api/catalog/walkHandler
 * Catalog handler for `POST /walk`: enumerates the inventory's files (matched, not ignored or gitignored; D83) that match caller-provided globs, sorted by path, with zero filesystem I/O. The request (`globs`, non-empty) is validated by the catalog's `walk` entry schema.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';
import picomatch from 'picomatch';
import type pino from 'pino';

import { normalizeSlashes } from '../../util/normalizeSlashes';
import type { FileSystemWatcher } from '../../watcher';
import { ScanInProgress, WatcherNotReady } from '../errors';
import { getWatchRootBases } from '../fileScan';
import type { Entry } from './catalogEntry';
import { wrapCatalogHandler } from './wrapCatalogHandler';

/** Dependencies for the catalog `walk` entry's handler. */
export interface CatalogWalkDeps {
  /** The configured watch paths. */
  getWatchPaths: () => string[];
  /** Getter for the current filesystem watcher (supports hot-reload rebuilds). */
  getFileSystemWatcher?: () => FileSystemWatcher | undefined;
  /** Logger. */
  logger: pino.Logger;
}

/**
 * Create the catalog handler for `POST /walk`. Without a filesystem watcher
 * it answers `503 WATCHER_NOT_AVAILABLE`; during the initial scan,
 * `503 WATCHER_SCAN_IN_PROGRESS`.
 *
 * @param deps - Handler dependencies.
 * @returns The catalog handler.
 */
export function createCatalogWalkHandler(
  deps: CatalogWalkDeps,
): CatalogHandler<Entry<'walk'>> {
  return wrapCatalogHandler<Entry<'walk'>>(
    (input) => {
      const { globs } = input.body;
      const fileSystemWatcher = deps.getFileSystemWatcher?.();

      if (!fileSystemWatcher) {
        throw new WatcherNotReady();
      }

      if (!fileSystemWatcher.isReady) {
        throw new ScanInProgress();
      }

      const watchedFiles = fileSystemWatcher.getWatchedFiles();

      const normGlobs = globs.map((g) => normalizeSlashes(g));
      const matchGlobs = picomatch(normGlobs, { dot: true, nocase: true });

      const paths = watchedFiles
        .filter((f) => matchGlobs(normalizeSlashes(f)))
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

      const scannedRoots = getWatchRootBases(deps.getWatchPaths());

      return Promise.resolve({
        body: { paths, matchedCount: paths.length, scannedRoots },
      });
    },
    deps.logger,
    'Walk',
  );
}
