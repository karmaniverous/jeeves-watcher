/**
 * @module api/handlers/vcs/vcsShow
 * Fastify route handler for GET /vcs/show. Returns file content at a specific commit.
 */

import { extname } from 'node:path';

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import { resolveWatchRoot } from '../../../vcs/resolveWatchRoot';
import { runGit } from '../../../vcs/runGit';
import type { VcsCoordinator } from '../../../vcs/VcsCoordinator';
import { sendError } from '../../sendError';
import { wrapHandler } from '../wrapHandler';

/** Dependencies of the GET /vcs/show handler. */
export interface VcsShowRouteDeps {
  /** VCS coordinator (tracked roots and git operations). */
  coordinator: VcsCoordinator;
  /** Logger. */
  logger: pino.Logger;
}

type VcsShowRequest = FastifyRequest<{
  Querystring: {
    path: string;
    commit: string;
  };
}>;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
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
 * Content type for a file shown from git, by extension (unknown extensions
 * are `application/octet-stream`). Pure.
 *
 * @param path - File path (only its extension is used).
 * @returns The content type.
 */
export function contentTypeFor(path: string): string {
  return (
    CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
  );
}

/**
 * Create handler for GET /vcs/show.
 */
export function createVcsShowHandler(deps: VcsShowRouteDeps) {
  return wrapHandler(
    async (request: VcsShowRequest, reply: FastifyReply) => {
      const { path, commit } = request.query;

      if (!path || !commit) {
        sendError(
          reply,
          'invalid_request',
          'Missing required query parameters: path, commit',
        );
        return;
      }

      const resolved = resolveWatchRoot(deps.coordinator, path);
      if (!resolved) {
        sendError(
          reply,
          'not_found',
          'Path does not match any VCS-enabled watch root',
        );
        return;
      }

      try {
        const { stdout } = await runGit(resolved.root, [
          'show',
          `${commit}:${resolved.relativePath}`,
        ]);

        void reply.header('content-type', contentTypeFor(path)).send(stdout);
      } catch {
        sendError(reply, 'not_found', 'File not found at the specified commit');
      }
    },
    deps.logger,
    'VcsShow',
  );
}
