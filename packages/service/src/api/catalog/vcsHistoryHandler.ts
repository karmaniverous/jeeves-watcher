/**
 * @module api/catalog/vcsHistoryHandler
 * Catalog handler for `GET /vcs/history`: commit history for a glob (a bare array, newest first). The query is validated by the catalog's `listVcsHistory` entry schema.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';
import type { VcsHistoryResponse } from '@karmaniverous/jeeves-watcher-core';

import { runGit } from '../../vcs/runGit';
import type { Entry } from './catalogEntry';
import type { CatalogVcsDeps } from './vcsDeps';
import { requireGlobRoots } from './vcsRoots';
import { wrapCatalogHandler } from './wrapCatalogHandler';

/** One commit of the history. */
type HistoryEntry = VcsHistoryResponse[number];

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
 * Create the catalog handler for `GET /vcs/history`.
 *
 * @param deps - VCS coordinator and logger.
 * @returns The catalog handler.
 */
export function createCatalogVcsHistoryHandler(
  deps: CatalogVcsDeps,
): CatalogHandler<Entry<'listVcsHistory'>> {
  return wrapCatalogHandler<Entry<'listVcsHistory'>>(
    async (input) => {
      const { glob, since, until, limit: limitStr } = input.query;

      const limit = limitStr ? parseInt(limitStr, 10) : 20;
      const resolved = requireGlobRoots(
        deps.coordinator,
        glob,
        'No VCS-enabled watch root matches the given glob',
      );

      const allEntries: HistoryEntry[] = [];

      for (const { root, relativePath } of resolved) {
        const args = ['log', '--format=%H|%s|%aI', '--name-only'];

        if (since) args.push(`--since=${since}`);
        if (until) args.push(`--until=${until}`);

        args.push('--', relativePath || '.');

        try {
          const { stdout } = await runGit(root, args);
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

      return { body: allEntries.slice(0, limit) };
    },
    deps.logger,
    'VcsHistory',
  );
}
