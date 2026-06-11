/**
 * @module api/handlers/vcs/vcsHistory
 * Fastify route handler for GET /vcs/history. Returns commit history for a glob.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import { execFileAsync } from '../../../vcs/gitExec';
import { resolveWatchRootsForGlob } from '../../../vcs/resolveWatchRoot';
import type { VcsCoordinator } from '../../../vcs/VcsCoordinator';
import { wrapHandler } from '../wrapHandler';

export interface VcsHistoryRouteDeps {
  coordinator: VcsCoordinator;
  logger: pino.Logger;
}

type VcsHistoryRequest = FastifyRequest<{
  Querystring: {
    glob: string;
    since?: string;
    until?: string;
    limit?: string;
  };
}>;

interface HistoryEntry {
  commit: string;
  message: string;
  timestamp: string;
  files: string[];
}

/** Matches a commit header line: 40-hex-char hash, pipe, message, pipe, ISO timestamp. */
const HEADER_RE = /^([0-9a-f]{40})\|(.+)\|(\d{4}-\d{2}-\d{2}T.+)$/;

/**
 * Parse git log --format='%H|%s|%aI' --name-only output into structured entries.
 *
 * Output format per commit:
 *   hash|subject|ISO-date
 *   (empty line)
 *   file1
 *   file2
 *   (empty line)
 */
function parseGitLog(stdout: string): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  const lines = stdout.split('\n');
  let current: HistoryEntry | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    const headerMatch = HEADER_RE.exec(trimmed);

    if (headerMatch) {
      // Start of a new commit
      current = {
        commit: headerMatch[1],
        message: headerMatch[2],
        timestamp: headerMatch[3],
        files: [],
      };
      entries.push(current);
    } else if (trimmed.length > 0 && current) {
      current.files.push(trimmed);
    }
  }

  return entries;
}

/**
 * Create handler for GET /vcs/history.
 */
export function createVcsHistoryHandler(deps: VcsHistoryRouteDeps) {
  return wrapHandler(
    async (request: VcsHistoryRequest, reply: FastifyReply) => {
      const { glob, since, until, limit: limitStr } = request.query;

      if (!glob) {
        void reply
          .status(400)
          .send({ error: 'Missing required query parameter: glob' });
        return;
      }

      const limit = limitStr ? parseInt(limitStr, 10) : 20;
      const resolved = resolveWatchRootsForGlob(deps.coordinator, glob);

      if (resolved.length === 0) {
        void reply
          .status(404)
          .send({ error: 'No VCS-enabled watch root matches the given glob' });
        return;
      }

      const allEntries: HistoryEntry[] = [];

      for (const { root, relativePath } of resolved) {
        const args = ['log', '--format=%H|%s|%aI', '--name-only'];

        if (since) args.push(`--since=${since}`);
        if (until) args.push(`--until=${until}`);

        args.push('--', relativePath || '.');

        try {
          const { stdout } = await execFileAsync('git', args, { cwd: root });
          allEntries.push(...parseGitLog(stdout));
        } catch {
          // No commits or invalid path — skip
        }
      }

      // Sort by timestamp descending
      allEntries.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );

      return allEntries.slice(0, limit);
    },
    deps.logger,
    'VcsHistory',
  );
}
