/**
 * @module vcs/untrack
 * The shared untrack helper (D147, D163, D164, D178): a commit built on a private index from HEAD removes the paths HEAD holds, a compare-and-swap `update-ref` publishes it, then `update-index --force-remove` drops the union from the real index. Writes `.git/untrack.pending` across the crash window. Caller holds RootGitLock.
 *
 * Files stay on disk. Unrelated staged entries in the real index are never
 * touched, and nothing is committed when HEAD holds none of the paths
 * (including an unborn HEAD).
 */

import { rm } from 'node:fs/promises';

import { getErrorCode, normalizePathCase } from './gitExec';
import { gitForceRemove, gitRmCached } from './gitIndex';
import { runGit } from './runGit';
import {
  privateIndexPath,
  removePrivateIndex,
  untrackMarkerPath,
  writeUntrackMarker,
} from './untrackPending';

/** Test hooks around the reference update (crash-window tests). */
export interface UntrackHooks {
  /** After the marker is written, before `update-ref`. */
  beforeUpdateRef?: () => Promise<void>;
  /** After `update-ref`, before the real-index removal. */
  afterUpdateRef?: () => Promise<void>;
}

/** What to untrack. */
export interface UntrackRequest {
  /**
   * List the root-relative paths to untrack that an index holds; `env`
   * selects the index (`GIT_INDEX_FILE` for the private one).
   */
  select: (env: NodeJS.ProcessEnv) => Promise<string[]>;
  /** Commit message. */
  message: string;
  /** Exclude pattern recorded in the marker (`/vcs/exclude`), if any. */
  pattern?: string;
  /** Test hooks. */
  hooks?: UntrackHooks;
}

/** Outcome of {@link untrackPaths}. */
export interface UntrackResult {
  /** The untrack commit, or undefined when HEAD held none of the paths. */
  commit: string | undefined;
  /** Every path removed from the real index (HEAD list ∪ real-index list). */
  untracked: string[];
}

/**
 * HEAD's commit, or undefined when HEAD is unborn (`rev-parse --verify -q`
 * exits 1). Any other failure (a timeout) is rethrown.
 *
 * @param root - Repository root.
 * @returns The full hash, or undefined.
 */
export async function readHead(root: string): Promise<string | undefined> {
  try {
    const { stdout } = await runGit(root, [
      'rev-parse',
      '--verify',
      '-q',
      'HEAD',
    ]);
    return stdout.trim();
  } catch (error) {
    if (getErrorCode(error) === 1) return undefined;
    throw error;
  }
}

/** Union of path lists, deduplicated by the platform's case rules. */
function union(...lists: string[][]): string[] {
  const seen = new Map<string, string>();
  for (const path of lists.flat()) {
    const key = normalizePathCase(path);
    if (!seen.has(key)) seen.set(key, path);
  }
  return [...seen.values()];
}

/** One attempt's commit on the private index, if HEAD holds any path. */
interface PrivateCommit {
  /** HEAD paths removed by the commit. */
  headPaths: string[];
  /** The new commit (undefined when HEAD held none of the paths). */
  commit: string | undefined;
}

/**
 * Build the untrack commit on a private index from `head`.
 *
 * @returns The HEAD list and the new commit.
 */
async function buildPrivateCommit(
  root: string,
  head: string,
  request: UntrackRequest,
): Promise<PrivateCommit> {
  const index = privateIndexPath(root);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const indexLockPath = `${index}.lock`;
  await removePrivateIndex(root);
  await runGit(root, ['read-tree', head], { env, indexLockPath });
  const headPaths = await request.select(env);
  if (headPaths.length === 0) return { headPaths, commit: undefined };

  await gitRmCached(root, headPaths, { env, indexLockPath });
  const tree = (
    await runGit(root, ['write-tree'], { env, indexLockPath })
  ).stdout.trim();
  const commit = (
    await runGit(root, ['commit-tree', tree, '-p', head, '-m', request.message])
  ).stdout.trim();
  return { headPaths, commit };
}

/**
 * Untrack the paths `request.select` lists, in one commit plus a
 * real-index removal. A foreign commit that moves HEAD between `read-tree`
 * and `update-ref` makes the compare-and-swap fail; the commit is then
 * rebuilt once on the new HEAD, and a second failure throws.
 *
 * @param root - Repository root (the caller holds its RootGitLock).
 * @param request - Selector, message, pattern and test hooks.
 * @returns The commit (if any) and the paths removed from the real index.
 */
export async function untrackPaths(
  root: string,
  request: UntrackRequest,
): Promise<UntrackResult> {
  const realPaths = await request.select(process.env);
  let head = await readHead(root);
  let built: PrivateCommit = { headPaths: [], commit: undefined };

  try {
    for (let attempt = 1; head !== undefined; attempt++) {
      built = await buildPrivateCommit(root, head, request);
      if (built.commit === undefined) break;
      await writeUntrackMarker(root, {
        oldHead: head,
        newCommit: built.commit,
        pattern: request.pattern,
        paths: union(built.headPaths, realPaths),
      });
      await request.hooks?.beforeUpdateRef?.();
      try {
        await runGit(root, [
          'update-ref',
          '-m',
          'jeeves-watcher untrack',
          'HEAD',
          built.commit,
          head,
        ]);
        break;
      } catch (error) {
        await rm(untrackMarkerPath(root), { force: true });
        const moved = await readHead(root);
        if (attempt >= 2 || moved === head) throw error;
        head = moved;
        built = { headPaths: [], commit: undefined };
      }
    }
  } finally {
    await removePrivateIndex(root);
  }

  const untracked = union(built.headPaths, realPaths);
  if (built.commit !== undefined) await request.hooks?.afterUpdateRef?.();
  await gitForceRemove(root, untracked);
  await rm(untrackMarkerPath(root), { force: true });
  return { commit: built.commit, untracked };
}
