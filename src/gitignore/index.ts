/**
 * @module gitignore
 * Processor-level gitignore filtering. Scans watched paths for `.gitignore` files in git repos, caches parsed patterns, and exposes `isIgnored()` for path checking.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import ignore, { type Ignore } from 'ignore';

/**
 * Represents a parsed `.gitignore` file and its scope.
 */
interface GitignoreEntry {
  /** Directory containing this `.gitignore` (scope root). */
  dir: string;
  /** Parsed ignore instance. */
  ig: Ignore;
}

/**
 * Represents a git repository with its root and all `.gitignore` entries.
 */
interface RepoInfo {
  /** Repository root (parent of `.git/`). */
  root: string;
  /** All `.gitignore` entries in this repo, ordered deepest-first. */
  entries: GitignoreEntry[];
}

/**
 * Find the git repo root by walking up from `startDir` looking for `.git/`.
 * Returns `undefined` if no repo is found.
 */
function findRepoRoot(startDir: string): string | undefined {
  let dir = resolve(startDir);
  const root = resolve('/');
  while (dir !== root) {
    if (
      existsSync(join(dir, '.git')) &&
      statSync(join(dir, '.git')).isDirectory()
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Recursively find all `.gitignore` files under `dir`.
 * Skips `.git` and `node_modules` directories for performance.
 */
function findGitignoreFiles(dir: string): string[] {
  const results: string[] = [];
  const gitignorePath = join(dir, '.gitignore');
  if (existsSync(gitignorePath)) {
    results.push(gitignorePath);
  }

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry === '.git' || entry === 'node_modules') continue;
    const fullPath = join(dir, entry);
    try {
      if (statSync(fullPath).isDirectory()) {
        results.push(...findGitignoreFiles(fullPath));
      }
    } catch {
      // Skip inaccessible entries
    }
  }
  return results;
}

/**
 * Parse a `.gitignore` file into an `ignore` instance.
 */
function parseGitignore(gitignorePath: string): Ignore {
  const content = readFileSync(gitignorePath, 'utf8');
  return ignore().add(content);
}

/**
 * Normalize a path to use forward slashes (required by `ignore` package).
 */
function toForwardSlash(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Processor-level gitignore filter. Checks file paths against the nearest
 * `.gitignore` chain in git repositories.
 */
export class GitignoreFilter {
  private repos: Map<string, RepoInfo> = new Map();

  /**
   * Create a GitignoreFilter by scanning watched paths for `.gitignore` files.
   *
   * @param watchPaths - Absolute paths being watched (directories or globs resolved to roots).
   */
  constructor(watchPaths: string[]) {
    this.scan(watchPaths);
  }

  /**
   * Scan paths for git repos and their `.gitignore` files.
   */
  private scan(watchPaths: string[]): void {
    this.repos.clear();
    const scannedDirs = new Set<string>();

    for (const watchPath of watchPaths) {
      const absPath = resolve(watchPath);
      let scanDir: string;
      try {
        scanDir = statSync(absPath).isDirectory() ? absPath : dirname(absPath);
      } catch {
        continue;
      }

      if (scannedDirs.has(scanDir)) continue;
      scannedDirs.add(scanDir);

      const repoRoot = findRepoRoot(scanDir);
      if (!repoRoot) continue;
      if (this.repos.has(repoRoot)) continue;

      const gitignoreFiles = findGitignoreFiles(repoRoot);
      const entries: GitignoreEntry[] = gitignoreFiles.map((gf) => ({
        dir: dirname(gf),
        ig: parseGitignore(gf),
      }));

      // Sort deepest-first so nested `.gitignore` files are checked first
      entries.sort((a, b) => b.dir.length - a.dir.length);

      this.repos.set(repoRoot, { root: repoRoot, entries });
    }
  }

  /**
   * Check whether a file path is ignored by any applicable `.gitignore`.
   *
   * @param filePath - Absolute file path to check.
   * @returns `true` if the file should be ignored.
   */
  isIgnored(filePath: string): boolean {
    const absPath = resolve(filePath);

    for (const [, repo] of this.repos) {
      // Check if file is within this repo
      const relToRepo = relative(repo.root, absPath);
      if (relToRepo.startsWith('..') || relToRepo.startsWith(resolve('/'))) {
        continue;
      }

      // Check each `.gitignore` entry (deepest-first)
      for (const entry of repo.entries) {
        const relToEntry = relative(entry.dir, absPath);
        if (relToEntry.startsWith('..')) continue;

        const normalized = toForwardSlash(relToEntry);
        if (entry.ig.ignores(normalized)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Invalidate and re-parse a specific `.gitignore` file.
   * Call when a `.gitignore` file is added, changed, or removed.
   *
   * @param gitignorePath - Absolute path to the `.gitignore` file that changed.
   */
  invalidate(gitignorePath: string): void {
    const absPath = resolve(gitignorePath);
    const gitignoreDir = dirname(absPath);

    for (const [, repo] of this.repos) {
      const relToRepo = relative(repo.root, gitignoreDir);
      if (relToRepo.startsWith('..')) continue;

      // Remove old entry for this directory
      repo.entries = repo.entries.filter((e) => e.dir !== gitignoreDir);

      // Re-parse if file still exists
      if (existsSync(absPath)) {
        repo.entries.push({ dir: gitignoreDir, ig: parseGitignore(absPath) });
        // Re-sort deepest-first
        repo.entries.sort((a, b) => b.dir.length - a.dir.length);
      }

      return;
    }

    // If not in any known repo, check if it's in a repo we haven't scanned
    const repoRoot = findRepoRoot(gitignoreDir);
    if (repoRoot && existsSync(absPath)) {
      const entries: GitignoreEntry[] = [
        { dir: gitignoreDir, ig: parseGitignore(absPath) },
      ];
      if (this.repos.has(repoRoot)) {
        const repo = this.repos.get(repoRoot)!;
        repo.entries.push(entries[0]);
        repo.entries.sort((a, b) => b.dir.length - a.dir.length);
      } else {
        this.repos.set(repoRoot, { root: repoRoot, entries });
      }
    }
  }
}
