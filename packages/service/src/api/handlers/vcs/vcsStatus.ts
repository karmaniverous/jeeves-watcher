/**
 * @module api/handlers/vcs/vcsStatus
 * Fastify route handler for GET /vcs/status. Returns VCS state for all roots.
 */

import type pino from 'pino';

import { execFileAsync } from '../../../vcs/gitExec';
import type { VcsCoordinator } from '../../../vcs/VcsCoordinator';
import type { PushError } from '../../../vcs/VcsManager';
import { wrapHandler } from '../wrapHandler';

export interface VcsStatusRouteDeps {
  coordinator: VcsCoordinator;
  logger: pino.Logger;
}

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
  pushErrors: readonly PushError[];
}

async function getLastCommit(cwd: string): Promise<LastCommitInfo | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '-1', '--format=%H|%s|%aI'],
      { cwd },
    );
    const trimmed = stdout.trim();
    if (!trimmed) return null;
    const [hash, message, timestamp] = trimmed.split('|');
    return { hash, message, timestamp };
  } catch {
    return null;
  }
}

async function getTrackedCount(cwd: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-list', '--count', 'HEAD'],
      { cwd },
    );
    return parseInt(stdout.trim(), 10);
  } catch {
    return 0;
  }
}

async function getRemoteUrl(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['remote', 'get-url', 'origin'],
      { cwd },
    );
    const url = stdout.trim();
    return url || null;
  } catch {
    return null;
  }
}

/**
 * Create handler for GET /vcs/status.
 */
export function createVcsStatusHandler(deps: VcsStatusRouteDeps) {
  return wrapHandler(
    async () => {
      const roots = deps.coordinator.getRoots();
      const enabled = roots.length > 0;

      const rootStatuses: RootStatus[] = await Promise.all(
        roots.map(async (root) => {
          const manager = deps.coordinator.getManager(root);
          const [tracked, lastCommit, remoteUrl] = await Promise.all([
            getTrackedCount(root),
            getLastCommit(root),
            getRemoteUrl(root),
          ]);
          return {
            path: root,
            tracked,
            lastCommit,
            remoteUrl: manager?.remoteUrl ?? remoteUrl,
            lastPush: manager?.lastPushTime ?? null,
            pushErrors: manager?.pushErrors ?? [],
          };
        }),
      );

      return { enabled, roots: rootStatuses };
    },
    deps.logger,
    'VcsStatus',
  );
}
