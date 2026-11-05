/**
 * @module watcher/reconcile/Reconciler
 * `reconcile(dir)` against the inventory (D90): walk the directory, send files the inventory lacks (or whose stats differ, parcel) to the stability wait, unlink files the inventory holds that `lstat` confirms gone; one reconcile per root with a containment-merged rerun set (D179). I/O: walks and `lstat`s through the walk limiter.
 */

import type pino from 'pino';

import { normalizeDocumentKey } from '../../util/documentKey';
import { normalizeError } from '../../util/normalizeError';
import type { ChangeSourceHealthTracker } from '../ChangeSourceHealthTracker';
import type { Inventory } from '../inventory/Inventory';
import type { WatchRoots } from '../roots';
import { walk, type WalkOptions } from '../walk/Walker';
import { RerunSet } from './RerunSet';

/** What {@link Reconciler} needs. */
export interface ReconcilerDeps {
  roots: WatchRoots;
  inventory: Inventory;
  /** Walk filters (the watcher's current filter state). */
  walkOptions: () => WalkOptions;
  /** Whether the root's initial scan has finished. */
  scanned: (root: string) => boolean;
  /** Whether the root is marked unavailable (D109). */
  unavailable: (root: string) => boolean;
  /** Start a synthetic path's stability wait (D128). */
  enterStability: (key: string, path: string) => void;
  /** Emit an unlink through the normal handlers. */
  unlink: (path: string) => void;
  /** Whether a path is confirmed absent (`lstat` ENOENT/ENOTDIR). */
  isGone: (path: string) => Promise<boolean>;
  /** Compare size and mtime (the inventory tracks stats: parcel). */
  compareStats: boolean;
  logger: pino.Logger;
  health?: ChangeSourceHealthTracker;
  /** Clock (ms); default `Date.now`. */
  now?: () => number;
}

/**
 * Reconciles directories against the inventory. Triggers before a root's
 * initial scan finishes are dropped (the scan covers them).
 */
export class Reconciler {
  /** Roots with a reconcile running, and what to rerun after it. */
  private readonly active = new Map<string, RerunSet>();
  private readonly now: () => number;

  /** @param deps - Inventory, walk filters, callbacks and health. */
  constructor(private readonly deps: ReconcilerDeps) {
    this.now = deps.now ?? Date.now;
  }

  /**
   * Reconcile `dir`. While its root has a reconcile running, `dir` joins
   * the root's rerun set, reconciled once when the run ends.
   *
   * @param dir - Directory to reconcile (a root or beneath one).
   */
  async reconcile(dir: string): Promise<void> {
    const root = this.deps.roots.rootOf(dir);
    if (root === undefined) return;
    if (!this.deps.scanned(root)) {
      this.deps.logger.debug({ dir }, 'Reconcile before initial scan dropped');
      return;
    }
    const pending = this.active.get(root);
    if (pending) {
      pending.add(dir);
      return;
    }
    const rerun = new RerunSet();
    this.active.set(root, rerun);
    try {
      await this.run(root, dir);
      for (let dirs = rerun.take(); dirs.length > 0; dirs = rerun.take()) {
        for (const next of dirs) await this.run(root, next);
      }
    } finally {
      this.active.delete(root);
    }
  }

  /** One reconcile of `dir` under `root`. */
  private async run(root: string, dir: string): Promise<void> {
    const { inventory, health, logger } = this.deps;
    const started = this.now();
    if (this.deps.unavailable(root)) {
      this.fail(dir, 'root unavailable');
      return;
    }
    let walked;
    try {
      walked = await walk(dir, this.deps.walkOptions());
    } catch (error) {
      this.fail(dir, 'walk failed', error);
      return;
    }
    const known = inventory.entriesUnder(dir);
    const isRoot = normalizeDocumentKey(dir) === normalizeDocumentKey(root);
    if (isRoot && walked.size === 0 && known.size > 0) {
      // An absent or emptied mount never reads as "every file deleted".
      this.fail(dir, 'root walk found no files');
      return;
    }
    for (const [key, file] of walked) {
      const entry = known.get(key);
      const changed =
        this.deps.compareStats &&
        entry !== undefined &&
        (entry.size !== file.size || entry.mtimeMs !== file.mtimeMs);
      if (!entry || changed) this.deps.enterStability(key, file.path);
    }
    const missing = [...known].filter(([key]) => !walked.has(key));
    const gone = await Promise.all(
      missing.map(([, entry]) => this.deps.isGone(entry.path)),
    );
    let unlinks = 0;
    missing.forEach(([, entry], i) => {
      // A real event may have removed it meanwhile.
      if (!gone[i] || !inventory.get(entry.path)) return;
      this.deps.unlink(entry.path);
      unlinks++;
    });
    const durationMs = this.now() - started;
    health?.recordReconcileEvents(unlinks);
    health?.recordReconcile(durationMs, new Date());
    logger.debug(
      { dir, walked: walked.size, unlinks, durationMs },
      'Reconcile complete',
    );
  }

  /** A guarded failure: log, count, emit nothing. */
  private fail(dir: string, reason: string, error?: unknown): void {
    this.deps.health?.recordReconcileError();
    this.deps.logger.warn(
      { dir, reason, ...(error ? { err: normalizeError(error) } : {}) },
      'Reconcile skipped; no events emitted',
    );
  }
}
