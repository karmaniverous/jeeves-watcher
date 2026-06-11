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

      const resolvedRoot = normalizeSlashes(resolve(entry.path));
      const mergedConfig: VcsConfig = {
        ...config.vcs,
        ...entry.vcs,
        enabled: true,
      };

      const manager = new VcsManager(
        resolvedRoot,
        mergedConfig,
        logger.child({ vcsRoot: resolvedRoot }),
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
    const manager: VcsManager | undefined = this.findManager(normalizedPath);
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
   * Find the VcsManager that owns the given file path.
   * Matches against normalized, resolved watch roots.
   */
  private findManager(normalizedPath: string): VcsManager | undefined {
    for (const root of this.roots) {
      if (normalizedPath === root || normalizedPath.startsWith(root + '/')) {
        return this.managers.get(root);
      }
    }
    return undefined;
  }
}
