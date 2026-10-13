/**
 * @module api/handlers/vcs/vcsCheckExclusion
 * Fastify route handler for GET /vcs/check-exclusion. Checks gitignore status of a path.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import { resolveWatchRoot } from '../../../vcs/resolveWatchRoot';
import { runGit } from '../../../vcs/runGit';
import type { VcsCoordinator } from '../../../vcs/VcsCoordinator';
import { sendError } from '../../sendError';
import { wrapHandler } from '../wrapHandler';

export interface VcsCheckExclusionRouteDeps {
  coordinator: VcsCoordinator;
  logger: pino.Logger;
}

type VcsCheckExclusionRequest = FastifyRequest<{
  Querystring: {
    path: string;
  };
}>;

/**
 * Create handler for GET /vcs/check-exclusion.
 */
export function createVcsCheckExclusionHandler(
  deps: VcsCheckExclusionRouteDeps,
) {
  return wrapHandler(
    async (request: VcsCheckExclusionRequest, reply: FastifyReply) => {
      const { path } = request.query;

      if (!path) {
        sendError(
          reply,
          400,
          'invalid_request',
          'Missing required query parameter: path',
        );
        return;
      }

      const resolved = resolveWatchRoot(deps.coordinator, path);
      if (!resolved) {
        sendError(
          reply,
          404,
          'not_found',
          'Path does not match any VCS-enabled watch root',
        );
        return;
      }

      try {
        const { stdout } = await runGit(resolved.root, [
          'check-ignore',
          '-v',
          resolved.relativePath,
        ]);

        // Output format: <source>:<linenum>:<pattern>\t<pathname>
        const trimmed = stdout.trim();
        const match = /^(.+):(\d+):(.+)\t/.exec(trimmed);

        if (match) {
          return {
            excluded: true,
            rule: match[3].trim(),
            source: match[1],
          };
        }

        return { excluded: true };
      } catch {
        // Exit code 1 means the path is NOT ignored
        return { excluded: false };
      }
    },
    deps.logger,
    'VcsCheckExclusion',
  );
}
