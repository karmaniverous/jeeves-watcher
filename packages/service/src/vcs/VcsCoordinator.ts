/**
 * @module vcs/VcsCoordinator
 * Orchestrates VCS across all watch roots. Routes file events to the correct
 * root's VcsManager instance.
 */

import { resolve } from 'node:path';

import {
  normalizeWatchPaths,
  type VcsConfig,
} from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import { normalizeSlashes } from '../util/normalizeSlashes';
import { CommitMessageGenerator } from './CommitMessageGenerator';
import { findRootForPath } from './gitExec';
import { resolveCommitMessageApiKey } from './resolveCommitMessageApiKey';
import { VcsManager } from './VcsManager';

/**
 * Orchestrates VCS across all VCS-enabled watch roots.
 */
export class VcsCoordinator {
  private readonly managers: Map<string, VcsManager> = new Map();
  private readonly roots: string[] = [];
  private readonly logger: pino.Logger;

  constructor(config: JeevesWatcherConfig, logger: pino.Logger) {
    this.logger = logger;

    if (!config.vcs?.enabled) return;

    const normalized = normalizeWatchPaths(config.watch.paths);
    for (const entry of normalized) {
      const rootVcs = entry.vcs?.enabled ?? config.vcs.enabled;
      if (!rootVcs) continue;

      if (/[*?{[]/.test(entry.path)) {
        logger.warn(
          { path: entry.path },
          'Skipping VCS for watch path containing glob characters',
        );
        continue;
      }

      const resolvedRoot = normalizeSlashes(resolve(entry.path));
      const mergedConfig: VcsConfig = {
        ...config.vcs,
        ...entry.vcs,
        enabled: true,
      };

      // Create CommitMessageGenerator if AI commit messages are configured
      const cmConfig = mergedConfig.commitMessage;
      const rootLogger = logger.child({ vcsRoot: resolvedRoot });
      const resolvedApiKey =
        cmConfig?.enabled !== false
          ? resolveCommitMessageApiKey(
              cmConfig?.provider ?? 'anthropic',
              cmConfig?.apiKey,
              rootLogger,
            )
          : undefined;
      const generator =
        cmConfig?.enabled !== false && resolvedApiKey
          ? new CommitMessageGenerator(
              cmConfig?.provider ?? 'anthropic',
              cmConfig?.model ?? 'claude-haiku-4-0',
              resolvedApiKey,
              rootLogger,
            )
          : undefined;

      // Resolve remote config: per-root overrides fall back to root-level defaults
      const remoteUrl = entry.vcs?.remote;
      const accessToken =
        entry.vcs?.accessToken ?? config.vcs.defaultAccessToken;

      const manager = new VcsManager(
        resolvedRoot,
        mergedConfig,
        logger.child({ vcsRoot: resolvedRoot }),
        generator,
        remoteUrl,
        accessToken,
      );
      this.managers.set(resolvedRoot, manager);
      this.roots.push(resolvedRoot);
    }

    // Sort roots longest-first so nested paths match before parents.
    this.roots.sort((a, b) => b.length - a.length);
  }

  /**
   * Start all VcsManager instances.
   */
  start(): void {
    this.managers.forEach((manager) => {
      manager.start();
    });
    this.logger.info(
      { rootCount: this.managers.size },
      'VcsCoordinator started',
    );
  }

  /**
   * Route a file event to the correct root's VcsManager.
   *
   * @param filePath - Absolute path of the changed file.
   * @param event - The event type: add, change, or unlink.
   */
  onFileChange(filePath: string, event: 'add' | 'change' | 'unlink'): void {
    const normalizedPath = normalizeSlashes(resolve(filePath));
    const manager = this.findManagerForPath(normalizedPath);
    if (!manager) return;

    if (event === 'unlink') {
      manager.handleUnlink(normalizedPath);
    } else {
      manager.fileChanged(normalizedPath);
    }
  }

  /**
   * Flush all managers and clean up.
   */
  async stop(): Promise<void> {
    const stopPromises: Promise<void>[] = [];
    this.managers.forEach((manager) => {
      stopPromises.push(manager.stop());
    });
    await Promise.all(stopPromises);
    this.logger.info('VcsCoordinator stopped');
  }

  /**
   * Get the sorted root paths (longest-first).
   */
  getRoots(): readonly string[] {
    return this.roots;
  }

  /**
   * Get the VcsManager for a specific root path.
   */
  getManager(root: string): VcsManager | undefined {
    return this.managers.get(root);
  }

  /**
   * Get all managers as [root, manager] pairs.
   */
  getAllManagers(): ReadonlyMap<string, VcsManager> {
    return this.managers;
  }

  /**
   * Find the VcsManager that owns the given normalized file path.
   * Uses longest-prefix-match against resolved watch roots.
   *
   * @param normalizedPath - Normalized absolute path (forward slashes).
   * @returns The matching VcsManager, or undefined.
   */
  findManagerForPath(normalizedPath: string): VcsManager | undefined {
    const root = findRootForPath(this.roots, normalizedPath);
    return root ? this.managers.get(root) : undefined;
  }
}
