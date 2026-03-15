/**
 * @module api/handlers/walk
 * Fastify route handler for POST /walk. Walks watched filesystem paths with caller-provided glob intersection.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import { createIsGitignored, type GitignoreFilter } from '../../gitignore';
import { getWatchRootBases, listFilesFromWatchRoots } from '../fileScan';
import { wrapHandler } from './wrapHandler';

/** Dependencies for the walk route handler. */
export interface WalkRouteDeps {
  watchPaths: string[];
  watchIgnored: string[];
  gitignoreFilter?: GitignoreFilter;
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

      const isGitignored = createIsGitignored(deps.gitignoreFilter);

      const paths = await listFilesFromWatchRoots(
        deps.watchPaths,
        deps.watchIgnored,
        globs,
        isGitignored,
      );

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
