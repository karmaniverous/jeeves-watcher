/**
 * @module vcs/trackedCheck
 * The batch tracked check (D175): which root-relative paths an index lists, via `git --literal-pathspecs ls-files -z -c -- <paths>` in chunks of at most 500 paths or 24 KiB.
 *
 * `ls-files` has no `--pathspec-from-file` (exit 129), so the paths go on
 * the command line after `--`; chunking keeps each call far under Windows'
 * 32,767-character limit. Each chunk is timed by its own path count.
 */

import { normalizePathCase, pathListTimeoutMs } from './gitExec';
import { runGit } from './runGit';

/** Most paths in one `ls-files` call. */
export const TRACKED_CHECK_MAX_PATHS = 500;

/** Most path bytes (UTF-8) in one `ls-files` call. */
export const TRACKED_CHECK_MAX_BYTES = 24 * 1024;

/**
 * Split paths into chunks of at most {@link TRACKED_CHECK_MAX_PATHS} paths
 * and {@link TRACKED_CHECK_MAX_BYTES} UTF-8 bytes (a single longer path is
 * its own chunk).
 *
 * @param paths - Root-relative paths.
 * @returns The chunks, in order.
 */
export function chunkPaths(paths: readonly string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let bytes = 0;
  for (const path of paths) {
    const size = Buffer.byteLength(path, 'utf8');
    if (
      current.length > 0 &&
      (current.length >= TRACKED_CHECK_MAX_PATHS ||
        bytes + size > TRACKED_CHECK_MAX_BYTES)
    ) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(path);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Options for {@link listTracked}. */
export interface TrackedCheckOptions {
  /** Child environment (e.g. `GIT_INDEX_FILE` for a private index). */
  env?: NodeJS.ProcessEnv;
  /** Per-chunk timeout (default: the path-list timeout of the chunk). */
  timeoutFor?: (paths: number) => number;
}

/**
 * Return the subset of `paths` the index lists (tracked: committed, or
 * staged by a failed batch). Comparison follows the platform's path case
 * rules (case-insensitive on Windows).
 *
 * @param cwd - Repository root.
 * @param paths - Root-relative paths, forward slashes.
 * @param options - Environment and timeout override.
 * @returns The listed paths, as given in `paths`.
 */
export async function listTracked(
  cwd: string,
  paths: readonly string[],
  options: TrackedCheckOptions = {},
): Promise<string[]> {
  const timeoutFor = options.timeoutFor ?? pathListTimeoutMs;
  const listed = new Set<string>();
  for (const chunk of chunkPaths(paths)) {
    const { stdout } = await runGit(
      cwd,
      ['--literal-pathspecs', 'ls-files', '-z', '-c', '--', ...chunk],
      {
        timeoutMs: timeoutFor(chunk.length),
        ...(options.env === undefined ? {} : { env: options.env }),
      },
    );
    for (const entry of stdout.split('\0')) {
      if (entry.length > 0) listed.add(normalizePathCase(entry));
    }
  }
  return paths.filter((p) => listed.has(normalizePathCase(p)));
}
