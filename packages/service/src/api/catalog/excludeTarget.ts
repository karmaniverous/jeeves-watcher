/**
 * @module api/catalog/excludeTarget
 * Turns a `POST /vcs/exclude` body into its VCS root and root-anchored pattern (D81), refusing what is not one gitignore pattern or would match the whole root (D103, D140). Pure apart from the coordinator lookup.
 */

import { posix } from 'node:path';

import { normalizeSlashes } from '../../util/normalizeSlashes';
import { normalizePathCase } from '../../vcs/gitExec';
import type { VcsCoordinator } from '../../vcs/VcsCoordinator';
import type { VcsManager } from '../../vcs/VcsManager';
import { invalidRequest, RequestError } from '../requestError';

/** Where an exclude pattern goes. */
export interface ExcludeTarget {
  /** The root's VCS manager. */
  manager: VcsManager;
  /** The glob relative to the root, without a leading `/` (0.20.0's form). */
  relativeGlob: string;
  /** The pattern written to `.git/info/exclude`: `/` + {@link relativeGlob}. */
  pattern: string;
}

/**
 * Characters after which a backslash is a gitignore escape, not a Windows
 * separator: the brackets D168 documents. (`dir\*.log` stays a path.)
 */
const ESCAPABLE = new Set(['[', ']']);

/**
 * Path separators to `/`. A backslash before a bracket (`\[draft\]`, D168)
 * stays an escape; any other backslash is a Windows separator, as 0.20.0
 * treated every backslash. Pure.
 *
 * @param glob - The request glob.
 * @returns The glob with forward slashes.
 */
export function toForwardSlashes(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char !== '\\') {
      out += char;
    } else if (ESCAPABLE.has(glob[i + 1])) {
      out += char + glob[i + 1];
      i++;
    } else {
      out += '/';
    }
  }
  return out;
}

/** Whether a forward-slash path is absolute (POSIX or a Windows drive). */
const isAbsolute = (path: string) =>
  path.startsWith('/') || /^[A-Za-z]:\//.test(path);

/** `path` relative to `root` when it is the root or under it, else undefined. */
function underRoot(root: string, path: string): string | undefined {
  const r = normalizePathCase(root);
  const p = normalizePathCase(path);
  if (p === r) return '';
  return p.startsWith(r + '/') ? path.slice(root.length + 1) : undefined;
}

/** Refuse what is not exactly one gitignore pattern (D103). */
function checkSyntax(glob: string): void {
  if (/[\r\n]/.test(glob)) {
    throw invalidRequest('The glob must be a single pattern (no newline)');
  }
  if (/[{}]/.test(glob)) {
    throw invalidRequest('Braces are not gitignore syntax');
  }
  if (/^[!#]/.test(glob)) {
    throw invalidRequest('The glob must not start with ! or #');
  }
}

/**
 * The root and root-relative glob of a request with an explicit `root`: a
 * glob under the root (absolute) or relative to it; anything that resolves
 * outside is `400` (D103).
 */
function withExplicitRoot(
  coordinator: VcsCoordinator,
  requestedRoot: string,
  glob: string,
): { manager: VcsManager; relative: string } {
  const manager = coordinator.getManager(normalizeSlashes(requestedRoot));
  if (!manager) {
    throw new RequestError('not_found', 'Root is not a VCS-enabled watch root');
  }
  const outside = () => invalidRequest('The glob resolves outside the root');
  if (isAbsolute(glob)) {
    const relative = underRoot(manager.rootPath, posix.normalize(glob));
    if (relative === undefined) throw outside();
    return { manager, relative };
  }
  const relative = posix.normalize(glob);
  if (relative === '..' || relative.startsWith('../')) throw outside();
  return { manager, relative };
}

/**
 * The root and root-relative glob of a request without `root`: the VCS root
 * containing the glob's literal prefix, or `404` as in 0.20.0.
 */
function withRootFromGlob(
  coordinator: VcsCoordinator,
  glob: string,
): { manager: VcsManager; relative: string } {
  const normalized = posix.normalize(glob);
  const base = normalized.replace(/[*?[\]\\].*/, '');
  const manager = coordinator.findManagerForPath(base);
  const relative = manager && underRoot(manager.rootPath, normalized);
  if (manager === undefined || relative === undefined) {
    throw new RequestError(
      'not_found',
      'Glob does not match any VCS-enabled watch root',
    );
  }
  return { manager, relative };
}
/**
 * Whether a root-relative pattern matches the whole root: after
 * normalisation its path part is empty or only `*`, `**` and `/` (D140).
 * Pure.
 *
 * @param relative - Root-relative pattern.
 * @returns true for `''`, `*`, `**`, `/`, `/**`, `**\/*`, `*\/**` and the like.
 */
export function matchesWholeRoot(relative: string): boolean {
  return relative
    .split('/')
    .filter((part) => part !== '' && part !== '.')
    .every((part) => part === '*' || part === '**');
}

/**
 * Resolve a `POST /vcs/exclude` body to its root and anchored pattern.
 *
 * @param coordinator - The VCS coordinator.
 * @param body - The request's `glob` and optional `root`.
 * @returns The target.
 * @throws RequestError `400` for a refused pattern or a glob outside an
 *   explicit `root`; `404` for an unknown root or a glob under no root.
 */
export function resolveExcludeTarget(
  coordinator: VcsCoordinator,
  body: { glob: string; root?: string },
): ExcludeTarget {
  checkSyntax(body.glob);
  const glob = toForwardSlashes(body.glob);
  const { manager, relative } = body.root
    ? withExplicitRoot(coordinator, body.root, glob)
    : withRootFromGlob(coordinator, glob);
  const relativeGlob = posix.normalize(relative).replace(/^\/+/, '');
  if (/^[!#]/.test(relativeGlob)) {
    throw invalidRequest('The glob must not start with ! or #');
  }
  if (matchesWholeRoot(relativeGlob)) {
    throw invalidRequest('The glob matches the whole root');
  }
  return { manager, relativeGlob, pattern: `/${relativeGlob}` };
}
