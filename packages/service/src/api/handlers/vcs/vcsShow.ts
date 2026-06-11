/**
 * @module api/handlers/vcs/vcsShow
 * Fastify route handler for GET /vcs/show. Returns file content at a specific commit.
 */

import { execFile } from 'node:child_process';
import { extname } from 'node:path';
import { promisify } from 'node:util';

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import { resolveWatchRoot } from '../../../vcs/resolveWatchRoot';
import type { VcsCoordinator } from '../../../vcs/VcsCoordinator';
import { wrapHandler } from '../wrapHandler';

const execFileAsync = promisify(execFile);

export interface VcsShowRouteDeps {
  coordinator: VcsCoordinator;
  logger: pino.Logger;
}

type VcsShowRequest = FastifyRequest<{
  Querystring: {
    path: string;
    commit: string;
  };
}>;

const CONTENT_TYPES: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.ts': 'text/plain',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.csv': 'text/csv',
};

/**
 * Create handler for GET /vcs/show.
 */
export function createVcsShowHandler(deps: VcsShowRouteDeps) {
  return wrapHandler(
    async (request: VcsShowRequest, reply: FastifyReply) => {
      const { path, commit } = request.query;

      if (!path || !commit) {
        void reply
          .status(400)
          .send({ error: 'Missing required query parameters: path, commit' });
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
          ['show', `${commit}:${resolved.relativePath}`],
          { cwd: resolved.root },
        );

        const ext = extname(path).toLowerCase();
        const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';
        void reply.header('content-type', contentType).send(stdout);
      } catch {
        void reply
          .status(404)
          .send({ error: 'File not found at the specified commit' });
      }
    },
    deps.logger,
    'VcsShow',
  );
}
