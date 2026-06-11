/**
 * @module api/handlers/vcs/vcsExclude
 * Fastify route handler for POST /vcs/exclude. Manages .gitignore exclusions
 * with locality-based placement.
 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import { normalizeSlashes } from '../../../util/normalizeSlashes';
import { findRootForPath } from '../../../vcs/gitExec';
import type { VcsCoordinator } from '../../../vcs/VcsCoordinator';
import { wrapHandler } from '../wrapHandler';

export interface VcsExcludeRouteDeps {
  coordinator: VcsCoordinator;
  logger: pino.Logger;
}

type VcsExcludeRequest = FastifyRequest<{
  Body: {
    glob: string;
    root?: string;
    remove?: boolean;
  };
}>;

/**
 * Determine the deepest directory for .gitignore placement and the pattern
 * to add. Splits the glob at the first wildcard character.
 *
 * @param relativeGlob - Glob relative to the watch root.
 * @returns The directory (relative to root) and the pattern for .gitignore.
 */
function splitGlobForLocality(relativeGlob: string): {
  dir: string;
  pattern: string;
} {
  // Find the first path segment containing a wildcard
  const segments = relativeGlob.split('/');
  const dirSegments: string[] = [];

  for (const segment of segments) {
    if (/[*?[\]{}]/.test(segment)) break;
    dirSegments.push(segment);
  }

  // Last non-wildcard segment might be a filename, not a directory.
  // If no wildcards at all, the directory is the parent of the file.
  if (dirSegments.length === segments.length) {
    // No wildcards — the glob is a literal path, directory is parent
    const dir = dirSegments.slice(0, -1).join('/') || '.';
    const pattern = dirSegments[dirSegments.length - 1];
    return { dir, pattern };
  }

  const dir = dirSegments.join('/') || '.';
  const patternSegments = segments.slice(dirSegments.length);
  const pattern = patternSegments.join('/');
  return { dir, pattern };
}

/**
 * Create handler for POST /vcs/exclude.
 */
export function createVcsExcludeHandler(deps: VcsExcludeRouteDeps) {
  return wrapHandler(
    async (request: VcsExcludeRequest, reply: FastifyReply) => {
      const { glob, root: requestedRoot, remove } = request.body;

      if (!glob) {
        void reply
          .status(400)
          .send({ error: 'Missing required body parameter: glob' });
        return;
      }

      // Resolve the root
      let root: string;
      if (requestedRoot) {
        const normalizedRoot = normalizeSlashes(requestedRoot);
        const manager = deps.coordinator.getManager(normalizedRoot);
        if (!manager) {
          void reply
            .status(404)
            .send({ error: 'Root is not a VCS-enabled watch root' });
          return;
        }
        root = normalizedRoot;
      } else {
        // Resolve root from the glob path
        const normalizedGlob = normalizeSlashes(glob);
        const basePath = normalizedGlob.replace(/[*?[\]{}].*/g, '');
        const matchedRoot = findRootForPath(
          deps.coordinator.getRoots(),
          basePath,
        );
        if (!matchedRoot) {
          void reply
            .status(404)
            .send({ error: 'Glob does not match any VCS-enabled watch root' });
          return;
        }
        root = matchedRoot;
      }

      // Compute relative glob from root
      const normalizedGlob = normalizeSlashes(glob);
      let relativeGlob: string;
      if (normalizedGlob.startsWith(root + '/')) {
        relativeGlob = normalizedGlob.slice(root.length + 1);
      } else {
        // Glob is the root itself or doesn't start with root — use as-is
        relativeGlob = normalizedGlob;
      }

      // Determine .gitignore directory and pattern using locality principle
      const { dir, pattern } = splitGlobForLocality(relativeGlob);

      const gitignoreDir =
        dir === '.' ? root : normalizeSlashes(join(root, dir));
      const gitignorePath = normalizeSlashes(join(gitignoreDir, '.gitignore'));

      if (remove) {
        // Remove the pattern from .gitignore
        let content: string;
        try {
          content = await readFile(gitignorePath, 'utf8');
        } catch {
          void reply
            .status(404)
            .send({ error: 'No .gitignore found at the expected location' });
          return;
        }

        const lines = content.split('\n');
        const filtered = lines.filter((line) => line.trim() !== pattern);

        if (filtered.length === lines.length) {
          void reply
            .status(404)
            .send({ error: 'Pattern not found in .gitignore' });
          return;
        }

        await writeFile(gitignorePath, filtered.join('\n'), 'utf8');
        return { ok: true, gitignorePath, action: 'removed' as const };
      }

      // Add the pattern to .gitignore
      await mkdir(gitignoreDir, { recursive: true });

      let existingContent = '';
      try {
        existingContent = await readFile(gitignorePath, 'utf8');
      } catch {
        // File doesn't exist yet
      }

      // Check if pattern already exists
      const existingLines = new Set(
        existingContent.split('\n').map((line) => line.trim()),
      );
      if (existingLines.has(pattern)) {
        return { ok: true, gitignorePath, action: 'added' as const };
      }

      if (existingContent.length === 0) {
        await writeFile(gitignorePath, pattern + '\n', 'utf8');
      } else {
        const prefix = existingContent.endsWith('\n') ? '' : '\n';
        await appendFile(gitignorePath, prefix + pattern + '\n', 'utf8');
      }

      return { ok: true, gitignorePath, action: 'added' as const };
    },
    deps.logger,
    'VcsExclude',
  );
}
