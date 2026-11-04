/**
 * @module vcs/maxFileBytes
 * Resolve a root's `vcs.maxFileBytes` from the live config (per-root override, else root-level, else the default), in bytes (D67, D80). Pure.
 */

import { resolve } from 'node:path';

import {
  normalizeWatchPaths,
  parseByteSize,
  VCS_DEFAULTS,
} from '@karmaniverous/jeeves-watcher-core';

import type { JeevesWatcherConfig } from '../config/types';
import { normalizeSlashes } from '../util/normalizeSlashes';
import { globRoot } from '../watcher/globToDir.js';
import { normalizePathCase } from './gitExec';

/**
 * The resolved root directory of a watch glob (forward slashes).
 *
 * @param glob - A `watch.paths` glob.
 * @returns The absolute root directory.
 */
export function watchRootOf(glob: string): string {
  return normalizeSlashes(resolve(globRoot(glob)));
}

/**
 * A root's size cap in bytes under `config`.
 *
 * @param config - The current config (re-read at each staging).
 * @param root - The root directory.
 * @returns The cap in bytes; `0` means no cap.
 */
export function resolveMaxFileBytes(
  config: JeevesWatcherConfig,
  root: string,
): number {
  const key = normalizePathCase(normalizeSlashes(resolve(root)));
  const entry = normalizeWatchPaths(config.watch.paths).find(
    (e) =>
      e.vcs?.maxFileBytes !== undefined &&
      normalizePathCase(watchRootOf(e.path)) === key,
  );
  return parseByteSize(
    entry?.vcs?.maxFileBytes ??
      config.vcs?.maxFileBytes ??
      VCS_DEFAULTS.maxFileBytes,
  );
}
