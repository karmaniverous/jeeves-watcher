/**
 * @module vcs/squashPlumbing
 * Plumbing-only history rewrite for squash retention (D148, D166): list the first-parent history, rebuild it with `commit-tree` from a parentless baseline, keeping each retained commit's tree, raw message, identities and raw dates. Never touches the working tree or the index.
 */

import { runGit } from './runGit';

/** Commit metadata for retention calculation. */
export interface CommitInfo {
  /** Full hash. */
  hash: string;
  /** Author date. */
  date: Date;
}

/** Message of the parentless baseline commit (0.20.0's squash message). */
export const SQUASH_BASELINE_MESSAGE = 'historical baseline';

/**
 * List `tip`'s first-parent history, oldest first:
 * `git rev-list --reverse --first-parent --format=%aI <tip>` (D166).
 *
 * @param root - Repository root.
 * @param tip - Commit to start from (the branch tip).
 * @returns Hashes with author dates.
 */
export async function listFirstParent(
  root: string,
  tip: string,
): Promise<CommitInfo[]> {
  const { stdout } = await runGit(root, [
    'rev-list',
    '--reverse',
    '--first-parent',
    '--format=%aI',
    tip,
  ]);
  const lines = stdout.split('\n').filter((line) => line.length > 0);
  const commits: CommitInfo[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    commits.push({
      hash: lines[i].replace(/^commit /, ''),
      date: new Date(lines[i + 1]),
    });
  }
  return commits;
}

/** An author or committer line of a raw commit. */
interface Identity {
  name: string;
  email: string;
  /** Raw date: `<epoch seconds> <+hhmm>`. */
  date: string;
}

/** The parts of a raw commit a rebuild needs. */
export interface RawCommit {
  /** Tree hash. */
  tree: string;
  /** Author identity and raw date. */
  author: Identity;
  /** Committer identity and raw date. */
  committer: Identity;
  /** Message bytes, exactly as stored (everything after the header). */
  message: Buffer;
  /** The `encoding` header of a non-UTF-8 commit, if any. */
  encoding?: string;
}

const IDENTITY_LINE = /^(author|committer) (.*) <(.*)> (\d+ [+-]\d{4})$/;

/**
 * Decode a commit header in its declared encoding (UTF-8 by default, or
 * when Node does not know the label).
 */
function decodeHeader(header: Buffer, encoding: string | undefined): string {
  if (encoding === undefined) return header.toString('utf8');
  try {
    return new TextDecoder(encoding).decode(header);
  } catch {
    return header.toString('utf8');
  }
}

/**
 * Parse `git cat-file commit` output. The message is the bytes after the
 * first blank line, byte for byte (D166).
 *
 * @param raw - The raw commit object.
 * @returns Tree, identities and message.
 */
export function parseRawCommit(raw: Buffer): RawCommit {
  const split = raw.indexOf('\n\n');
  const headerBytes = split === -1 ? raw : raw.subarray(0, split);
  const message = split === -1 ? Buffer.alloc(0) : raw.subarray(split + 2);
  // Header lines other than identities are ASCII; read `encoding` first.
  const encoding = /^encoding (.+)$/m.exec(headerBytes.toString('latin1'))?.[1];
  const header = decodeHeader(headerBytes, encoding);
  let tree = '';
  const identities: Partial<Record<'author' | 'committer', Identity>> = {};
  for (const line of header.split('\n')) {
    if (line.startsWith('tree ')) tree = line.slice(5);
    const match = IDENTITY_LINE.exec(line);
    if (match) {
      identities[match[1] as 'author' | 'committer'] = {
        name: match[2],
        email: match[3],
        date: match[4],
      };
    }
  }
  const { author, committer } = identities;
  if (!tree || !author || !committer) {
    throw new Error('Unparseable commit object');
  }
  return {
    tree,
    author,
    committer,
    message,
    ...(encoding === undefined ? {} : { encoding }),
  };
}

