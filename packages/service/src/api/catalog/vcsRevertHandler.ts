/**
 * @module api/catalog/vcsRevertHandler
 * Catalog handler for `POST /vcs/revert`: restores files from a past commit. The body is validated by the catalog's `revertVcs` entry schema.
 */

import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';

import { normalizeSlashes } from '../../util/normalizeSlashes';
import { runGit } from '../../vcs/runGit';
import type { Entry } from './catalogEntry';
import type { CatalogVcsDeps } from './vcsDeps';
import { requireGlobRoots } from './vcsRoots';
import { wrapCatalogHandler } from './wrapCatalogHandler';

/**
 * Create the catalog handler for `POST /vcs/revert`.
 *
 * @param deps - VCS coordinator and logger.
 * @returns The catalog handler.
 */
export function createCatalogVcsRevertHandler(
  deps: CatalogVcsDeps,
): CatalogHandler<Entry<'revertVcs'>> {
  return wrapCatalogHandler<Entry<'revertVcs'>>(
    async (input) => {
      const { glob, commit, existingOnly } = input.body;

      const resolved = requireGlobRoots(deps.coordinator, glob);

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
          const { stdout } = await runGit(root, args);
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
            const { stdout } = await runGit(root, [
              'show',
              `${commit}:${relFile}`,
            ]);
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

      return { body: { restored: allFiles.length, files: allFiles } };
    },
    deps.logger,
    'VcsRevert',
  );
}
