/**
 * @module api/handlers/walk
 * Fastify route handler for POST /walk. Walks watched filesystem paths with caller-provided glob intersection.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';
import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import picomatch from 'picomatch';

import type { FileSystemWatcher } from '../../watcher';
import { createIsGitignored, type GitignoreFilter } from '../../gitignore';
import { getWatchRootBases, getWatchedFiles, globBase } from '../fileScan';
import { normalizeSlashes } from '../../util/normalizeSlashes';
import type { InitialScanTracker } from '../InitialScanTracker';
import { wrapHandler } from './wrapHandler';

/** Dependencies for the walk route handler. */
export interface WalkRouteDeps {
  watchPaths: string[];
  watchIgnored: string[];
  gitignoreFilter?: GitignoreFilter;
  logger: pino.Logger;
  initialScanTracker?: InitialScanTracker;
  fileSystemWatcher?: FileSystemWatcher;
}

type WalkRequest = FastifyRequest<{
  Body: { globs?: string[] };
}>;

/** Fallback filesystem walk for when FileSystemWatcher is not available. */
async function* walk(dir: string): AsyncGenerator<string> {
  let entries: Array<{ name: string; isDirectory: boolean }>;
  try {
    const dirents = await readdir(dir, { withFileTypes: true });
    entries = dirents.map((d) => ({
      name: d.name,
      isDirectory: d.isDirectory(),
    }));
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory) {
      yield* walk(full);
    } else {
      try {
        const st = await stat(full);
        if (st.isFile()) yield full;
      } catch {
        // ignore
      }
    }
  }
}

/** Filter watched files using the same logic as the original walk. */
function filterWatchedFiles(
  files: string[],
  watchPatterns: string[],
  ignored: string[],
  callerGlobs: string[],
  isGitignored?: (filePath: string) => boolean,
): string[] {
  const normPatterns = watchPatterns.map((p) => normalizeSlashes(p));
  const normIgnored = ignored.map((p) => normalizeSlashes(p));
  const normCaller = callerGlobs.map((p) => normalizeSlashes(p));

  const matchWatch = picomatch(normPatterns, { dot: true, nocase: true });
  const matchCaller = picomatch(normCaller, { dot: true, nocase: true });
  const ignore = normIgnored.length
    ? picomatch(normIgnored, { dot: true, nocase: true })
    : () => false;

  const seen = new Set<string>();
  for (const file of files) {
    const rel = normalizeSlashes(file);
    if (ignore(rel)) continue;
    if (!matchWatch(rel)) continue;
    if (!matchCaller(rel)) continue;
    if (isGitignored?.(file)) continue;
    seen.add(file);
  }

  return Array.from(seen);
}

/**
 * Create handler for POST /walk.
 *
 * @param deps - Route dependencies.
 */
export function createWalkHandler(deps: WalkRouteDeps) {
  return wrapHandler(
    async (request: WalkRequest, reply: FastifyReply) => {
      const { globs } = request.body;

      if (!Array.isArray(globs) || globs.length === 0) {
        return await reply.status(400).send({
          error: 'Missing globs',
          message:
            'The "globs" field is required and must be a non-empty string array.',
        });
      }

      // Return 503 if initial scan is still active
      if (deps.initialScanTracker?.getStatus().active) {
        return await reply.status(503).send({
          error: 'Service Unavailable',
          message: 'Initial filesystem scan is in progress. Please try again later.',
        });
      }

      // Use in-memory watched files if available, otherwise fall back to filesystem walk
      let allFiles: string[];
      if (deps.fileSystemWatcher) {
        const watched = deps.fileSystemWatcher.getWatched();
        allFiles = getWatchedFiles(watched);
      } else {
        // Fallback: collect files by walking watch root bases
        const bases = getWatchRootBases(deps.watchPaths);
        allFiles = [];
        for (const base of bases) {
          for await (const file of walk(base)) {
            allFiles.push(file);
          }
        }
      }

      const isGitignored = createIsGitignored(deps.gitignoreFilter);
      const paths = filterWatchedFiles(allFiles, deps.watchPaths, deps.watchIgnored, globs, isGitignored);
      const scannedRoots = getWatchRootBases(deps.watchPaths);

      return {
        paths,
        matchedCount: paths.length,
        scannedRoots,
      };
    },
    deps.logger,
    'Walk',
  );
}