/** Header lines a copy drops (with their continuation lines). */
const DROPPED_HEADERS = /^(parent|gpgsig|gpgsig-sha256|mergetag) /;

/**
 * Rebuild a raw commit object on a new parent, byte for byte otherwise:
 * its `parent` and signature headers are replaced by `parent <parent>`.
 * Used for non-UTF-8 commits, whose identity bytes the environment of
 * `commit-tree` cannot carry.
 *
 * @param raw - The raw commit object.
 * @param parent - The new parent.
 * @returns The new object's bytes.
 */
export function reparentRawCommit(raw: Buffer, parent: string): Buffer {
  const split = raw.indexOf('\n\n');
  const header = raw.subarray(0, split).toString('latin1').split('\n');
  const kept: string[] = [];
  let dropping = false;
  for (const line of header) {
    if (line.startsWith(' ')) {
      if (!dropping) kept.push(line);
      continue;
    }
    dropping = DROPPED_HEADERS.test(line);
    if (dropping) continue;
    kept.push(line);
    if (line.startsWith('tree ')) kept.push(`parent ${parent}`);
  }
  return Buffer.concat([
    Buffer.from(`${kept.join('\n')}\n`, 'latin1'),
    raw.subarray(split + 1),
  ]);
}

/**
 * Recreate one commit on `parent` with its original tree, message,
 * identities and raw dates (`commit-tree <tree> -p <parent> -F -`). A
 * non-UTF-8 commit (an `encoding` header) is rebuilt byte for byte with
 * `hash-object -t commit -w --stdin` instead ({@link reparentRawCommit}).
 *
 * @param root - Repository root.
 * @param hash - The commit to copy.
 * @param parent - The new parent.
 * @returns The new commit's hash.
 */
async function copyCommit(
  root: string,
  hash: string,
  parent: string,
): Promise<string> {
  const { stdoutBuffer } = await runGit(root, ['cat-file', 'commit', hash]);
  const raw = parseRawCommit(stdoutBuffer);
  if (raw.encoding !== undefined) {
    const { stdout } = await runGit(
      root,
      ['hash-object', '-t', 'commit', '-w', '--stdin'],
      { input: reparentRawCommit(stdoutBuffer, parent) },
    );
    return stdout.trim();
  }
  const { stdout } = await runGit(
    root,
    ['commit-tree', raw.tree, '-p', parent, '-F', '-'],
    {
      input: raw.message,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: raw.author.name,
        GIT_AUTHOR_EMAIL: raw.author.email,
        GIT_AUTHOR_DATE: raw.author.date,
        GIT_COMMITTER_NAME: raw.committer.name,
        GIT_COMMITTER_EMAIL: raw.committer.email,
        GIT_COMMITTER_DATE: raw.committer.date,
      },
    },
  );
  return stdout.trim();
}

/**
 * Rebuild history: a parentless baseline with the tree of the last commit
 * before `boundaryIndex`, then a copy of every retained commit, oldest
 * first. Only objects are written; no reference moves.
 *
 * @param root - Repository root.
 * @param commits - First-parent history, oldest first.
 * @param boundaryIndex - Index of the oldest retained commit (at least 1).
 * @returns The rebuilt tip.
 */
export async function rebuildHistory(
  root: string,
  commits: readonly CommitInfo[],
  boundaryIndex: number,
): Promise<string> {
  const tree = await treeOf(root, commits[boundaryIndex - 1].hash);
  let prev = (
    await runGit(root, ['commit-tree', tree, '-m', SQUASH_BASELINE_MESSAGE])
  ).stdout.trim();
  for (const { hash } of commits.slice(boundaryIndex)) {
    prev = await copyCommit(root, hash, prev);
  }
  return prev;
}

/**
 * The tree of a commit.
 *
 * @param root - Repository root.
 * @param commit - Commit-ish.
 * @returns The tree hash.
 */
export async function treeOf(root: string, commit: string): Promise<string> {
  return (await runGit(root, ['rev-parse', `${commit}^{tree}`])).stdout.trim();
}
