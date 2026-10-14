/**
 * @module api/handlers/walk
 * Fastify route handler for POST /walk. Enumerates watched files matching caller-provided globs
 * using chokidar's in-memory file list (zero filesystem I/O).
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import picomatch from 'picomatch';
import type pino from 'pino';

import { normalizeSlashes } from '../../util/normalizeSlashes';
import type { FileSystemWatcher } from '../../watcher';
import { getWatchRootBases } from '../fileScan';
import { sendError } from '../sendError';
import { wrapHandler } from './wrapHandler';

/** Dependencies for the walk route handler. */
export interface WalkRouteDeps {
  getWatchPaths: () => string[];
  /** Getter for the current filesystem watcher (supports hot-reload rebuilds). */
  getFileSystemWatcher?: () => FileSystemWatcher | undefined;
  logger: pino.Logger;
}

type WalkRequest = FastifyRequest<{
  Body: { globs?: string[] };
}>;

/**
 * Create handler for POST /walk.
 *
 * @param deps - Route dependencies.
 */
export function createWalkHandler(deps: WalkRouteDeps) {
  return wrapHandler(
    async (request: WalkRequest, reply: FastifyReply) => {
      const { globs } = request.body;

      if (!Array.isArray(globs) || globs.length === 0) {
        return sendError(reply, 'invalid_request', 'Missing globs', {
          message:
            'The "globs" field is required and must be a non-empty string array.',
        });
      }

      const fileSystemWatcher = deps.getFileSystemWatcher?.();

      if (!fileSystemWatcher) {
        return sendError(reply, 'not_available', 'Watcher unavailable', {
          message: 'Filesystem watcher is not initialized.',
        });
      }

      if (!fileSystemWatcher.isReady) {
        return sendError(reply, 'scan_in_progress', 'Scan in progress', {
          message:
            'Initial filesystem scan is still active. Try again after scan completes.',
        });
      }

      const watchedFiles = fileSystemWatcher.getWatchedFiles();

      const normGlobs = globs.map((g) => normalizeSlashes(g));
      const matchGlobs = picomatch(normGlobs, { dot: true, nocase: true });

      const paths = watchedFiles.filter((f) => matchGlobs(normalizeSlashes(f)));

      const scannedRoots = getWatchRootBases(deps.getWatchPaths());

      return {
        paths,
        matchedCount: paths.length,
        scannedRoots,
      };
    },
    deps.logger,
    'Walk',
  );
}
