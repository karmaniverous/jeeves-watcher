/**
 * @module api/handlers/vcs/vcsCheckExclusion
 * Fastify route handler for GET /vcs/check-exclusion. Checks gitignore status of a path.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import { resolveWatchRoot } from '../../../vcs/resolveWatchRoot';
import type { VcsCoordinator } from '../../../vcs/VcsCoordinator';
import { wrapHandler } from '../wrapHandler';

const execFileAsync = promisify(execFile);

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
        void reply
          .status(400)
          .send({ error: 'Missing required query parameter: path' });
        return;
      }

      const resolved = resolveWatchRoot(deps.coordinator, path);
      if (!resolved) {
        void reply
          .status(404)
          .send({ error: 'Path does not match any VCS-enabled watch root' });
        return;
      }

      try {
        const { stdout } = await execFileAsync(
          'git',
          ['check-ignore', '-v', resolved.relativePath],
          { cwd: resolved.root },
        );

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
