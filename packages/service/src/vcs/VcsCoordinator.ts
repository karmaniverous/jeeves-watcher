/**
 * @module vcs/VcsCoordinator
 * Orchestrates VCS across all watch roots. Routes file events to the correct
 * root's VcsManager instance.
 */

import { resolve } from 'node:path';

import {
  normalizeWatchPaths,
  VCS_DEFAULTS,
  type VcsConfig,
  type VcsHealth,
  vcsRetentionConfigSchema,
} from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import { normalizeSlashes } from '../util/normalizeSlashes';
import { CommitMessageGenerator } from './CommitMessageGenerator';
import { findRootForPath, normalizePathCase } from './gitExec';
import { resolveMaxFileBytes, watchRootOf } from './maxFileBytes';
import { resolveCommitMessageApiKey } from './resolveCommitMessageApiKey';
import { VcsManager } from './VcsManager';
import { createWatchScope, type WatchScope } from './watchScope';

/**
 * Orchestrates VCS across all VCS-enabled watch roots.
 */
export class VcsCoordinator {
  private readonly managers: Map<string, VcsManager> = new Map();
  private readonly roots: string[] = [];
  private readonly logger: pino.Logger;
  private readonly isInWatchScope: WatchScope = () => false;

  /**
   * @param config - Config at construction (roots, remotes, retention).
   * @param logger - Logger.
   * @param getConfig - Live config, for settings read at each staging
   *   (`vcs.maxFileBytes`, D67). Default: the construction config.
   */
  constructor(
    config: JeevesWatcherConfig,
    logger: pino.Logger,
    getConfig: () => JeevesWatcherConfig = () => config,
  ) {
    this.logger = logger;

    if (!config.vcs?.enabled) return;

    // Same watch-scope logic as the filesystem watcher (globs + ignored),
    // used to filter startup deletion reconciliation. See #249.
    this.isInWatchScope = createWatchScope(config.watch);

    const normalized = normalizeWatchPaths(config.watch.paths);
    for (const entry of normalized) {
      const rootVcs = entry.vcs?.enabled ?? config.vcs.enabled;
      if (!rootVcs) continue;

      const resolvedRoot = watchRootOf(entry.path);
      const rootKey = normalizePathCase(resolvedRoot);

      // Deduplicate: skip if another glob already resolved to this root.
      if (this.managers.has(rootKey)) continue;
      const mergedRetention =
        entry.vcs?.retention ??
        config.vcs.retention ??
        vcsRetentionConfigSchema.parse({});
      const mergedConfig: VcsConfig = {
        ...config.vcs,
        ...entry.vcs,
        enabled: true,
        retention: mergedRetention,
      };

      // Create CommitMessageGenerator if AI commit messages are configured
      const cmConfig = mergedConfig.commitMessage;
      const rootLogger = logger.child({ vcsRoot: resolvedRoot });
      const resolvedApiKey =
        cmConfig?.enabled !== false
          ? resolveCommitMessageApiKey(
              cmConfig?.provider ?? VCS_DEFAULTS.commitMessage.provider,
              cmConfig?.apiKey,
              rootLogger,
            )
          : undefined;
      const generator =
        cmConfig?.enabled !== false && resolvedApiKey
          ? new CommitMessageGenerator(
              cmConfig?.provider ?? VCS_DEFAULTS.commitMessage.provider,
              cmConfig?.model ?? VCS_DEFAULTS.commitMessage.model,
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
        {
          getMaxFileBytes: () => resolveMaxFileBytes(getConfig(), resolvedRoot),
        },
      );
      this.managers.set(rootKey, manager);
      this.roots.push(resolvedRoot);
    }

    // Sort roots longest-first so nested paths match before parents.
    this.roots.sort((a, b) => b.length - a.length);
  }

  /**
   * Start all VcsManager instances (each runs its startup maintenance).
   */
  async start(): Promise<void> {
    const startPromises: Promise<void>[] = [];
    this.managers.forEach((manager) => {
      startPromises.push(manager.start());
    });
    await Promise.all(startPromises);
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
   * Signal that the initial filesystem scan is complete.
   *
   * Flushes each manager's throttle buffer before ending baseline mode, ensuring
   * any files still pending in the VCS throttle are committed with a
   * `"baseline:"` prefix rather than `"watcher:"`. AI generation is not enabled
   * until all managers have completed their flush.
   */
  async onInitialScanComplete(): Promise<void> {
    for (const manager of this.managers.values()) {
      // Reconcile tracked-but-deleted paths within this manager's watch
      // scope before flushing, so the baseline commit records deletions
      // that happened while the process wasn't watching. See #249.
      await manager.reconcileDeletions(
        (absPath) =>
          this.findManagerForPath(absPath) === manager &&
          this.isInWatchScope(absPath),
      );
      await manager.flush();
      manager.endBaseline();
    }
    this.logger.debug('VcsCoordinator: initial scan complete, baseline ended');
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
   * VCS state for `GET /status` `health.vcs` (D86).
   *
   * @returns Root count, total backlog, tripped roots and the oldest trip.
   */
  getHealth(): VcsHealth {
    let pending = 0;
    let trippedRoots = 0;
    let oldestTrippedAt: string | null = null;
    for (const manager of this.managers.values()) {
      const state = manager.breakerState;
      pending += state.pendingCount;
      if (!state.tripped) continue;
      trippedRoots++;
      const since = manager.trippedSince;
      if (
        since !== null &&
        (oldestTrippedAt === null || since < oldestTrippedAt)
      ) {
        oldestTrippedAt = since;
      }
    }
    return {
      roots: this.managers.size,
      pending,
      trippedRoots,
      oldestTrippedAt,
    };
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
    return this.managers.get(normalizePathCase(root));
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
    return root ? this.managers.get(normalizePathCase(root)) : undefined;
  }
}
