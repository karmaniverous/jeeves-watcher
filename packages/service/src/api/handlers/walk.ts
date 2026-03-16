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
import { wrapHandler } from './wrapHandler';

/** Dependencies for the walk route handler. */
export interface WalkRouteDeps {
  watchPaths: string[];
  fileSystemWatcher?: FileSystemWatcher;
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
        return await reply.status(400).send({
          error: 'Missing globs',
          message:
            'The "globs" field is required and must be a non-empty string array.',
        });
      }

      if (!deps.fileSystemWatcher) {
        return await reply.status(503).send({
          error: 'Watcher unavailable',
          message: 'Filesystem watcher is not initialized.',
        });
      }

      if (!deps.fileSystemWatcher.isReady) {
        return await reply.status(503).send({
          error: 'Scan in progress',
          message:
            'Initial filesystem scan is still active. Try again after scan completes.',
        });
      }

      const watchedFiles = deps.fileSystemWatcher.getWatchedFiles();

      const normGlobs = globs.map((g) => normalizeSlashes(g));
      const matchGlobs = picomatch(normGlobs, { dot: true, nocase: true });

      const paths = watchedFiles.filter((f) => matchGlobs(normalizeSlashes(f)));

      const scannedRoots = getWatchRootBases(deps.watchPaths);

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
