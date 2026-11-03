/**
 * @module api/catalog/vcsStatusHandler
 * Catalog handler for `GET /vcs/status`: VCS state for all roots.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';

import { runGit } from '../../vcs/runGit';
import type { PushError, VcsBreakerState } from '../../vcs/VcsManager';
import type { Entry } from './catalogEntry';
import type { CatalogVcsDeps } from './vcsDeps';
import { wrapCatalogHandler } from './wrapCatalogHandler';

interface LastCommitInfo {
  hash: string;
  message: string;
  timestamp: string;
}

interface RootStatus {
  path: string;
  tracked: number;
  lastCommit: LastCommitInfo | null;
  remoteUrl: string | null;
  lastPush: string | null;
  pushErrors: PushError[];
  /** Per-root commit circuit breaker state (null if no manager). */
  breaker: VcsBreakerState | null;
}

/**
 * Run a read-only git query; a failure (no commits, no remote, not a repo)
 * or empty output yields null.
 */
async function queryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    const out = (await runGit(cwd, args)).stdout.trim();
    return out || null;
  } catch {
    return null;
  }
}

async function getLastCommit(cwd: string): Promise<LastCommitInfo | null> {
  const out = await queryGit(cwd, ['log', '-1', '--format=%H|%s|%aI']);
  if (out === null) return null;
  // Hash and timestamp never contain '|'; the subject may.
  const parts = out.split('|');
  return {
    hash: parts[0],
    message: parts.slice(1, -1).join('|'),
    timestamp: parts[parts.length - 1],
  };
}

async function getCommitCount(cwd: string): Promise<number> {
  const out = await queryGit(cwd, ['rev-list', '--count', 'HEAD']);
  return out === null ? 0 : parseInt(out, 10);
}

/**
 * Create the catalog handler for `GET /vcs/status`.
 *
 * @param deps - VCS coordinator and logger.
 * @returns The catalog handler.
 */
export function createCatalogVcsStatusHandler(
  deps: CatalogVcsDeps,
): CatalogHandler<Entry<'vcsStatus'>> {
  return wrapCatalogHandler<Entry<'vcsStatus'>>(
    async () => {
      const roots = deps.coordinator.getRoots();
      const enabled = roots.length > 0;

      const rootStatuses: RootStatus[] = await Promise.all(
        roots.map(async (root) => {
          const manager = deps.coordinator.getManager(root);
          const [tracked, lastCommit, remoteUrl] = await Promise.all([
            getCommitCount(root),
            getLastCommit(root),
            queryGit(root, ['remote', 'get-url', 'origin']),
          ]);
          return {
            path: root,
            tracked,
            lastCommit,
            remoteUrl: manager?.remoteUrl ?? remoteUrl,
            lastPush: manager?.lastPushTime ?? null,
            pushErrors: [...(manager?.pushErrors ?? [])],
            breaker: manager?.breakerState ?? null,
          };
        }),
      );

      return { body: { enabled, roots: rootStatuses } };
    },
    deps.logger,
    'VcsStatus',
  );
}
