/**
 * @module api/handlers/vcs/vcsDiff
 * Fastify route handler for GET /vcs/diff. Returns diff text for a glob between commits.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import { execFileAsync } from '../../../vcs/gitExec';
import { resolveWatchRootsForGlob } from '../../../vcs/resolveWatchRoot';
import type { VcsCoordinator } from '../../../vcs/VcsCoordinator';
import { wrapHandler } from '../wrapHandler';

export interface VcsDiffRouteDeps {
  coordinator: VcsCoordinator;
  logger: pino.Logger;
}

type VcsDiffRequest = FastifyRequest<{
  Querystring: {
    glob: string;
    commit: string;
    commitEnd?: string;
  };
}>;

/**
 * Create handler for GET /vcs/diff.
 */
export function createVcsDiffHandler(deps: VcsDiffRouteDeps) {
  return wrapHandler(
    async (request: VcsDiffRequest, reply: FastifyReply) => {
      const { glob, commit, commitEnd } = request.query;

      if (!glob || !commit) {
        void reply
          .status(400)
          .send({ error: 'Missing required query parameters: glob, commit' });
        return;
      }

      const resolved = resolveWatchRootsForGlob(deps.coordinator, glob);
      if (resolved.length === 0) {
        void reply
          .status(404)
          .send({ error: 'No VCS-enabled watch root matches the given glob' });
        return;
      }

      const diffs: string[] = [];

      for (const { root, relativePath } of resolved) {
        const range = commitEnd ? `${commit}..${commitEnd}` : `${commit}..HEAD`;
        const args = ['diff', range, '--', relativePath || '.'];

        try {
          const { stdout } = await execFileAsync('git', args, { cwd: root });
          if (stdout.trim()) diffs.push(stdout);
        } catch {
          // Invalid commit or path — skip
        }
      }

      void reply.header('content-type', 'text/plain').send(diffs.join('\n'));
    },
    deps.logger,
    'VcsDiff',
  );
}
