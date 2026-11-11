/**
 * @module watcher/stability/StabilityTicker
 * The shared stability ticker (D128): one pending set and one interval timer for every path awaiting a stable size, at most 2,000 `stat`s per tick, oldest-checked first. I/O: `stat` through the injected function; one timer while paths are pending.
 */

import { keyWithin, normalizeDocumentKey } from '../../util/documentKey';
import type { FileStats, InventoryEntry } from '../inventory/Inventory';

/** Most `stat`s one tick makes (D128). */
export const MAX_STATS_PER_TICK = 2000;

/** Longest tick interval (ms); shorter thresholds tick at a quarter of it. */
const MAX_TICK_MS = 250;

/** A path that has settled, with the stats it settled at. */
export interface SettledPath {
  /** The path, as entered. */
  path: string;
  /** Size and mtime at the last check. */
  stats: FileStats;
  /** Entered by reconciliation (counted in `reconcileEvents`). */
  synthetic: boolean;
}

/** Options of {@link StabilityTicker}. */
export interface StabilityTickerOptions {
  /** `watch.stabilityThresholdMs`; 0 or unset emits after one `stat`. */
  thresholdMs?: number;
  /** Stat a path; undefined when it is gone. */
  stat: (path: string) => Promise<FileStats | undefined>;
  /** Called once per settled path. */
  onSettled: (settled: SettledPath) => void;
  /** Clock (ms); default `Date.now`. */
  now?: () => number;
}

/** One pending path. */
interface Pending {
  path: string;
  synthetic: boolean;
  /** Size at the last check; undefined before the first. */
  size?: number;
  /** When the size was last seen to change. */
  sizeSince: number;
}

/**
 * The event `onSettled` should emit for a settled path, given its inventory
 * entry now (D142, re-checked just before emitting): nothing when the entry
 * holds the same size and mtime, or holds no stats (chokidar: a real event
 * already reported the path); `change` when stats differ; `add` when absent.
 *
 * @param entry - The path's inventory entry, if any.
 * @param stats - The settled stats.
 * @returns The event to emit, or undefined to drop it.
 */
export function settledEvent(
  entry: InventoryEntry | undefined,
  stats: FileStats,
): 'add' | 'change' | undefined {
  if (!entry) return 'add';
  if (entry.size === undefined || entry.mtimeMs === undefined) return undefined;
  return entry.size === stats.size && entry.mtimeMs === stats.mtimeMs
    ? undefined
    : 'change';
}

/**
 * One timer for every pending path: each tick `stat`s the oldest-checked
 * paths (at most {@link MAX_STATS_PER_TICK}) and settles a path once its size
 * has stayed unchanged for `thresholdMs`.
 */
export class StabilityTicker {
  private readonly pending = new Map<string, Pending>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;
  private stopped = false;
  private readonly now: () => number;

  /** @param options - Threshold, stat and settle callback. */
  constructor(private readonly options: StabilityTickerOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Paths waiting (`health.changeSource.pendingStability`). */
  get size(): number {
    return this.pending.size;
  }

  /**
   * Start (or join) a path's stability wait.
   *
   * @param key - The path's document key.
   * @param path - The path.
   * @param synthetic - Entered by reconciliation.
   */
  enter(key: string, path: string, synthetic: boolean): void {
    if (this.stopped) return;
    const existing = this.pending.get(key);
    if (existing) {
      existing.synthetic &&= synthetic;
      return;
    }
    this.pending.set(key, { path, synthetic, sizeSince: this.now() });
    if (!this.options.thresholdMs) {
      void this.check([[key, this.pending.get(key)!]]);
      return;
    }
    this.timer ??= setInterval(
      () => void this.tick(),
      Math.min(MAX_TICK_MS, this.options.thresholdMs / 4),
    );
  }

  /**
   * Drop the pending paths at or beneath a directory (its root went away,
   * D109).
   *
   * @param dir - The directory.
   */
  dropUnder(dir: string): void {
    const prefix = normalizeDocumentKey(dir);
    for (const key of [...this.pending.keys()]) {
      if (keyWithin(key, prefix)) this.pending.delete(key);
    }
  }

  /** Drop every pending path and the timer. */
  stop(): void {
    this.stopped = true;
    this.pending.clear();
    this.clearTimer();
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const batch: [string, Pending][] = [];
      for (const item of this.pending) {
        if (batch.length >= MAX_STATS_PER_TICK) break;
        batch.push(item);
      }
      await this.check(batch);
    } finally {
      this.ticking = false;
      if (this.pending.size === 0) this.clearTimer();
    }
  }

  private async check(batch: [string, Pending][]): Promise<void> {
    // Re-insert each checked path at the end: Map order is then
    // oldest-checked first.
    for (const [key, item] of batch) {
      this.pending.delete(key);
      this.pending.set(key, item);
    }
    // The clock is read on both sides of the stats (#306): a size held since
    // a change is measured from `before` (the latest time it can have been
    // seen unchanged), a new size from `after` (the latest time it can have
    // been written). A stall between a `stat` and its continuation then
    // only delays settling, never hastens it.
    const before = this.now();
    const stats = await Promise.all(
      batch.map(([, item]) => this.options.stat(item.path)),
    );
    const after = this.now();
    const threshold = this.options.thresholdMs ?? 0;
    batch.forEach(([key, item], i) => {
      const current = stats[i];
      if (this.pending.get(key) !== item) return;
      if (!current) {
        this.pending.delete(key);
        return;
      }
      if (item.size !== current.size) {
        item.size = current.size;
        item.sizeSince = after;
        if (threshold > 0) return;
      }
      if (threshold > 0 && before - item.sizeSince < threshold) return;
      this.pending.delete(key);
      this.options.onSettled({
        path: item.path,
        stats: current,
        synthetic: item.synthetic,
      });
    });
  }

  private clearTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
