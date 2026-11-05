/**
 * @module watcher/walk/Walker
 * Glob-aware directory walk: prunes ignored directories, skips files the filters reject before `stat`ing, and returns each file's path, size and mtime by key. I/O: readdir and stat, each through the walk limiter.
 */

import type { Dirent, Stats } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { normalizeDocumentKey } from '../../util/documentKey';
import type { FileStats } from '../inventory/Inventory';
import { walkLimit } from './walkLimiter';

/** A file found by a walk. */
export interface WalkedFile extends FileStats {
  /** The path, joined from the walked directory. */
  path: string;
}

/** Filesystem calls a walk makes (injectable for tests). */
export interface WalkFs {
  /** `readdir` with file types. */
  readdir: (dir: string) => Promise<Dirent[]>;
  /** `stat` (follows symlinks). */
  stat: (path: string) => Promise<Stats>;
}

/** What a walk prunes and keeps. */
export interface WalkOptions {
  /** Skip this directory and everything beneath it. */
  prune: (dir: string) => boolean;
  /** Keep this file (checked before its `stat`). */
  include: (path: string) => boolean;
  /** Filesystem (default: `node:fs/promises`). */
  fs?: WalkFs;
  /** Called for each directory read (the inotify watch count, D126). */
  onDirectory?: (dir: string) => void;
}

const defaultFs: WalkFs = {
  readdir: (dir) => readdir(dir, { withFileTypes: true }),
  stat: (path) => stat(path),
};

/**
 * Walk `dir`. A failure to read `dir` itself rejects (the reconcile guard
 * counts it); entries that vanish or cannot be read beneath it are skipped.
 * Symlinked directories are not followed.
 *
 * @param dir - Directory to walk.
 * @param options - Prune and include filters, and fs.
 * @returns Files by document key.
 */
export async function walk(
  dir: string,
  options: WalkOptions,
): Promise<Map<string, WalkedFile>> {
  const fs = options.fs ?? defaultFs;
  const found = new Map<string, WalkedFile>();

  const visitFile = async (path: string): Promise<void> => {
    if (!options.include(path)) return;
    try {
      const stats = await walkLimit(() => fs.stat(path));
      if (!stats.isFile()) return;
      found.set(normalizeDocumentKey(path), {
        path,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      });
    } catch {
      // Vanished or unreadable since its directory was read: skip it.
    }
  };

  const visitDir = async (current: string, top: boolean): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await walkLimit(() => fs.readdir(current));
    } catch (error) {
      // Beneath the walked directory, a vanished or unreadable directory is
      // skipped (chokidar cannot read it either).
      if (top) throw error;
      return;
    }
    options.onDirectory?.(current);
    await Promise.all(
      entries.map((entry) => {
        const path = join(current, entry.name);
        if (entry.isDirectory()) {
          return options.prune(path)
            ? Promise.resolve()
            : visitDir(path, false);
        }
        return entry.isFile() || entry.isSymbolicLink()
          ? visitFile(path)
          : Promise.resolve();
      }),
    );
  };

  await visitDir(dir, true);
  return found;
}
