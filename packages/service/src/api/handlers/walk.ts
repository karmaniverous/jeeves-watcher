/**
 * @module api/handlers/walk
 * Fastify route handler for POST /walk. Returns watched filesystem paths with caller-provided glob intersection.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { FileSystemWatcher } from '../../watcher';
import { getWatchRootBases } from '../fileScan';
import type { InitialScanTracker } from '../InitialScanTracker';
import { wrapHandler } from './wrapHandler';

/** Dependencies for the walk route handler. */
export interface WalkRouteDeps {
  watchPaths: string[];
  watchIgnored: string[];
  fileSystemWatcher?: FileSystemWatcher;
  initialScanTracker?: InitialScanTracker;
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

      // Return 503 if initial scan is still active (list would be incomplete)
      const scanStatus = deps.initialScanTracker?.getStatus();
      if (scanStatus?.active) {
        return await reply.status(503).send({
          error: 'Initial scan in progress',
          message:
            'The filesystem watcher is still performing its initial scan. Please retry later.',
          retryAfter: 5,
        });
      }

      // Use in-memory file list from chokidar via FileSystemWatcher
      const paths = deps.fileSystemWatcher
        ? deps.fileSystemWatcher.getWatchedFiles(globs)
        : [];

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
