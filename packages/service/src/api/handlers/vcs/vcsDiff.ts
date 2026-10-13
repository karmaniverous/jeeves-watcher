/**
 * @module api/handlers/vcs/vcsDiff
 * Fastify route handler for GET /vcs/diff. Returns diff text for a glob between commits.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import { resolveWatchRootsForGlob } from '../../../vcs/resolveWatchRoot';
import { runGit } from '../../../vcs/runGit';
import type { VcsCoordinator } from '../../../vcs/VcsCoordinator';
import { sendError } from '../../sendError';
import { wrapHandler } from '../wrapHandler';

/** Dependencies of the GET /vcs/diff handler. */
export interface VcsDiffRouteDeps {
  /** VCS coordinator (tracked roots and git operations). */
  coordinator: VcsCoordinator;
  /** Logger. */
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
        sendError(
          reply,
          'invalid_request',
          'Missing required query parameters: glob, commit',
        );
        return;
      }

      const resolved = resolveWatchRootsForGlob(deps.coordinator, glob);
      if (resolved.length === 0) {
        sendError(
          reply,
          'not_found',
          'No VCS-enabled watch root matches the given glob',
        );
        return;
      }

      const diffs: string[] = [];

      for (const { root, relativePath } of resolved) {
        const range = commitEnd ? `${commit}..${commitEnd}` : `${commit}..HEAD`;
        const args = ['diff', range, '--', relativePath || '.'];

        try {
          const { stdout } = await runGit(root, args);
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
