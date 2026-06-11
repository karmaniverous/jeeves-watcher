/**
 * @module api/handlers/vcs/vcsRevert
 * Fastify route handler for POST /vcs/revert. Restores files from a past commit.
 */

import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import { normalizeSlashes } from '../../../util/normalizeSlashes';
import { execFileAsync } from '../../../vcs/gitExec';
import { resolveWatchRootsForGlob } from '../../../vcs/resolveWatchRoot';
import type { VcsCoordinator } from '../../../vcs/VcsCoordinator';
import { wrapHandler } from '../wrapHandler';

export interface VcsRevertRouteDeps {
  coordinator: VcsCoordinator;
  logger: pino.Logger;
}

type VcsRevertRequest = FastifyRequest<{
  Body: {
    glob: string;
    commit: string;
    existingOnly?: boolean;
  };
}>;

/**
 * Create handler for POST /vcs/revert.
 */
export function createVcsRevertHandler(deps: VcsRevertRouteDeps) {
  return wrapHandler(
    async (request: VcsRevertRequest, reply: FastifyReply) => {
      const { glob, commit, existingOnly } = request.body;

      if (!glob || !commit) {
        void reply
          .status(400)
          .send({ error: 'Missing required body parameters: glob, commit' });
        return;
      }

      const resolved = resolveWatchRootsForGlob(deps.coordinator, glob);
      if (resolved.length === 0) {
        void reply
          .status(404)
          .send({ error: 'Glob does not match any VCS-enabled watch root' });
        return;
      }

      const allFiles: string[] = [];

      for (const { root, relativePath } of resolved) {
        const manager = deps.coordinator.getManager(root);
        if (!manager) continue;

        // List files matching the glob at the target commit
        let fileList: string[];
        try {
          const args =
            relativePath === '' || relativePath === '.'
              ? ['ls-tree', '-r', '--name-only', commit]
              : ['ls-tree', '-r', '--name-only', commit, '--', relativePath];
          const { stdout } = await execFileAsync('git', args, { cwd: root });
          fileList = stdout
            .trim()
            .split('\n')
            .filter((line) => line.length > 0);
        } catch {
          continue;
        }

        const restoredPaths: string[] = [];

        for (const relFile of fileList) {
          const absPath = normalizeSlashes(join(root, relFile));

          // If existingOnly, skip files that don't exist on disk
          if (existingOnly) {
            try {
              await access(absPath);
            } catch {
              continue;
            }
          }

          // Get file content at the target commit
          let content: string;
          try {
            const { stdout } = await execFileAsync(
              'git',
              ['show', `${commit}:${relFile}`],
              { cwd: root },
            );
            content = stdout;
          } catch {
            continue;
          }

          // Ensure parent directory exists
          const dir = dirname(absPath);
          await mkdir(dir, { recursive: true });

          // Write the file
          await writeFile(absPath, content, 'utf8');
          restoredPaths.push(absPath);

          // Notify VcsManager of the change (enters debounce cycle)
          manager.fileChanged(absPath);
        }

        if (restoredPaths.length > 0) {
          manager.addPendingReversion({
            glob,
            commit,
            paths: restoredPaths,
          });
          allFiles.push(...restoredPaths);
        }
      }

      return { restored: allFiles.length, files: allFiles };
    },
    deps.logger,
    'VcsRevert',
  );
}
