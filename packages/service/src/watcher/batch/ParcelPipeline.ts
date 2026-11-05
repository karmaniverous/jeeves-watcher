/**
 * @module watcher/batch/ParcelPipeline
 * What `FileSystemWatcher` does with parcel batches (C2, C3, D127, D149, D179): queue each batch in the serial FIFO, classify it from the disk, then apply it through the normal handlers: files into the stability wait, unlinks, directory deletes and creates through pairing (or, without move detection, per-file unlinks and a reconcile), 8.3 short names as a reconcile of the parent. I/O: `lstat`, walks.
 */

import { lstat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import type pino from 'pino';

import { normalizeDocumentKey } from '../../util/documentKey';
import type { RawChangeEvent } from '../changeSource/types';
import type { FilteredEvents } from '../filteredEvents';
import type { Inventory } from '../inventory/Inventory';
import { DirectoryPairing } from '../pairing/DirectoryPairing';
import type { WatchFilter } from '../pathFilter';
import type { WatchRoots } from '../roots';
import type { StabilityTicker } from '../stability/StabilityTicker';
import {
  walk as defaultWalk,
  type WalkedFile,
  type WalkOptions,
} from '../walk/Walker';
import { walkFilters } from '../walk/walkFilters';
import { BatchFifo } from './BatchFifo';
import {
  type ClassifiedPath,
  classifyBatch,
  type PathState,
} from './classifyBatch';

/** What the pipeline drives. */
export interface ParcelPipelineDeps {
  roots: WatchRoots;
  filter: WatchFilter;
  /** `watch.ignored` matchers plus each root's `.git` (D152). */
  ignore: ((path: string) => boolean)[];
  inventory: Inventory;
  events: FilteredEvents;
  ticker: StabilityTicker;
  /** Reconcile a directory (owned by `FileSystemWatcher`). */
  reconcile: (dir: string) => void;
  /** `watch.moveDetection`: directory pairing runs when enabled. */
  moveDetection?: { enabled: boolean; bufferMs: number };
  logger: pino.Logger;
  /** `process.platform` (tests). */
  platform?: NodeJS.Platform;
  /** `lstat` as a path state (tests). */
  lstat?: (path: string) => Promise<PathState>;
  /** The walker (tests). */
  walk?: (
    dir: string,
    options: WalkOptions,
  ) => Promise<Map<string, WalkedFile>>;
}

/**
 * A path's state from `lstat`: absence only for `ENOENT`/`ENOTDIR` (D90).
 *
 * @param path - The path.
 * @returns Its state.
 */
export async function lstatState(path: string): Promise<PathState> {
  try {
    const stats = await lstat(path);
    if (stats.isFile()) return 'file';
    return stats.isDirectory() ? 'dir' : 'other';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'absent' : 'other';
  }
}

/** The parcel batch pipeline of one running watcher. */
export class ParcelPipeline {
  /** The serial FIFO (the initial walk pauses a root in it). */
  readonly fifo: BatchFifo;
  private readonly pairing: DirectoryPairing | undefined;
  private readonly platform: NodeJS.Platform;
  private readonly lstat: (path: string) => Promise<PathState>;
  private readonly walk: NonNullable<ParcelPipelineDeps['walk']>;
  private readonly filters: Pick<WalkOptions, 'prune' | 'include'>;

  /** @param deps - The running watcher's parts. */
  constructor(private readonly deps: ParcelPipelineDeps) {
    this.fifo = new BatchFifo(deps.logger);
    this.platform = deps.platform ?? process.platform;
    this.lstat = deps.lstat ?? lstatState;
    this.walk = deps.walk ?? defaultWalk;
    this.filters = walkFilters(deps.filter, deps.ignore);
    const { moveDetection } = deps;
    this.pairing = moveDetection?.enabled
      ? new DirectoryPairing({
          bufferMs: moveDetection.bufferMs,
          entriesUnder: (dir) => deps.inventory.entriesUnder(dir),
          forget: (path) => {
            deps.inventory.delete(path);
          },
          walk: (dir) => this.walk(dir, this.walkOptions()),
          unlink: (path) => {
            deps.events.unlink(path);
          },
          move: (oldPath, newPath, stats) => {
            deps.events.moved(oldPath, newPath, stats);
          },
          enterStability: (path) => {
            this.enterStability(path);
          },
          dropStability: (dir) => {
            deps.ticker.dropUnder(dir);
          },
          reconcile: deps.reconcile,
          schedule: (work) => {
            this.fifo.push(undefined, work);
          },
          logger: deps.logger,
        })
      : undefined;
  }

  /** The walk filters (`watch.ignored`, globs, gitignore). */
  walkOptions(): Pick<WalkOptions, 'prune' | 'include'> {
    return this.filters;
  }

  /**
   * A batch from the source: queued behind earlier ones (D149).
   *
   * @param sourceRoot - The root as the source named it.
   * @param events - The batch.
   */
  push(sourceRoot: string, events: RawChangeEvent[]): void {
    const root = this.deps.roots.rootOf(sourceRoot) ?? sourceRoot;
    this.fifo.push(root, () => this.process(root, events));
  }

  /** Stop: drop held batches and pairing holds. */
  stop(): void {
    this.fifo.stop();
    this.pairing?.stop();
  }

  /** Classify a batch from the disk, then apply it. */
  private async process(root: string, events: RawChangeEvent[]): Promise<void> {
    const { inventory, ignore } = this.deps;
    const batch = await classifyBatch(events, {
      root,
      platform: this.platform,
      ignored: (path) => ignore.some((matches) => matches(path)),
      isDirectory: (path) => inventory.isDirectory(path),
      inInventory: (path) => inventory.get(path) !== undefined,
      lstat: this.lstat,
    });
    if (batch.rootGone) {
      this.deps.logger.debug({ root }, 'Batch for a missing root dropped');
      return;
    }
    for (const path of batch.paths) await this.apply(path);
  }

  /** Apply one classified path through the normal handlers. */
  private async apply({ kind, path }: ClassifiedPath): Promise<void> {
    const { events, ticker, reconcile } = this.deps;
    switch (kind) {
      case 'file':
        if (!this.pairing?.buffer(path)) this.enterStability(path);
        return;
      case 'unlink':
        ticker.dropUnder(path);
        events.unlink(path);
        return;
      case 'shortName':
        reconcile(dirname(path));
        return;
      case 'dirDelete':
        ticker.dropUnder(path);
        if (this.pairing) await this.pairing.deleted(path);
        else this.expandDelete(path);
        return;
      case 'dirCreate':
        if (this.pairing) await this.pairing.created(path);
        else reconcile(path);
    }
  }

  /** Without pairing, a directory delete is an unlink per file (D127). */
  private expandDelete(dir: string): void {
    for (const entry of this.deps.inventory.entriesUnder(dir).values()) {
      this.deps.events.unlink(entry.path);
    }
  }

  /**
   * A file event starts (or joins) its stability wait, when the file can
   * matter: it passes the filters, or it is a `.gitignore`.
   */
  private enterStability(path: string): void {
    const wanted =
      basename(path) === '.gitignore' || this.filters.include(path);
    if (wanted) this.deps.ticker.enter(normalizeDocumentKey(path), path, false);
  }
}
